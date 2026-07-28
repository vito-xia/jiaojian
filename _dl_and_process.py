import urllib.request, openpyxl, io, os, subprocess, sys

outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "数据源", "①交件超时")
urls = [
    ("抖音_7月27日.xlsx", "http://qllgjbackend.yundasys.com:30827/api/mobile/platformFile/download?fileId=6a6801a5e4b06b86d7e8a2a7"),
    ("淘宝_7月27日.xlsx", "http://qllgjbackend.yundasys.com:30827/api/mobile/platformFile/download?fileId=6a6801bfe4b0eb11a830239b"),
]

for fname, url in urls:
    print(f"下载 {fname} ...")
    r = urllib.request.urlopen(url, timeout=60)
    wb = openpyxl.load_workbook(io.BytesIO(r.read()))
    ws = wb.active
    print(f"  源文件行数: {ws.max_row}")

    new_wb = openpyxl.Workbook()
    new_ws = new_wb.active

    max_row = min(53, ws.max_row + 1)

    for row_idx in range(1, max_row):
        for cell in ws[row_idx]:
            new_cell = new_ws.cell(row=row_idx, column=cell.column, value=cell.value)
            if cell.has_style:
                new_cell.font = openpyxl.styles.Font(
                    name=cell.font.name, size=cell.font.size, bold=cell.font.bold,
                    color=cell.font.color)
                new_cell.alignment = openpyxl.styles.Alignment(
                    horizontal=cell.alignment.horizontal,
                    vertical=cell.alignment.vertical,
                    wrap_text=cell.alignment.wrap_text)
                new_cell.fill = openpyxl.styles.PatternFill(
                    fill_type=cell.fill.fill_type,
                    fgColor=cell.fill.fgColor)
                new_cell.border = openpyxl.styles.Border(
                    left=cell.border.left, right=cell.border.right,
                    top=cell.border.top, bottom=cell.border.bottom)
                new_cell.number_format = cell.number_format

    for col_letter, dim in ws.column_dimensions.items():
        new_ws.column_dimensions[col_letter].width = dim.width

    for row_num in range(1, max_row):
        if row_num in ws.row_dimensions:
            new_ws.row_dimensions[row_num].height = ws.row_dimensions[row_num].height

    for mc in ws.merged_cells.ranges:
        if mc.min_row <= 52 and mc.max_row <= 52:
            new_ws.merge_cells(str(mc))

    fpath = os.path.join(outdir, fname)
    new_wb.save(fpath)
    print(f"  保存: {fname} (行数: {new_ws.max_row})")

print("下载完成，开始跑数据处理...")
result = subprocess.run([sys.executable, "process_data.py"], cwd=os.path.dirname(os.path.abspath(__file__)), capture_output=True, text=True)
print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr[:500])
os.remove(__file__)
