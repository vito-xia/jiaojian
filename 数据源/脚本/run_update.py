"""两个用户启动器共用的更新流程、日志和生成结果校验。"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Callable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))


class UpdateError(RuntimeError):
    def __init__(self, message: str, exit_code: int = 2):
        super().__init__(message)
        self.exit_code = exit_code if exit_code > 0 else 1


def read_chunk(path: Path, expected_name: str) -> dict:
    """仅解码注册函数中的 JSON，不执行生成文件中的 JavaScript。"""
    raw = path.read_text(encoding="utf-8-sig").strip()
    prefix = "window.__JIAOJIAN_REGISTER_CHUNK__("
    if not raw.startswith(prefix) or not raw.endswith(");"):
        raise UpdateError(f"分片注册格式错误：{path.name}")
    arguments = raw[len(prefix):-2]
    name, position = json.JSONDecoder().raw_decode(arguments)
    remaining = arguments[position:].lstrip()
    if name != expected_name or not remaining.startswith(","):
        raise UpdateError(f"分片名称错误：{path.name}")
    payload = json.loads(remaining[1:])
    if not isinstance(payload, dict):
        raise UpdateError(f"分片数据不是对象：{path.name}")
    return payload


def require_fresh(path: Path, started_ns: int) -> None:
    if not path.is_file():
        raise UpdateError(f"本次输出缺失：{path.name}")
    if path.stat().st_mtime_ns < started_ns:
        raise UpdateError(f"本次未更新输出，仍是旧文件：{path.name}")


def require_generated_at(value: str, started_ns: int) -> None:
    generated = datetime.fromisoformat(value)
    started = datetime.fromtimestamp(started_ns / 1_000_000_000).replace(microsecond=0)
    if generated < started:
        raise UpdateError(f"分片生成时间仍是旧值：{value}")


def validate_standard(root: Path, started_ns: int) -> None:
    for filename in ("dashboard_bundle.js", "data_quality_report.json", "抖音高停滞积分网点.xlsx"):
        require_fresh(root / "data" / filename, started_ns)


def validate_long_order(root: Path, started_ns: int) -> str:
    chunk_path = root / "data" / "dashboard_long_order.js"
    manifest_path = root / "数据源" / "脚本处理后输出" / "超长单-脚本处理后" / "manifest.json"
    require_fresh(chunk_path, started_ns)
    require_fresh(manifest_path, started_ns)
    report = json.loads((root / "data" / "data_quality_report.json").read_text(encoding="utf-8"))
    expected = report["long_order_source"]
    payload = read_chunk(chunk_path, "long-order")
    meta = payload["long_order_meta"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dates = meta["source_dates"]
    entries = manifest["entries"]
    if not dates or dates != sorted(set(dates)) or any(date.fromisoformat(day).isoformat() != day for day in dates):
        raise UpdateError("超长单源日期为空、重复或格式错误")
    if meta["schema_version"] != 4 or meta["row_limit"] != 1000 or manifest["row_limit"] != 1000:
        raise UpdateError("超长单 schema 或 TOP1000 契约不一致")
    if (len(dates) != meta["source_file_count"] or len(dates) != expected["file_count"]
            or dates[-1] != expected["latest_date"] or dates != [item["date"] for item in entries]):
        raise UpdateError(f"超长单日期与常规质量报告不一致：分片 {len(dates)} 日 / {dates[-1]}，"
                          f"预期 {expected['file_count']} 日 / {expected['latest_date']}")
    require_generated_at(meta["generated_at"], started_ns)
    if meta["generated_at"] != manifest["generated_at"]:
        raise UpdateError("超长单分片和处理清单生成时间不一致")
    counts: Counter = Counter()
    for branch, points in payload["long_order_trends"].items():
        seen = set()
        for point in points:
            day = point["date"]
            if day not in dates or day in seen or point.get("branch") != branch:
                raise UpdateError(f"超长单网点日记录重复或归属错误：{branch}")
            seen.add(day)
            counts[day] += 1
    total = sum(counts.values())
    if total != meta["source_branch_row_count"] or total != expected["branch_day_rows"]:
        raise UpdateError("超长单记录数与常规质量报告不一致")
    if meta["source_row_count"] != sum(item["output_rows"] for item in entries):
        raise UpdateError("超长单源行数与处理清单不一致")
    if any(counts[item["date"]] != item["branch_rows"] or not 0 <= item["branch_rows"] <= item["output_rows"] <= 1000
           for item in entries):
        raise UpdateError("超长单逐日记录数与处理清单不一致")
    return f"超长单校验通过：{len(dates)} 个日期 / {total:,} 条记录 / 最新 {dates[-1]}"


def validate_tday_download(root: Path, started_ns: int) -> str:
    directory = root / "数据源" / "脚本处理后输出" / "交件T脚本处理后"
    manifest_path = directory / "tday_download_manifest.json"
    require_fresh(manifest_path, started_ns)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest["entries"]
    if manifest["date"] != date.today().isoformat() or not entries or len(entries) != manifest["source_link_count"]:
        raise UpdateError("T 日下载清单日期或文件数量不正确")
    for item in entries:
        path = (directory / item["filename"]).resolve()
        if path.parent != directory.resolve() or item["status"] != "downloaded" or not path.is_file():
            raise UpdateError("T 日下载结果缺失或路径错误")
        if path.stat().st_size != item["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise UpdateError(f"T 日下载文件与清单不一致：{path.name}")
    return f"T 日下载校验通过：{len(entries)} 个文件"


def validate_tday(root: Path, started_ns: int) -> str:
    output = root / "data" / "dashboard_tday.js"
    require_fresh(output, started_ns)
    payload = read_chunk(output, "tday")["t_day"]
    require_generated_at(payload["generated_at"], started_ns)
    if payload["date"] != date.today().isoformat():
        raise UpdateError("T 日分片日期不是本机当天")
    if payload["source_status"] != "uploaded" or payload.get("trace_source_status") != "uploaded":
        raise UpdateError(f"T 日主源未成功生成，状态：{payload['source_status']}")
    return f"T 日校验通过：{payload['date']}，内网轨迹已接入"


class UpdateRunner:
    def __init__(self, root: Path, mode: str):
        self.root = root.resolve()
        directory = self.root / "数据源" / "脚本处理后输出" / "更新日志"
        directory.mkdir(parents=True, exist_ok=True)
        self.log_path = directory / f"{datetime.now():%Y%m%d_%H%M%S_%f}_{mode}_{os.getpid()}.log"
        self.log = self.log_path.open("x", encoding="utf-8")
        self.stage = "启动"
        self.step = 0

    def __enter__(self):
        self.emit(f"更新流程开始；Python：{sys.executable}；日志：{self.log_path}")
        return self

    def __exit__(self, *_):
        self.log.close()

    def emit(self, message: str) -> None:
        message = re.sub(r"https?://\S+", "[下载链接已省略]", str(message), flags=re.IGNORECASE)
        print(message, flush=True)
        self.log.write(message + "\n")
        self.log.flush()

    def begin(self, label: str) -> int:
        self.stage = label
        self.step += 1
        self.emit(f"\n[{self.step}] {label}开始 · {datetime.now():%Y-%m-%d %H:%M:%S}")
        return time.time_ns()

    def run_step(self, label: str, command: list[str]) -> int:
        started = self.begin(label)
        environment = os.environ.copy()
        environment.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
        process = subprocess.Popen(command, cwd=self.root, env=environment,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding="utf-8", errors="replace", bufsize=1)
        try:
            for line in process.stdout:
                self.emit(line.rstrip("\r\n"))
            exit_code = process.wait()
        except BaseException:
            process.terminate()
            process.wait()
            raise
        finally:
            process.stdout.close()
        self.emit(f"[{self.step}] {label}结束 · 退出码 {exit_code}")
        if exit_code:
            raise UpdateError(f"{label}失败", exit_code)
        return started

    def python_step(self, label: str, relative_path: str, *arguments: str) -> int:
        script = (self.root / relative_path).resolve()
        if not script.is_file():
            self.stage = label
            raise UpdateError(f"处理脚本不存在：{script}")
        return self.run_step(label, [sys.executable, "-B", "-X", "utf8", "-u", str(script), *arguments])

    def check_step(self, label: str, validator: Callable[[], str | None]) -> None:
        self.begin(label)
        try:
            message = validator()
        except Exception as error:
            self.emit(f"[{self.step}] {label}结束 · 退出码 2")
            raise UpdateError(str(error)) from error
        if message:
            self.emit(message)
        self.emit(f"[{self.step}] {label}结束 · 退出码 0")

    def build_step(self, script: str, label: str) -> None:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            self.stage = label
            raise UpdateError("未找到 npm，请安装 Node.js 或使用 --no-build")
        command = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", "npm.cmd", "run", script] if os.name == "nt" else [npm, "run", script]
        self.run_step(label, command)


def run_t1(runner: UpdateRunner, *, no_download: bool = False, no_build: bool = False) -> None:
    if no_download:
        runner.emit("--no-download：使用已有 T-1 下载文件")
    else:
        runner.python_step("T-1 交件下载", "数据源/脚本/T-1/更新T-1数据源.py")
    runner.python_step("积分和管控归并", "数据源/脚本/平台管控积分/update_platform_sources.py")
    standard_started = runner.python_step("常规数据生成", "process_data.py")
    runner.check_step("常规输出校验", lambda: validate_standard(runner.root, standard_started))
    long_order_started = runner.python_step("超长单分片生成", "数据源/脚本/超长单/update_long_order.py")
    runner.check_step("超长单同步校验", lambda: validate_long_order(runner.root, long_order_started))
    if no_build:
        runner.emit("--no-build：本地数据更新完成，跳过构建")
    else:
        runner.build_step("build", "静态站点构建")
        runner.build_step("build:worker", "Worker 构建")


def run_tday(runner: UpdateRunner) -> None:
    from 数据源.脚本.T.update_tday import tday_source_freshness

    manual = runner.root / "数据源" / "数据源-手动更新"

    def check_sources():
        reasons = tday_source_freshness(manual / "交件链接清单T日.txt", manual / "T日内网轨迹.xlsx")
        if reasons:
            raise UpdateError("T 日未更新：" + "；".join(reasons))

    runner.check_step("T 日源文件检查", check_sources)
    started = runner.python_step("T 日下载", "数据源/脚本/T/download_tday.py", "--date", date.today().isoformat())
    runner.check_step("T 日下载校验", lambda: validate_tday_download(runner.root, started))
    started = runner.python_step("T 日分片生成", "数据源/脚本/T/update_tday.py", "--no-download")
    runner.check_step("T 日分片校验", lambda: validate_tday(runner.root, started))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("t1", "tday"))
    parser.add_argument("--no-build", action="store_true", help="T-1 仅更新本地数据，不构建")
    parser.add_argument("--no-download", action="store_true", help="T-1 使用已有下载文件")
    parser.add_argument("--no-pause", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.mode == "tday" and (args.no_build or args.no_download):
        parser.error("--no-build 和 --no-download 仅用于 T-1")
    try:
        with UpdateRunner(PROJECT_ROOT, args.mode) as runner:
            try:
                if args.mode == "t1":
                    run_t1(runner, no_download=args.no_download, no_build=args.no_build)
                else:
                    run_tday(runner)
            except Exception as error:
                code = error.exit_code if isinstance(error, UpdateError) else 1
                runner.emit(f"更新失败：{runner.stage}；退出码 {code}；原因：{error}")
                runner.emit(f"完整日志：{runner.log_path}")
                return code
            except KeyboardInterrupt:
                runner.emit(f"更新已中断：{runner.stage}；退出码 130；日志：{runner.log_path}")
                return 130
            runner.emit(f"\n{'T-1' if args.mode == 't1' else 'T 日下载和'}更新完成；日志：{runner.log_path}")
            return 0
    except OSError as error:
        print(f"无法启动更新流程：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
