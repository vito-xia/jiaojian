"""构建并更新已有的妙搭 HTML 应用；--check 只检查本地，不上传。"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import urlsplit


APP_ID = "app_17ghhftvq0h"
ROOT = Path(__file__).resolve().parent.parent
HTML_LIMIT = 10 * 1024 * 1024
ARCHIVE_LIMIT = 20 * 1024 * 1024
TOTAL_LIMIT = 200 * 1024 * 1024
POLL_SECONDS = 20
RELEASE_TIMEOUT = 300


class PublishError(RuntimeError):
    pass


def find_tool(name):
    tool = shutil.which(name + ".cmd" if os.name == "nt" else name)
    if not tool:
        raise PublishError(f"找不到 {name}，请先安装并将其加入 PATH。")
    return tool


def find_cli(explicit=None):
    if explicit:
        path = Path(explicit).expanduser()
        cli = str(path.resolve()) if path.is_file() else shutil.which(explicit)
        if not cli:
            raise PublishError(f"指定的 lark-cli 不存在：{explicit}")
        return cli
    # Doubao ships a newer CLI separately from the npm installation on PATH.
    if os.name == "nt":
        appdata = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        candidates = list((appdata / "LarkShell" / "aha").glob(
            "users/*/doubao/sandbox_envs_dir/envs/*/override_dlcs/lark-cli.exe"
        ))
        candidates = [path for path in candidates if path.is_file()]
        if candidates:
            return str(max(candidates, key=lambda path: (path.stat().st_mtime_ns, str(path))))
    return shutil.which("lark-cli.exe") or find_tool("lark-cli")


def cli_publish_action(cli):
    result = subprocess.run(
        [cli, "apps", "--help"], capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=30,
    )
    if result.returncode:
        raise PublishError("无法读取 lark-cli apps --help，请检查所选 CLI 是否可运行。")
    commands = set(re.findall(r"^\s+(\+[\w-]+)\s+", result.stdout, re.MULTILINE))
    if not {"+get", "+release-get"}.issubset(commands):
        raise PublishError("所选 CLI 缺少应用或发布状态查询命令，无法确认发布结果。")
    if "+deploy" in commands:
        return "+deploy"
    if "+html-publish" in commands:
        return "+html-publish"
    raise PublishError("所选 CLI 不支持目录发布；需要 apps +deploy 或 +html-publish。")


def check_project(root):
    for relative in (
        "package.json", "build.mjs", "dashboard.html", "assets/dashboard.css",
        "assets/dashboard.js", "assets/dashboard-loader.js", "data/dashboard_bundle.js",
    ):
        if not (root / relative).is_file():
            raise PublishError(f"缺少项目文件：{relative}。请保留脚本与项目的目录关系。")
    package = json.loads((root / "package.json").read_text(encoding="utf-8-sig"))
    if not package.get("scripts", {}).get("build"):
        raise PublishError("package.json 未配置 build 命令。")


def check_dist(dist):
    if not (dist / "index.html").is_file():
        raise PublishError("构建产物缺少 dist/index.html，停止发布。")
    files = sorted(p for p in dist.rglob("*") if ".git" not in p.relative_to(dist).parts)
    if any(p.is_symlink() for p in files):
        raise PublishError("dist 含符号链接，请先检查构建产物。")
    files = [p for p in files if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    largest_html = max((p.stat().st_size for p in files if p.suffix.lower() == ".html"), default=0)
    if largest_html > HTML_LIMIT or total > TOTAL_LIMIT:
        raise PublishError(
            f"发布体积超限：最大 HTML {largest_html:,} 字节（上限 {HTML_LIMIT:,}），"
            f"总量 {total:,} 字节（上限 {TOTAL_LIMIT:,}）。"
        )
    with tempfile.TemporaryFile() as package:
        with tarfile.open(fileobj=package, mode="w:gz", compresslevel=6) as archive:
            for path in files:
                archive.add(path, arcname=path.relative_to(dist).as_posix(), recursive=False)
        compressed = package.tell()
    if compressed > ARCHIVE_LIMIT:
        raise PublishError(f"预检压缩包 {compressed:,} 字节，超过 {ARCHIVE_LIMIT:,} 字节上限。")
    print(f"[体积] {len(files)} 个文件；总量 {total:,} 字节；预检压缩包 {compressed:,} 字节。")


def cli_data(cli, root, action, *args):
    environment = dict(os.environ)
    environment["LARKSUITE_CLI_NO_UPDATE_NOTIFIER"] = "1"
    environment["LARKSUITE_CLI_NO_SKILLS_NOTIFIER"] = "1"
    result = subprocess.run(
        [cli, "apps", action, "--app-id", APP_ID, *args, "--as", "user", "--format", "json"],
        cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=300 if action in {"+deploy", "+html-publish"} else 120, env=environment,
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = None
    if result.returncode or not isinstance(payload, dict) or payload.get("ok") is not True:
        error = payload.get("error", {}) if isinstance(payload, dict) else {}
        # CLI 失败时也可能把 JSON 写在 stderr。
        if not error:
            try:
                failure = json.loads(result.stderr)
                if isinstance(failure, dict):
                    error = failure.get("error", {})
            except json.JSONDecodeError:
                pass
        detail = "；".join(str(error[key]) for key in ("message", "hint") if error.get(key)) if isinstance(error, dict) else None
        raise PublishError(
            f"飞书 {action} 失败：{detail or '命令未返回有效的成功结果，请检查 CLI 环境和授权。'}\n"
            "如授权不足，请在已授权的终端或豆包工作执行；脚本不会自动重新授权。"
        )
    data = payload.get("data")
    if not isinstance(data, dict):
        raise PublishError(f"飞书 {action} 返回的数据格式不完整，无法确认结果。")
    return data


def require_html_app(data):
    app = data.get("app", {})
    if app.get("app_id") != APP_ID:
        raise PublishError("应用详情中的 app_id 不匹配，停止发布。")
    if app.get("app_type") != "HTML":
        raise PublishError(
            f"应用类型为 {app.get('app_type') or '未知'}，无法使用旧版 HTML 目录上传。\n"
            "MODERN_HTML/FULL_STACK 必须在该应用已关联的 Git 工程同步产物、提交推送，"
            "再通过 apps +release-create 发布；请交给该应用的已授权维护工具处理。"
        )


def valid_url(value):
    if not isinstance(value, str):
        return False
    url = urlsplit(value)
    return url.scheme == "https" and bool(url.netloc) and not any(c.isspace() for c in value)


def wait_for_release(cli, root, release_id):
    deadline = time.monotonic() + RELEASE_TIMEOUT
    while True:
        data = cli_data(cli, root, "+release-get", "--release-id", release_id)
        release = data.get("release", data)
        status = release.get("status")
        if status == "finished":
            url = release.get("online_url")
            if not valid_url(url):
                raise PublishError("发布状态已完成，但未返回有效的 online_url，请人工核对该发布记录。")
            return url
        if status == "failed":
            logs = release.get("error_logs") or "请在妙搭检查该发布记录。"
            raise PublishError(f"云端发布失败：{logs}")
        if status != "publishing":
            raise PublishError(f"无法识别发布状态 {status!r}，请核对发布记录 {release_id}。")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise PublishError(f"等待发布超时，状态尚未确认；请核对发布记录 {release_id}，勿直接重传。")
        print(f"[等待] 发布记录 {release_id} 仍在处理……", flush=True)
        time.sleep(min(POLL_SECONDS, remaining))


def publish(root, npm, cli, action):
    print("[1/4] 核对飞书授权与目标应用类型……", flush=True)
    app_data = cli_data(cli, root, "+get")
    if app_data.get("app", {}).get("app_id") != APP_ID:
        raise PublishError("应用详情中的 app_id 不匹配，停止发布。")
    if action == "+html-publish":
        require_html_app(app_data)
    print("[2/4] 重新构建静态站点……", flush=True)
    result = subprocess.run([npm, "run", "build"], cwd=root)
    if result.returncode:
        raise PublishError(f"构建失败（退出码 {result.returncode}），停止上传。")
    check_dist(root / "dist")
    print("[3/4] 上传完整 dist 到已有妙搭应用……", flush=True)
    path_flag = "--dir" if action == "+deploy" else "--path"
    data = cli_data(cli, root, action, path_flag, "./dist")
    release_id = data.get("release_id")
    if isinstance(release_id, str) and release_id:
        print(f"[4/4] 确认发布记录 {release_id}……", flush=True)
        url = wait_for_release(cli, root, release_id)
    else:
        # 部分旧版 HTML 应用同步返回 url；只接受本次上传的直接结果。
        url = data.get("url") or data.get("online_url")
        if not valid_url(url):
            raise PublishError("上传未返回 release_id 或有效访问地址，无法确认发布成功，请人工核对。")
    print(f"[成功] 本次发布已完成。\n访问地址：{url}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="仅检查本地环境与已有 dist，不构建、不访问云端")
    parser.add_argument("--no-pause", action="store_true", help="供 BAT 使用：退出前不暂停")
    parser.add_argument("--cli", help="指定 lark-cli 的完整路径；默认优先使用豆包附带的 CLI")
    args = parser.parse_args(argv)
    try:
        check_project(ROOT)
        npm, cli = find_tool("npm"), find_cli(args.cli)
        action = cli_publish_action(cli)
        print(f"项目目录：{ROOT}\n目标应用：{APP_ID}\n使用 CLI：{cli}\n发布命令：apps {action}")
        if args.check:
            if (ROOT / "dist").exists():
                check_dist(ROOT / "dist")
            else:
                print("[提示] 尚无 dist，正式执行时将重新构建。")
            print("[检查通过] 本地环境可用；未构建、未访问云端。应用类型、授权和发布结果须在正式执行时确认。")
        else:
            publish(ROOT, npm, cli, action)
        return 0
    except (PublishError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"[失败] {error}", file=sys.stderr)
        print("本次流程未确认发布成功。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
