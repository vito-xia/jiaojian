# -*- coding: utf-8 -*-
"""
交件超时数据源更新工具
双击运行：读取「数据源-手动更新/交件链接清单T-1日.txt」中的下载链接，
逐个下载并按原格式保留前200行（含表头）保存到 T-1 处理后目录。
看板刷新由可见的 BAT 入口统一编排，避免 Python 和 BAT 重复执行。
"""
import io
import urllib.request
from pathlib import Path
import openpyxl
import warnings

warnings.filterwarnings("ignore")

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_SOURCE_DIR = PROJECT_ROOT / "数据源"
OUT_DIR = DATA_SOURCE_DIR / "脚本处理后输出" / "交件T-1脚本处理后"
LINK_FILE = DATA_SOURCE_DIR / "数据源-手动更新" / "交件链接清单T-1日.txt"
KEEP_ROWS = 200  # 保留前200行（含表头）


def read_links(file_path):
    """解析链接清单：每行「文件名.xlsx 链接」或「平台 日期 链接」"""
    links = []
    with open(file_path, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                print(f"  跳过无法解析的行: {line}")
                continue
            url = parts[-1]
            name_part = " ".join(parts[:-1])
            if name_part.lower().endswith(".xlsx"):
                fname = name_part
            elif len(parts) == 3:
                # 平台 日期 链接
                fname = f"{parts[0]}_{parts[1]}.xlsx"
            else:
                print(f"  跳过无法解析的行: {line}")
                continue
            links.append((fname, url))
    return links


def copy_cell_style(src, dst):
    if src.has_style:
        dst.font = openpyxl.styles.Font(
            name=src.font.name, size=src.font.size, bold=src.font.bold,
            color=src.font.color)
        dst.alignment = openpyxl.styles.Alignment(
            horizontal=src.alignment.horizontal,
            vertical=src.alignment.vertical,
            wrap_text=src.alignment.wrap_text)
        dst.fill = openpyxl.styles.PatternFill(
            fill_type=src.fill.fill_type, fgColor=src.fill.fgColor)
        dst.border = openpyxl.styles.Border(
            left=src.border.left, right=src.border.right,
            top=src.border.top, bottom=src.border.bottom)
        dst.number_format = src.number_format


def download_and_save(fname, url):
    r = urllib.request.urlopen(url, timeout=120)
    wb = openpyxl.load_workbook(io.BytesIO(r.read()))
    ws = wb.active
    new_wb = openpyxl.Workbook()
    new_ws = new_wb.active
    max_row = min(KEEP_ROWS + 1, ws.max_row + 1)
    for row_idx in range(1, max_row):
        for cell in ws[row_idx]:
            new_cell = new_ws.cell(row=row_idx, column=cell.column, value=cell.value)
            copy_cell_style(cell, new_cell)
    for col_letter, dim in ws.column_dimensions.items():
        new_ws.column_dimensions[col_letter].width = dim.width
    for row_num in range(1, max_row):
        if row_num in ws.row_dimensions:
            new_ws.row_dimensions[row_num].height = ws.row_dimensions[row_num].height
    for mc in ws.merged_cells.ranges:
        if mc.min_row <= KEEP_ROWS and mc.max_row <= KEEP_ROWS:
            new_ws.merge_cells(str(mc))
    new_wb.save(OUT_DIR / fname)
    return new_ws.max_row


def main() -> int:
    print("=" * 50)
    print("  交件超时数据源更新工具")
    print("=" * 50)
    if not LINK_FILE.is_file():
        print(f"未找到链接清单: {LINK_FILE}")
        return 2
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    links = read_links(LINK_FILE)
    if not links:
        print("链接清单中没有有效的下载链接。")
        return 2

    print(f"共 {len(links)} 个文件，每个保留前 {KEEP_ROWS} 行...\n")
    ok = fail = 0
    for i, (fname, url) in enumerate(links, 1):
        try:
            print(f"[{i}/{len(links)}] {fname} ...", end=" ", flush=True)
            rows = download_and_save(fname, url)
            print(f"OK ({rows}行)")
            ok += 1
        except Exception as e:
            print(f"FAIL: {e}")
            fail += 1

    print(f"\n下载完成: 成功 {ok}, 失败 {fail} / 共 {len(links)}")

    if fail:
        print("下载存在失败，未刷新看板数据。")
        return 1
    print("下载完成，等待 BAT 入口刷新看板数据。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
