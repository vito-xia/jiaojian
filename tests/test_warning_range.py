import unittest
import tempfile
from pathlib import Path

from openpyxl import Workbook

from process_data import build_latest_customer_metadata, build_warning_range_data, read_timeout


class WarningRangeDataTests(unittest.TestCase):
    def test_source_range_preserves_null_without_changing_legacy_single_day(self):
        with tempfile.TemporaryDirectory() as folder:
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["序号", "分部", "客户", "客户编码", "是否配置发运兜底", "是否历史有单无货",
                          "揽收->入首分拨(工单列)", "揽收->入首分拨(超时列)", None,
                          "揽收->入首分拨(第三列)", "揽收->入首分拨(第四列)",
                          "揽收->入首分拨(第五列)", "揽收->入首分拨(第六列)"])
            sheet.append([None] * 6 + ["票件量A", "超时量B", "超时率B/C"])
            sheet.append([1, "网点甲", "缺值客户", "C1", "否", "否", 0, None, None, 0, 0, 0, 0])
            sheet.append([2, "网点甲", "真实零客户", "C2", "否", "否", 0, 0, 0, 0, 0, 0, 0])
            workbook.save(Path(folder) / "抖音_9月1日.xlsx")
            workbook.close()
            range_rows = []
            legacy = read_timeout(Path(folder), 2026, range_rows)
            self.assertEqual(legacy[0]["timeout_36h"], 0)
            self.assertEqual(legacy[0]["timeout_rate_36h"], 0)
            self.assertIsNone(range_rows[0]["timeout_36h"])
            self.assertIsNone(range_rows[0]["timeout_rate_36h"])
            self.assertEqual(range_rows[1]["timeout_36h"], 0)
            self.assertEqual(range_rows[1]["timeout_rate_36h"], 0)

    def test_same_name_different_codes_and_daily_duplicates_stay_separate(self):
        rows = [
            {"platform": "抖音", "date": "2026-09-01", "branch": "甲", "customer": "同名", "customer_code": code,
             "timeout_36h": count, "timeout_rate_36h": rate}
            for code, count, rate in [("1", 3, 1), ("2", 5, 2), ("", 0, 0), ("1", None, None)]
        ]
        payload = build_warning_range_data(rows, {}, build_latest_customer_metadata(rows), {}, {}, {}, {}, {})
        self.assertEqual(len(payload["customers"]), 3)
        coded = next(item for item in payload["customers"] if item["customer_code"] == "1")
        self.assertEqual(coded["points"], [["2026-09-01", 3, 1], ["2026-09-01", None, None]])

    def test_groups_by_code_keeps_name_changes_and_preserves_zero(self):
        rows = [
            {
                "platform": "抖音", "date": "2026-09-01", "branch": "网点甲",
                "customer": "客户旧名", "customer_code": "C1", "timeout_36h": 10,
                "timeout_rate_36h": 5, "has_shipping_fallback": "否",
            },
            {
                "platform": "抖音", "date": "2026-09-02", "branch": "网点甲",
                "customer": "客户新名", "customer_code": "C1", "timeout_36h": 0,
                "timeout_rate_36h": 0, "has_shipping_fallback": "是",
            },
            {
                "platform": "抖音", "date": "2026-09-02", "branch": "网点甲",
                "customer": "无编码客户", "customer_code": "", "timeout_36h": 3,
                "timeout_rate_36h": 1.5, "has_shipping_fallback": "否",
            },
            {
                "platform": "淘宝", "date": "2026-09-02", "branch": "网点甲",
                "customer": "淘宝客户", "customer_code": "T1", "timeout_36h": 99,
                "timeout_rate_36h": 9.9, "has_shipping_fallback": "否",
            },
        ]
        payload = build_warning_range_data(
            rows,
            {"网点甲": {"parent_name": "一级公司甲", "province": "华东"}},
            build_latest_customer_metadata(rows),
            {"网点甲": {"action": "限制面单新签"}},
            {"网点甲": 2},
            {"一级公司甲": {"count": 3, "last_date": "2026-08-31", "last_type": "积分制"}},
            {"网点甲": 1},
            {"抖音": {"一级公司甲": {"months": [{"month": "2026-08", "days": 2}], "branches": ["网点甲"], "customer_count": 1}}},
        )

        self.assertEqual(payload["schema_version"], 1)
        self.assertEqual(payload["dates"], ["2026-09-01", "2026-09-02"])
        self.assertEqual(len(payload["customers"]), 2)
        coded = next(item for item in payload["customers"] if item["customer_code"] == "C1")
        self.assertEqual(coded["customer"], "客户新名")
        self.assertEqual(coded["has_shipping_fallback"], "是")
        self.assertEqual(coded["points"], [
            ["2026-09-01", 10, 5, "客户旧名"],
            ["2026-09-02", 0, 0],
        ])
        branch = payload["branches"]["网点甲"]
        self.assertEqual(branch["province"], "华东")
        self.assertEqual(branch["current_control"], "限制面单新签")
        self.assertEqual(branch["merchant_control_count"], 2)
        self.assertEqual(branch["clearout_count"], 3)


if __name__ == "__main__":
    unittest.main()
