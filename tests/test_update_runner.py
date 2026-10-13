import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

from 数据源.脚本 import run_update as flow
from test_platform_sources import fixture, save_book
from test_t1_template import make_source


ROOT = Path(__file__).resolve().parents[1]
PROGRAMS = (
    "process_data.py", "数据源/脚本/run_update.py",
    "数据源/脚本/T-1/更新T-1数据源.py",
    "数据源/脚本/平台管控积分/update_platform_sources.py",
    "数据源/脚本/超长单/update_long_order.py",
    "数据源/脚本/T/download_tday.py", "数据源/脚本/T/update_tday.py",
    "数据源/更新T-1数据源.bat", "数据源/更新T日数据.bat",
)


def setup_project(root):
    for name in PROGRAMS:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    _, _, _, _ = fixture(root)
    manual = root / "数据源/数据源-手动更新"
    save_book(manual / "③网点归属表.xlsx", [("Sheet1", [f"列{i}" for i in range(12)], [
        [None, "000001", "网点甲", "甲", "直营网点", None, "000001", "网点甲", None, "大区", None, "省区"],
    ])])
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "TOP客户累计改善清单"
    sheet.append(["上榜日期", "分部名称", "客户名称", "客户编码", "平台", "上榜次数"] + ["抖音"] * 4 + ["淘天"] * 4)
    sheet.append([None] * 6 + ["24H", "36H", "36H", "48H"] * 2)
    sheet.append([None] * 6 + ["票件量", "超时量", "超时率", "超时量"] * 2)
    sheet.append(["2026-10-07", "网点甲", "客户甲", "0001", "抖音", 1] + [3, 2, 1, 1] * 2)
    workbook.save(manual / "②揽收环节上榜管控清单.xlsx")
    workbook.close()
    source = manual / "超长单-手动更新"
    source.mkdir()
    for day, count in ((6, 5), (7, 9)):
        save_book(source / f"10月{day}日.xlsx", [("列表数据", [
            "省份", "城市", "网点", "超长单异常运单数", "超长单应签运单总数",
            "超长单异常率", "超长单异常率-异常等级",
        ], [["省", "市", "网点甲", count, 100, count / 100, "无异常"],
            ["省", "市", "网点乙", 0 if day == 6 else None, 100, 0, "无异常"]])])
    return manual


