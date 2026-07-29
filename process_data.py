"""交件超时看板离线数据处理工具。

读取项目“数据源”目录下的五类 Excel，生成可直接双击打开的静态看板数据。
运行：python process_data.py [--as-of 2026-07-26]
"""
from __future__ import annotations

import argparse
import json
import posixpath
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import ZipFile

from openpyxl import load_workbook
from openpyxl.utils.datetime import from_excel

PLATFORM_ALIAS = {"淘天": "淘宝"}
PLATFORMS = ("抖音", "淘宝", "京东", "快手")
SCORE_SCENES = {"物流停滞-揽收端", "物流停滞-全链路"}
CONTROL_ACTIONS = {"揽收能力预警", "限制面单新签", "限制面单取号"}
ACTION_SEVERITY = {"揽收能力预警": 1, "限制面单新签": 2, "限制面单取号": 3}
EXCLUDED_CUSTOMER_KEYWORDS = ("温宿韵通达", "新疆", "北亩")
EMPTY_DETAIL_VALUES = {"", "-", "--", "—", "/", "无", "暂无"}


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return re.sub(r"\s+", " ", str(value)).strip()


def number(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(str(value).replace(",", "").replace("%", ""))
    except (TypeError, ValueError):
        return 0.0


def percentage_points(value: Any) -> float:
    amount = number(value)
    if isinstance(value, (int, float)) and 0 < abs(amount) <= 1:
        amount *= 100
    return round(amount, 4)

def integer(value: Any) -> int:
    return int(round(number(value)))


def customer_is_excluded(customer_name: Any) -> bool:
    name = text(customer_name)
    return any(keyword in name for keyword in EXCLUDED_CUSTOMER_KEYWORDS)


def has_detail(value: Any) -> bool:
    return text(value) not in EMPTY_DETAIL_VALUES


def excel_column_number(letters: str) -> int:
    result = 0
    for character in letters.upper():
        result = result * 26 + ord(character) - ord("A") + 1
    return result


def merged_reason_action_rows(path: Path, sheet_name: str) -> set[int]:
    main_namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    office_relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    package_relationships = "http://schemas.openxmlformats.org/package/2006/relationships"
    with ZipFile(path) as archive:
        workbook_root = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        relationships_root = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        sheet = next(
            node for node in workbook_root.findall(f".//{{{main_namespace}}}sheet")
            if node.attrib.get("name") == sheet_name
        )
        relationship_id = sheet.attrib[f"{{{office_relationships}}}id"]
        relationship = next(
            node for node in relationships_root.findall(f".//{{{package_relationships}}}Relationship")
            if node.attrib.get("Id") == relationship_id
        )
        target = relationship.attrib["Target"]
        sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(f"xl/{target}")
        sheet_root = ElementTree.fromstring(archive.read(sheet_path))

    merged_rows: set[int] = set()
    for cell_range in sheet_root.findall(f".//{{{main_namespace}}}mergeCell"):
        reference = cell_range.attrib.get("ref", "")
        match = re.fullmatch(r"([A-Z]+)(\d+):([A-Z]+)(\d+)", reference)
        if not match:
            continue
        start_column = excel_column_number(match.group(1))
        end_column = excel_column_number(match.group(3))
        if start_column > 20 or end_column < 21:
            continue
        merged_rows.update(range(int(match.group(2)), int(match.group(4)) + 1))
    return merged_rows

def date_text(value: Any, epoch=None, default_year: int | None = None) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        try:
            return from_excel(value, epoch).date().isoformat()
        except (TypeError, ValueError, OverflowError):
            return ""
    raw = text(value)
    if re.fullmatch(r"\d+(\.0)?", raw) and epoch is not None:
        try:
            return from_excel(float(raw), epoch).date().isoformat()
        except (TypeError, ValueError, OverflowError):
            pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(raw[:10], fmt).date().isoformat()
        except ValueError:
            pass
    match = re.search(r"(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日", raw)
    if match and (match.group(1) or default_year):
        return date(int(match.group(1) if match.group(1) else default_year), int(match.group(2)), int(match.group(3))).isoformat()
    return ""


def iso_day(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def write_json(path: Path, payload: Any, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2 if pretty else None, separators=None if pretty else (",", ":"))
        handle.write("\n")
    tmp.replace(path)


def locate(data_dir: Path, prefix: str) -> Path:
    matches = sorted(data_dir.glob(f"{prefix}*.xlsx"))
    if len(matches) != 1:
        raise FileNotFoundError(f"期望找到 1 个 {prefix}*.xlsx，实际找到 {len(matches)} 个")
    return matches[0]


def read_timeout(data_dir: Path, year: int) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    platform_pattern = "|".join(re.escape(platform) for platform in PLATFORMS)
    for path in sorted((data_dir / "①交件超时").glob("*.xlsx")):
        match = re.match(rf"({platform_pattern})_(\d{{1,2}})月(\d{{1,2}})日\.xlsx$", path.name)
        if not match or path.name.startswith("~$"):
            continue
        platform, month, day = match.groups()
        record_date = date(year, int(month), int(day)).isoformat()
        workbook = load_workbook(path, read_only=True, data_only=True)
        sheet = workbook.active
        for row in sheet.iter_rows(min_row=3, values_only=True):
            if not row or text(row[1] if len(row) > 1 else "") in ("", "合计"):
                continue
            records.append({
                "platform": platform,
                "date": record_date,
                "branch": text(row[1]),
                "customer": text(row[2]),
                "customer_code": text(row[3]),
                "has_shipping_fallback": text(row[4]),
                "has_history_no_goods": text(row[5]),
                "timeout_24h": integer(row[6]),
                "timeout_36h": integer(row[7]),
                "timeout_rate_36h": round(number(row[8]), 4),
                "timeout_48h": integer(row[9]),
                "timeout_72h": integer(row[10]),
                "timeout_96h": integer(row[11]),
                "timeout_120h": integer(row[12]),
            })
        workbook.close()
    return records


def read_top5(data_dir: Path, year: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    path = locate(data_dir, "②")
    merged_tu_rows = merged_reason_action_rows(path, "TOP客户累计改善清单")
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook["TOP客户累计改善清单"]
    records, branch_top5_rows, bad_dates = [], [], 0
    platform_columns = {
        "抖音": {"timeout_24h": 11, "timeout_36h": 12, "timeout_rate_36h": 13, "timeout_48h": 14},
        "淘宝": {"timeout_24h": 15, "timeout_36h": 16, "timeout_rate_36h": 17, "timeout_48h": 18},
    }
    for row_number, row in enumerate(sheet.iter_rows(min_row=10, values_only=True), start=10):
        if not row or row[1] in (None, ""):
            continue
        parsed_date = date_text(row[1], workbook.epoch, year)
        if not parsed_date:
            bad_dates += 1
            continue
        source_platform = PLATFORM_ALIAS.get(text(row[9]), text(row[9]))
        reason = text(row[19])
        action = text(row[20])
        base = {
            "date": parsed_date,
            "branch": text(row[3]),
            "customer": text(row[5]),
            "customer_code": text(row[6]),
            "has_shipping_fallback": text(row[7]),
            "source_platform": source_platform,
            "ranking_count": integer(row[10]),
        }
        if source_platform in platform_columns:
            columns = platform_columns[source_platform]
            branch_top5_rows.append({
                **base,
                "source_row": row_number,
                "platform": source_platform,
                "timeout_36h": integer(row[columns["timeout_36h"]]),
                "timeout_rate_36h": percentage_points(row[columns["timeout_rate_36h"]]),
                "reason": reason,
                "action": action,
                "feedback_merged": row_number in merged_tu_rows,
            })
        for platform, columns in platform_columns.items():
            timeout_36h = integer(row[columns["timeout_36h"]])
            if timeout_36h <= 0:
                continue
            records.append({
                **base,
                "platform": platform,
                "timeout_24h": integer(row[columns["timeout_24h"]]),
                "timeout_36h": timeout_36h,
                "timeout_rate_36h": percentage_points(row[columns["timeout_rate_36h"]]),
                "timeout_48h": integer(row[columns["timeout_48h"]]),
            })
    workbook.close()
    return records, branch_top5_rows, bad_dates

def read_mapping(data_dir: Path) -> dict[str, dict[str, str]]:
    path = locate(data_dir, "③")
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    mapping = {}
    for row in sheet.iter_rows(min_row=2, values_only=True):
        branch = text(row[2] if len(row) > 2 else "")
        if not branch:
            continue
        parent = text(row[7] if len(row) > 7 else "") or branch
        mapping[branch] = {
            "code": text(row[1]), "branch": branch, "short_name": text(row[3]),
            "nature": text(row[4]), "parent_code": text(row[6]), "parent_name": parent,
            "region": text(row[9]), "province": text(row[11]),
        }
    workbook.close()
    return mapping


def parse_cumulative_score(raw: Any) -> float:
    value = text(raw)
    total = 0.0
    for scene in SCORE_SCENES:
        match = re.search(re.escape(scene) + r"[：:]\s*(-?\d+(?:\.\d+)?)", value)
        if match:
            total += float(match.group(1))
    return total


def read_scores(data_dir: Path) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    path = locate(data_dir, "④")
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    records = []
    daily: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cumulative: dict[str, dict[str, float]] = defaultdict(dict)
    for row in sheet.iter_rows(min_row=2, values_only=True):
        branch, scene = text(row[0]), text(row[9])
        violation_date = date_text(row[16], workbook.epoch)
        if not branch or not violation_date:
            continue
        current = number(row[14])
        snapshot = parse_cumulative_score(row[15])
        records.append({"branch": branch, "scene": scene, "date": violation_date, "current_score": current, "cumulative_stagnant_score": snapshot})
        if scene in SCORE_SCENES:
            daily[branch][violation_date] += current
            cumulative[branch][violation_date] = max(cumulative[branch].get(violation_date, 0), snapshot)
    workbook.close()
    return records, {b: dict(v) for b, v in daily.items()}, {b: dict(v) for b, v in cumulative.items()}


def read_controls(data_dir: Path) -> list[dict[str, Any]]:
    path = locate(data_dir, "⑤")
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    records = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        merchant_id = text(row[5])
        records.append({
            "control_id": text(row[0]), "branch_code": text(row[1]), "branch": text(row[2]),
            "merchant_id": merchant_id, "merchant_name": text(row[6]), "violation_scene": text(row[7]),
            "control_status": text(row[8]), "control_action": text(row[9]),
            "start_date": date_text(row[10], workbook.epoch), "end_date": date_text(row[11], workbook.epoch),
            "control_mechanism": text(row[12]), "control_category": text(row[13]),
            "is_branch_level": not bool(merchant_id), "is_merchant_level": bool(merchant_id),
        })
    workbook.close()
    return records


def parent_of(branch: str, mapping: dict[str, dict[str, str]]) -> str:
    return mapping.get(branch, {}).get("parent_name") or branch


def build_shortage_history(top5: list[dict[str, Any]], mapping: dict[str, dict[str, str]]) -> dict[str, dict[str, Any]]:
    work: dict[tuple[str, str], dict[str, Any]] = defaultdict(lambda: {"months": defaultdict(set), "branches": set(), "customers": set()})
    for row in top5:
        parent = parent_of(row["branch"], mapping)
        bucket = work[(row["platform"], parent)]
        bucket["months"][row["date"][:7]].add(row["date"])
        bucket["branches"].add(row["branch"])
        bucket["customers"].add(row["customer"])
    result: dict[str, dict[str, Any]] = {p: {} for p in PLATFORMS}
    for (platform, parent), bucket in work.items():
        result[platform][parent] = {
            "months": [{"month": month, "days": len(days)} for month, days in sorted(bucket["months"].items())],
            "branches": sorted(bucket["branches"]), "customer_count": len(bucket["customers"]),
        }
    return result


def build_shortage_history_all(top5: list[dict[str, Any]], mapping: dict[str, dict[str, str]]) -> dict[str, dict[str, Any]]:
    work: dict[str, dict[str, Any]] = defaultdict(lambda: {"months": defaultdict(set), "branches": set(), "customers": set()})
    for row in top5:
        parent = parent_of(row["branch"], mapping)
        bucket = work[parent]
        bucket["months"][row["date"][:7]].add(row["date"])
        bucket["branches"].add(row["branch"])
        bucket["customers"].add(row["customer"])
    return {
        parent: {
            "months": [{"month": month, "days": len(days)} for month, days in sorted(bucket["months"].items())],
            "branches": sorted(bucket["branches"]),
            "customer_count": len(bucket["customers"]),
        }
        for parent, bucket in work.items()
    }


def build_branch_top5_data(branch_top5_rows: list[dict[str, Any]]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    result: dict[str, dict[str, list[dict[str, Any]]]] = {
        "抖音": defaultdict(list),
        "淘宝": defaultdict(list),
    }
    for row in branch_top5_rows:
        platform = row["platform"]
        branch = row["branch"]
        if platform in result and branch:
            result[platform][branch].append(row)
    return {
        platform: {
            branch: sorted(rows, key=lambda row: (row["date"], row["source_row"]), reverse=True)
            for branch, rows in sorted(by_branch.items())
        }
        for platform, by_branch in result.items()
    }

def clearout_type(mechanism: str) -> str:
    if "熔断制" in mechanism:
        return "熔断制"
    if "积分制" in mechanism:
        return "积分制"
    return mechanism or "未知"


def build_control_index(controls: list[dict[str, Any]], mapping: dict[str, dict[str, str]], as_of: str):
    relevant = [r for r in controls if not r["start_date"] or r["start_date"] <= as_of]
    current_by_branch: dict[str, list[dict[str, Any]]] = defaultdict(list)
    merchant_executing = Counter()
    clearouts = []
    for row in relevant:
        executing = "执行中" in row["control_status"]
        if row["is_branch_level"] and executing and row["control_action"] in CONTROL_ACTIONS:
            current_by_branch[row["branch"]].append(row)
        if row["is_merchant_level"] and executing:
            merchant_executing[row["branch"]] += 1
        if row["is_branch_level"] and row["control_action"] == "限制面单取号" and ("执行中" in row["control_status"] or row["control_status"] == "已完结"):
            clearouts.append(row)
    current = {}
    for branch, rows in current_by_branch.items():
        best = max(rows, key=lambda r: (ACTION_SEVERITY.get(r["control_action"], 0), r["start_date"]))
        current[branch] = {"action": best["control_action"], "status": best["control_status"], "start_date": best["start_date"]}
    parent_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    branch_counts = Counter()
    for row in clearouts:
        parent_rows[parent_of(row["branch"], mapping)].append(row)
        branch_counts[row["branch"]] += 1
    parent_info = {}
    for parent, rows in parent_rows.items():
        latest = max(rows, key=lambda r: (r["start_date"], r["control_id"]))
        parent_info[parent] = {"count": len(rows), "last_date": latest["start_date"], "last_type": clearout_type(latest["control_mechanism"])}
    return current, dict(merchant_executing), parent_info, dict(branch_counts), clearouts


def build_score_calculator(daily_scores: dict[str, dict[str, float]]):
    cache: dict[tuple[str, str], float] = {}
    def rolling(branch: str, end_day: str) -> float:
        key = (branch, end_day)
        if key not in cache:
            end = iso_day(end_day)
            start = end - timedelta(days=15)
            cache[key] = sum(value for day, value in daily_scores.get(branch, {}).items() if start <= iso_day(day) <= end)
        return round(cache[key], 2)
    return rolling


def build_trends(timeout_rows: list[dict[str, Any]], mapping: dict[str, dict[str, str]]) -> dict[str, dict[str, Any]]:
    work: dict[str, dict[str, dict[str, Any]]] = {p: defaultdict(dict) for p in PLATFORMS}
    for row in timeout_rows:
        branch_box = work[row["platform"]][row["branch"]]
        customer_box = branch_box.setdefault(row["customer"], {
            "customer": row["customer"], "customer_code": row["customer_code"],
            "has_shipping_fallback": row["has_shipping_fallback"], "series": [], "total_36h": 0,
        })
        point = {k: row[k] for k in ("date", "timeout_24h", "timeout_36h", "timeout_rate_36h", "timeout_48h", "timeout_72h", "timeout_96h", "timeout_120h")}
        customer_box["series"].append(point)
        customer_box["total_36h"] += row["timeout_36h"]
    result = {p: {} for p in PLATFORMS}
    for platform in PLATFORMS:
        for branch, customers in work[platform].items():
            items = list(customers.values())
            for item in items:
                item["series"].sort(key=lambda row: row["date"])
            items.sort(key=lambda item: (-item["total_36h"], item["customer"]))
            result[platform][branch] = {"parent_name": parent_of(branch, mapping), "customers": items}
    return result


def build_dashboard(timeout_rows, top5, branch_top5_rows, mapping, score_rows, daily_scores, cumulative_scores, controls, as_of: str, bad_top5_dates: int):
    raw_timeout_count = len(timeout_rows)
    raw_top5_count = len(top5)
    timeout_rows = [row for row in timeout_rows if not customer_is_excluded(row["customer"])]
    top5 = [row for row in top5 if not customer_is_excluded(row["customer"])]
    branch_top5_rows = [row for row in branch_top5_rows if not customer_is_excluded(row["customer"])]
    excluded_timeout_count = raw_timeout_count - len(timeout_rows)
    excluded_top5_count = raw_top5_count - len(top5)
    dates_by_platform = {p: sorted({r["date"] for r in timeout_rows if r["platform"] == p}) for p in PLATFORMS}
    shortage = build_shortage_history(top5, mapping)
    shortage_all = build_shortage_history_all(top5, mapping)
    branch_top5_data = build_branch_top5_data(branch_top5_rows)
    current_controls, merchant_counts, parent_clear, branch_clear_counts, clearouts = build_control_index(controls, mapping, as_of)
    rolling_score = build_score_calculator(daily_scores)
    top10_by_date = {p: {} for p in PLATFORMS}
    for platform in PLATFORMS:
        for day in dates_by_platform[platform]:
            daily = sorted((r for r in timeout_rows if r["platform"] == platform and r["date"] == day), key=lambda r: (-r["timeout_36h"], -r["timeout_rate_36h"], r["branch"]))[:10]
            enriched = []
            for rank, row in enumerate(daily, 1):
                branch, parent = row["branch"], parent_of(row["branch"], mapping)
                clear = parent_clear.get(parent, {"count": 0, "last_date": "", "last_type": ""})
                ctrl = current_controls.get(branch, {"action": "", "status": "", "start_date": ""})
                history_shortage = shortage.get(platform, {}).get(parent)
                if history_shortage is None and platform not in ("抖音", "淘宝"):
                    history_shortage = shortage_all.get(parent)
                enriched.append({**row, "rank": rank, "parent_name": parent,
                    "stagnant_score": rolling_score(branch, day) if platform == "抖音" else None,
                    "current_control": ctrl["action"] if platform == "抖音" else "",
                    "merchant_control_count": merchant_counts.get(branch, 0) if platform == "抖音" else None,
                    "branch_clearout_count": branch_clear_counts.get(branch, 0) if platform == "抖音" else None,
                    "clearout_count": clear["count"] if platform == "抖音" else None,
                    "last_clearout_date": clear["last_date"] if platform == "抖音" else "",
                    "last_clearout_type": clear["last_type"] if platform == "抖音" else "",
                    "history_shortage": history_shortage or {"months": [], "branches": [], "customer_count": 0},
                })
            top10_by_date[platform][day] = enriched
    branch_events = [r for r in controls if r["is_branch_level"] and r["control_action"] in CONTROL_ACTIONS and r["start_date"]]
    control_by_date, high_scores_by_date = {}, {}
    for day in dates_by_platform["抖音"]:
        end, start = iso_day(day), iso_day(day) - timedelta(days=6)
        page = []
        for row in branch_events:
            event_day = iso_day(row["start_date"])
            if not start <= event_day <= end:
                continue
            parent = parent_of(row["branch"], mapping)
            clear = parent_clear.get(parent, {"count": 0, "last_date": "", "last_type": ""})
            page.append({"date": row["start_date"], "branch": row["branch"], "parent_name": parent,
                "control_action": row["control_action"], "control_status": row["control_status"],
                "stagnant_score": rolling_score(row["branch"], day), "clearout_count": clear["count"],
                "last_clearout_date": clear["last_date"], "last_clearout_type": clear["last_type"]})
        page.sort(key=lambda r: (r["date"], ACTION_SEVERITY.get(r["control_action"], 0), r["branch"]), reverse=True)
        control_by_date[day] = page
        high = []
        for branch in daily_scores:
            score = rolling_score(branch, day)
            if score < 6:
                continue
            parent = parent_of(branch, mapping)
            clear = parent_clear.get(parent, {"count": 0, "last_date": "", "last_type": ""})
            high.append({"branch": branch, "parent_name": parent, "stagnant_score": score,
                "clearout_count": clear["count"], "last_clearout_date": clear["last_date"], "last_clearout_type": clear["last_type"]})
        high.sort(key=lambda r: (-r["stagnant_score"], -r["clearout_count"], r["branch"]))
        high_scores_by_date[day] = high
    all_branches = {r["branch"] for r in timeout_rows + top5 + score_rows + controls if r.get("branch")}
    unmatched = sorted(branch for branch in all_branches if branch not in mapping)
    score_dates = sorted({r["date"] for r in score_rows})
    control_dates = sorted({r["start_date"] for r in controls if r["start_date"]})
    timeout_dates = sorted({r["date"] for r in timeout_rows})
    current_branch_executing = len({b for b in current_controls})
    current_merchant_executing = sum(merchant_counts.values())
    example_parent = "广东佛山南海新河村公司"
    return {
        "meta": {
            "as_of": as_of, "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "score_as_of": score_dates[-1] if score_dates else "", "score_window_start": (iso_day(as_of) - timedelta(days=15)).isoformat(),
            "control_as_of": control_dates[-1] if control_dates else "", "timeout_start": timeout_dates[0] if timeout_dates else "",
            "supported_platforms": list(PLATFORMS),
            "source_rows": {"timeout": raw_timeout_count, "top5": raw_top5_count, "mapping": len(mapping), "scores": len(score_rows), "controls": len(controls)},
            "analysis_rows": {"timeout": len(timeout_rows), "top5": len(top5)},
            "quality": {
                "unmatched_branch_count": len(unmatched),
                "unmatched_branch_sample": unmatched[:20],
                "invalid_top5_dates": bad_top5_dates,
                "excluded_customer_keywords": list(EXCLUDED_CUSTOMER_KEYWORDS),
                "excluded_timeout_rows": excluded_timeout_count,
                "excluded_top5_rows": excluded_top5_count,
            },
            "summary": {"executing_branch_controls": current_branch_executing, "executing_merchant_controls": current_merchant_executing, "historical_clearouts": len(clearouts)},
            "example_check": shortage.get("抖音", {}).get(example_parent, {"months": [], "branches": []}),
        },
        "platforms": {p: {"dates": dates_by_platform[p], "top10_by_date": top10_by_date[p]} for p in PLATFORMS},
        "controls_by_date": control_by_date, "high_scores_by_date": high_scores_by_date,
        "history_lookup": shortage,
        "history_all_lookup": shortage_all,
        "branch_top5_data": branch_top5_data,
        "trends": build_trends(timeout_rows, mapping),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="生成交件超时静态看板数据")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent / "数据源")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "data")
    parser.add_argument("--as-of", help="看板 T-1 日期，默认取交件数据最大日期")
    parser.add_argument("--year", type=int, default=datetime.now().year)
    args = parser.parse_args()
    print("读取 5 类数据源…")
    timeout_rows = read_timeout(args.data_dir, args.year)
    if not timeout_rows:
        raise RuntimeError("未读取到交件超时数据")
    top5, branch_top5_rows, bad_dates = read_top5(args.data_dir, args.year)
    mapping = read_mapping(args.data_dir)
    score_rows, daily_scores, cumulative_scores = read_scores(args.data_dir)
    controls = read_controls(args.data_dir)
    as_of = args.as_of or max(row["date"] for row in timeout_rows)
    if as_of not in {row["date"] for row in timeout_rows}:
        raise ValueError(f"--as-of {as_of} 不在交件数据日期中")
    dashboard = build_dashboard(timeout_rows, top5, branch_top5_rows, mapping, score_rows, daily_scores, cumulative_scores, controls, as_of, bad_dates)
    output = args.output_dir
    write_json(output / "timeout_daily.json", timeout_rows)
    write_json(output / "top5_control.json", top5)
    write_json(output / "branch_mapping.json", mapping)
    write_json(output / "platform_scores.json", score_rows)
    write_json(output / "platform_control.json", controls)
    write_json(output / "dashboard_data.json", dashboard)
    write_json(output / "data_quality_report.json", dashboard["meta"])
    bundle = "window.__JIAOJIAN_DASHBOARD__=" + json.dumps(dashboard, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + ";\n"
    (output / "dashboard_bundle.js").write_text(bundle, encoding="utf-8", newline="\n")
    print(f"完成：T-1={as_of}，交件 {len(timeout_rows)} 条，TOP5 {len(top5)} 条，积分 {len(score_rows)} 条，管控 {len(controls)} 条")
    print(f"输出：{output.resolve()}")
    check = dashboard["meta"]["example_check"]
    print("示例核验：广东佛山南海新河村公司 / 抖音", check.get("months", []), check.get("branches", []))


if __name__ == "__main__":
    main()