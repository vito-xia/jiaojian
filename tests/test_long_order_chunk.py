import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from 数据源.脚本.超长单.update_long_order import build_payload, read_one_source


class LongOrderChunkTests(unittest.TestCase):
    def test_payload_sorts_by_count_and_keeps_table_fields_zero_and_missing_values(self):
        headers = [
            "省份", "城市", "网点", "超长单异常运单数", "超长单应签运单总数",
            "超长单异常率", "超长单异常率-异常等级", "剔除不可抗力异常率",
            "剔除不可抗力异常率-异常等级",
        ]
        rows = [
            ["浙江省", "金华市", "机构甲", 0, 10, 0, "无异常", 0, "无异常"],
            ["广东省", "广州市", "机构乙", None, None, None, None, None, None],
            ["江苏省", "苏州市", "机构丙", 99, 100, 0.99, "高异常", 0.5, "中异常"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "9月20日.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "列表数据"
            sheet.append(headers)
            for row in rows:
                sheet.append(row)
            workbook.save(path)
            workbook.close()

            record = read_one_source("2026-09-20", path, row_limit=3)
            payload = build_payload(
                [record],
                "2026-09-21 12:00:00",
                2026,
                3,
                {"机构甲": "义乌", "机构丙": "苏南"},
            )

        points = payload["long_order_trends"]
        self.assertEqual(payload["long_order_meta"]["schema_version"], 4)
        self.assertEqual(set(points), {"机构甲", "机构乙", "机构丙"})
        self.assertEqual(points["机构丙"][0]["source_rank"], 1)
        self.assertEqual(points["机构甲"][0]["source_rank"], 2)
        self.assertEqual(points["机构乙"][0]["source_rank"], 3)
        self.assertEqual(points["机构甲"][0]["branch"], "机构甲")
        self.assertEqual(points["机构甲"][0]["abnormal_count"], 0)
        self.assertEqual(points["机构甲"][0]["expected_sign_count"], 10)
        self.assertEqual(points["机构甲"][0]["abnormal_rate"], 0)
        self.assertEqual(points["机构甲"][0]["abnormal_level"], "无异常")
        self.assertEqual(points["机构甲"][0]["business_province"], "义乌")
        self.assertEqual(points["机构甲"][0]["top10_streak"], 1)
        self.assertEqual(points["机构乙"][0]["business_province"], "")
        self.assertIsNone(points["机构乙"][0]["abnormal_count"])
        self.assertIsNone(points["机构乙"][0]["expected_sign_count"])
        self.assertIsNone(points["机构乙"][0]["abnormal_rate"])
        self.assertIsNone(points["机构乙"][0]["abnormal_level"])
        self.assertNotIn("province", points["机构甲"][0])
        self.assertNotIn("city", points["机构甲"][0])
        self.assertNotIn("剔除不可抗力异常率", points["机构甲"][0])
        self.assertNotIn("操作", points["机构甲"][0])

    def test_top10_streak_uses_display_ranking_and_breaks_on_absence_or_date_gap(self):
        def record(day, high_rate=0.9, low_rate=0.1):
            rows = []
            for source_rank in range(1, 10):
                rows.append((f"领先机构{source_rank}", 100 - source_rank, 1.0))
            rows.extend([("临界低", 5, low_rate), ("临界高", 5, high_rate)])
            return {
                "date": day,
                "rows": rows,
                "warnings": [],
                "branch_rows": {
                    branch: {
                        "date": day,
                        "source_rank": source_rank,
                        "branch": branch,
                        "abnormal_count": count,
                        "abnormal_rate": rate,
                    }
                    for source_rank, (branch, count, rate) in enumerate(rows, 1)
                },
            }

        records = [
            record("2026-09-06"),
            record("2026-09-03", low_rate=0.9),
            record("2026-09-02"),
            record("2026-09-04"),
            record("2026-09-01"),
        ]
        payload = build_payload(records, "2026-09-07 12:00:00", 2026, 1000, {})
        points = payload["long_order_trends"]
        self.assertEqual(payload["long_order_meta"]["source_dates"], [
            "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-06",
        ])
        self.assertEqual([point["top10_streak"] for point in points["临界高"]], [1, 2, 0, 1, 1])
        self.assertEqual([point["top10_streak"] for point in points["临界低"]], [0, 0, 1, 0, 0])
        self.assertEqual([point["top10_streak"] for point in points["领先机构1"]], [1, 2, 3, 4, 1])

    def test_top_limit_is_applied_after_count_sort(self):
        headers = [
            "省份", "城市", "网点", "超长单异常运单数", "超长单应签运单总数",
            "超长单异常率", "超长单异常率-异常等级",
        ]
        rows = [
            ["浙江省", "金华市", "机构甲", 10, 100, 0.1, "低异常"],
            ["广东省", "广州市", "机构乙", 900, 1000, 0.9, "高异常"],
            ["江苏省", "苏州市", "机构丙", 50, 100, 0.5, "中异常"],
            ["河北省", "石家庄市", "机构丁", 1200, 2000, 0.6, "高异常"],
            ["福建省", "福州市", "机构戊", 50, 100, 0.5, "中异常"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "9月20日.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "列表数据"
            sheet.append(headers)
            for row in rows:
                sheet.append(row)
            workbook.save(path)
            workbook.close()

            record = read_one_source("2026-09-20", path, row_limit=4)

        self.assertEqual([row[2] for row in record["rows"]], ["机构丁", "机构乙", "机构丙", "机构戊"])
        self.assertEqual(list(record["branch_rows"]), ["机构丁", "机构乙", "机构丙", "机构戊"])
        self.assertEqual(
            [record["branch_rows"][branch]["source_rank"] for branch in record["branch_rows"]],
            [1, 2, 3, 4],
        )


if __name__ == "__main__":
    unittest.main()