@contextlib.contextmanager
def download_server():
    requests = []
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            if self.path == "/fail":
                self.send_error(503)
                return
            if self.path == "/t1":
                payload = make_source(3)
            else:
                workbook = Workbook()
                workbook.active.append(["备注"])
                workbook.active.append(["没有客户补充也允许生成 T 日"])
                buffer = io.BytesIO()
                workbook.save(buffer)
                workbook.close()
                payload = buffer.getvalue()
            self.send_response(200)
            self.send_header("Content-Disposition", 'attachment; filename="fixture.xlsx"')
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def run_entry(root, mode, *args, relative=False):
    environment = os.environ.copy()
    environment.update(PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + environment.get("PATH", "")
    if os.name == "nt":
        entry = "数据源/更新T-1数据源.bat" if mode == "t1" else "数据源/更新T日数据.bat"
        command = ["cmd.exe", "/d", "/c", str(Path(entry) if relative else root / entry), *args, "--no-pause"]
    else:
        command = [sys.executable, "-B", str(root / "数据源/脚本/run_update.py"), mode, *args]
    return subprocess.run(command, cwd=root if relative else root.parent, env=environment,
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)


def setup_tday(manual, url, *, malformed=False):
    (manual / "交件链接清单T日.txt").write_text(url + "\n", encoding="utf-8")
    now = datetime.now().replace(microsecond=0)
    trace = manual / "T日内网轨迹.xlsx"
    if malformed:
        save_book(trace, [("Sheet1", ["错误字段"], [["不符合模板"]])])
    else:
        save_book(trace, [("Sheet1", [
            "运单号", "第一条揽收时间", "第一条分拨扫描时间", "第一条揽收网点名称",
            "录单全部来源", "最新状态", "第一条异常记录时间",
        ], [["WB1", now - timedelta(hours=60), None, "网点甲", "抖音", "运输中", None],
            ["WB2", now - timedelta(hours=50), None, "网点甲", "淘宝", "始发退回", now - timedelta(hours=10)]])])
    return trace


class UpdateRunnerIntegrationTests(unittest.TestCase):
    def test_t1_two_launch_styles_repeat_flags_real_download_and_generators(self):
        with tempfile.TemporaryDirectory() as temporary, download_server() as (url, requests):
            root = Path(temporary) / "中文 临时项目"
            manual = setup_project(root)
            (manual / "交件链接清单T-1日.txt").write_text(f"抖音_10月7日.xlsx {url}/t1\n", encoding="utf-8")
            result = run_entry(root, "t1", "--no-build")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            payload = flow.read_chunk(root / "data/dashboard_long_order.js", "long-order")
            self.assertEqual(payload["long_order_meta"]["source_dates"], ["2026-10-06", "2026-10-07"])
            self.assertEqual(payload["long_order_trends"]["网点甲"][-1]["top10_streak"], 2)
            first = json.loads((root / "data/dashboard_data.json").read_text(encoding="utf-8"))
            report = json.loads((root / "data/data_quality_report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["as_of"], "2026-10-07")
            self.assertEqual(report["long_order_source"]["branch_day_rows"], 4)
            result = run_entry(root, "t1", "--no-download", "--no-build", relative=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            second = json.loads((root / "data/dashboard_data.json").read_text(encoding="utf-8"))
            for data in (first, second):
                data["meta"].pop("generated_at")
                data["meta"].pop("asset_version")
            self.assertEqual(first, second)
            self.assertEqual(requests, ["/t1"])
            logs = list((root / "数据源/脚本处理后输出/更新日志").glob("*.log"))
            self.assertEqual(len(logs), 2)
            self.assertIn("超长单校验通过", logs[-1].read_text(encoding="utf-8"))
            if shutil.which("npm.cmd" if os.name == "nt" else "npm"):
                scripts = {name: 'node -e "require(\'fs\').appendFileSync(\'build_calls.txt\',\'' + value + '\\n\')"'
                           for name, value in (("build", "static"), ("build:worker", "worker"))}
                (root / "package.json").write_text(json.dumps({"scripts": scripts}), encoding="utf-8")
                result = run_entry(root, "t1", "--no-download", relative=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual((root / "build_calls.txt").read_text().splitlines(), ["static", "worker"])

    def test_tday_combined_download_and_generation_optional_metadata_repeat(self):
        with tempfile.TemporaryDirectory() as temporary, download_server() as (url, requests):
            root = Path(temporary) / "中文 临时项目"
            manual = setup_project(root)
            setup_tday(manual, url + "/tday")
            for relative in (False, True):
                result = run_entry(root, "tday", relative=relative)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                payload = flow.read_chunk(root / "data/dashboard_tday.js", "tday")["t_day"]
                self.assertEqual(payload["date"], datetime.now().date().isoformat())
                self.assertEqual(payload["source_status"], "uploaded")
                self.assertEqual(payload["platforms"]["抖音"]["rows"][0]["branch"], "网点甲")
                self.assertEqual(payload["platforms"]["抖音"]["rows"][0]["timeout_36h"], 1)
            self.assertEqual(requests, ["/tday", "/tday"])
            self.assertEqual(len(list((root / "数据源/脚本处理后输出/交件T脚本处理后").glob("*.xlsx"))), 1)
            self.assertFalse((root / "data/dashboard_bundle.js").exists())

    def test_tday_stale_missing_and_download_failure_preserve_previous_chunk(self):
        for reason in ("stale", "missing", "download"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as temporary, download_server() as (url, requests):
                root = Path(temporary) / "中文 临时项目"
                manual = setup_project(root)
                trace = setup_tday(manual, url + ("/fail" if reason == "download" else "/tday"))
                output = root / "data/dashboard_tday.js"
                output.parent.mkdir()
                output.write_bytes(b"previous snapshot")
                destination = root / "数据源/脚本处理后输出/交件T脚本处理后"
                destination.mkdir(parents=True)
                old = destination / "previous.xlsx"
                old.write_bytes(b"previous downloaded file")
                (destination / "tday_download_manifest.json").write_text(json.dumps({"entries": [{"filename": old.name}]}), encoding="utf-8")
                if reason == "stale":
                    stamp = (datetime.now() - timedelta(days=1)).timestamp()
                    os.utime(trace, (stamp, stamp))
                elif reason == "missing":
                    trace.unlink()
                result = run_entry(root, "tday")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("更新完成", result.stdout)
                self.assertIn("更新失败", result.stdout)
                self.assertEqual(output.read_bytes(), b"previous snapshot")
                self.assertEqual(old.read_bytes(), b"previous downloaded file")
                self.assertEqual(requests, ["/fail"] if reason == "download" else [])

    def test_tday_invalid_trace_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as temporary, download_server() as (url, _):
            root = Path(temporary) / "中文 临时项目"
            manual = setup_project(root)
            setup_tday(manual, url + "/tday", malformed=True)
            result = run_entry(root, "tday")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("invalid_format", result.stdout)
            self.assertNotIn("更新完成", result.stdout)


class UpdateRunnerFailureTests(unittest.TestCase):
    def test_every_t1_failure_stops_before_later_stages(self):
        stages = ["T-1 交件下载", "积分和管控归并", "常规数据生成", "常规输出校验",
                  "超长单分片生成", "超长单同步校验", "静态站点构建", "Worker 构建"]
        for failure in stages:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                calls = []
                def step(label, *_):
                    calls.append(label)
                    if label == failure:
                        raise flow.UpdateError("模拟阶段失败", 7)
                    return 0
                with contextlib.redirect_stdout(io.StringIO()), flow.UpdateRunner(Path(temporary), "t1") as runner:
                    with patch.object(runner, "python_step", side_effect=step), patch.object(runner, "check_step", side_effect=step), patch.object(
                        runner, "build_step", side_effect=lambda script, label: step(label)
                    ):
                        with self.assertRaises(flow.UpdateError) as caught:
                            flow.run_t1(runner)
                    self.assertEqual(caught.exception.exit_code, 7)
                self.assertEqual(calls, stages[:stages.index(failure) + 1])

    def test_child_failure_is_logged_and_not_retried(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            with flow.UpdateRunner(Path(temporary), "t1") as runner:
                runner.emit("下载错误 HTTPS://example.invalid/file?token=private")
                with self.assertRaises(flow.UpdateError) as caught:
                    runner.run_step("失败样例", [sys.executable, "-c", "import sys;print('失败原因',file=sys.stderr);sys.exit(7)"])
                self.assertEqual(caught.exception.exit_code, 7)
                log_path = runner.log_path
            log = log_path.read_text(encoding="utf-8")
            self.assertEqual(log.count("失败原因"), 1)
            self.assertIn("退出码 7", log)
            self.assertNotIn("token=private", log)
            self.assertIn("[下载链接已省略]", log)

    def test_unchanged_or_mismatched_long_order_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary, download_server() as (url, _):
            root = Path(temporary) / "项目"
            manual = setup_project(root)
            (manual / "交件链接清单T-1日.txt").write_text(f"抖音_10月7日.xlsx {url}/t1\n", encoding="utf-8")
            result = run_entry(root, "t1", "--no-build")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with self.assertRaisesRegex(flow.UpdateError, "旧文件"):
                flow.validate_long_order(root, time.time_ns())
            report_path = root / "data/data_quality_report.json"
            original = json.loads(report_path.read_text(encoding="utf-8"))
            for key, value in (("file_count", 3), ("latest_date", "2026-10-08"), ("branch_day_rows", 5)):
                with self.subTest(field=key):
                    report = json.loads(json.dumps(original))
                    report["long_order_source"][key] = value
                    report_path.write_text(json.dumps(report), encoding="utf-8")
                    with self.assertRaises(flow.UpdateError):
                        flow.validate_long_order(root, 0)


if __name__ == "__main__":
    unittest.main()
