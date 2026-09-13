"""按 T 日链接清单下载源文件，并原样保存到 T 日下载目录。

链接清单可以是一行一个 URL，也可以在 URL 前保留任意标签。脚本不猜测
平台、报表角色或日期，不改写 Excel 内容；文件名优先取服务器响应的文件名，
同名文件自动加序号。下载成功后才替换上一次由本脚本管理的快照。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime
from email.message import Message
from pathlib import Path
from typing import Any


def safe_error_message(error: Exception) -> str:
    """错误日志不输出可能带权限参数的完整 URL。"""
    return re.sub(r"https?://\S+", "[下载地址]", str(error), flags=re.IGNORECASE)


def read_link_entries(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    entries: list[dict[str, Any]] = []
    warnings: list[str] = []
    if not path.exists():
        return entries, [f"未找到链接清单：{path}"]
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        url_index = next((index for index, part in enumerate(parts) if re.match(r"https?://", part, re.IGNORECASE)), None)
        if url_index is None:
            warnings.append(f"第 {line_number} 行未找到 HTTP/HTTPS 链接")
            continue
        url = parts[url_index]
        label = " ".join(parts[:url_index]).strip()
        entries.append({"line_number": line_number, "url": url, "label": label})
    return entries, warnings


def filename_from_headers(headers: Message) -> str:
    try:
        filename = headers.get_filename() or ""
    except (AttributeError, TypeError):
        filename = ""
    if filename:
        return filename
    disposition = headers.get("Content-Disposition", "")
    match = re.search(r"filename\*\s*=\s*(?:UTF-8''|)([^;]+)", disposition, flags=re.IGNORECASE)
    if not match:
        match = re.search(r"filename\s*=\s*\"?([^\";]+)", disposition, flags=re.IGNORECASE)
    return urllib.parse.unquote(match.group(1).strip().strip('"')) if match else ""


def safe_filename(value: str, fallback: str) -> str:
    name = str(value or "").strip().replace("\\", "_").replace("/", "_")
    name = re.sub(r"[\x00-\x1f<>:\"|?*]", "_", name).strip(" .")
    return name or fallback


def url_filename(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    raw = Path(urllib.parse.unquote(parsed.path)).name
    return raw if raw and raw not in {".", ".."} else ""


def unique_filename(name: str, used: set[str]) -> str:
    candidate = name
    stem = Path(name).stem or "T日源文件"
    suffix = Path(name).suffix
    index = 2
    while candidate.casefold() in used:
        candidate = f"{stem} ({index}){suffix}"
        index += 1
    used.add(candidate.casefold())
    return candidate


def download_one(url: str, target: Path) -> tuple[str, int, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        response_name = filename_from_headers(response.headers)
        with target.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
    size = target.stat().st_size
    if size <= 0:
        raise RuntimeError("下载文件为空")
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    return response_name, size, digest


def read_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def clear_managed_files(destination: Path, manifest_path: Path) -> None:
    manifest = read_manifest(manifest_path)
    for item in manifest.get("entries", []):
        name = item.get("filename") if isinstance(item, dict) else None
        if not name:
            continue
        candidate = (destination / str(name)).resolve()
        if candidate.parent != destination.resolve():
            continue
        try:
            candidate.unlink()
        except FileNotFoundError:
            pass


def install_snapshot(staging: Path, destination: Path, manifest: dict[str, Any]) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    manifest_path = destination / "tday_download_manifest.json"
    clear_managed_files(destination, manifest_path)
    for item in manifest["entries"]:
        source = staging / item["staged_filename"]
        target = destination / item["filename"]
        shutil.move(str(source), str(target))
        item.pop("staged_filename", None)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    base_dir = Path(__file__).resolve().parents[3]
    data_source_dir = base_dir / "数据源"
    manual_source_dir = data_source_dir / "数据源-手动更新"
    parser = argparse.ArgumentParser(description="按链接清单下载 T 日源文件")
    parser.add_argument("--link-file", type=Path, default=manual_source_dir / "交件链接清单T日.txt")
    parser.add_argument("--destination", type=Path, default=data_source_dir / "脚本处理后输出" / "交件T脚本处理后")
    parser.add_argument("--date", help="记录到清单中的目标日期，不过滤链接")
    args = parser.parse_args()

    entries, warnings = read_link_entries(args.link_file)
    for warning in warnings:
        print(f"提示：{warning}")
    if not entries:
        print("没有可下载的链接，未替换现有快照。")
        return 2

    args.destination.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".tday-download-", dir=args.destination.parent))
    used_names: set[str] = set()
    results: list[dict[str, Any]] = []
    failed = False
    try:
        for index, entry in enumerate(entries, 1):
            provisional = staging / f"source_{index:03d}.xlsx"
            try:
                response_name, size, digest = download_one(entry["url"], provisional)
                filename = safe_filename(response_name or url_filename(entry["url"]), f"T日源文件_{index:03d}.xlsx")
                filename = unique_filename(filename, used_names)
                results.append({
                    "line_number": entry["line_number"],
                    "label": entry["label"],
                    "filename": filename,
                    "staged_filename": f"source_{index:03d}.xlsx",
                    "bytes": size,
                    "sha256": digest,
                    "status": "downloaded",
                })
                print(f"已下载第 {entry['line_number']} 条链接：{filename}")
            except Exception as error:
                failed = True
                results.append({
                    "line_number": entry["line_number"],
                    "label": entry["label"],
                    "status": "failed",
                    "error": safe_error_message(error),
                })
                print(f"第 {entry['line_number']} 条链接下载失败：{safe_error_message(error)}")
        if failed:
            print("存在下载失败，未替换上一次成功快照。")
            return 3
        manifest = {
            "schema_version": 1,
            "downloaded_at": datetime.now().replace(microsecond=0).isoformat(sep=" "),
            "date": args.date or datetime.now().date().isoformat(),
            "source_link_count": len(entries),
            "entries": results,
        }
        install_snapshot(staging, args.destination, manifest)
        print(f"T 日源文件下载完成：{len(results)} 个文件 -> {args.destination}")
        return 0
    finally:
        shutil.rmtree(staging, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
