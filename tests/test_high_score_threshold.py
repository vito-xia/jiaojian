import unittest

from process_data import HIGH_SCORE_THRESHOLD, PICKUP_SCORE_SCENE, build_dashboard


class HighScoreThresholdTests(unittest.TestCase):
    def dashboard(self, day):
        daily = {
            "首次四分": {"2026-10-17": 3, "2026-10-19": 1, "2026-10-20": 0},
            "低于四分": {"2026-10-19": 3.99},
            "低于可选范围": {"2026-10-19": 0.99},
            "窗口首日": {"2026-10-06": 4},
            "窗口以外": {"2026-10-05": 4},
            "持续五分": {"2026-10-17": 5},
        }
        scores = [{"branch": branch, "date": date, "scene": PICKUP_SCORE_SCENE,
                   "current_score": score, "shipment_timeout_abnormal_count": 0,
                   "shipment_timeout_rate": 0, "shipment_timeout_operation_count": 1}
                  for branch, points in daily.items() for date, score in points.items()]
        return build_dashboard([], [], [], {}, scores, daily, {}, [], [], [], {}, {}, {}, day, 0)

    def test_four_included_lower_excluded_and_window_stays_sixteen_days(self):
        rows = self.dashboard("2026-10-21")["high_scores_by_date"]["2026-10-21"]
        self.assertEqual([row["branch"] for row in rows], ["持续五分", "窗口首日", "首次四分"])
        self.assertNotIn("低于四分", [row["branch"] for row in rows])
        self.assertNotIn("低于可选范围", [row["branch"] for row in rows])
        row = next(row for row in rows if row["branch"] == "首次四分")
        self.assertEqual(row["stagnant_score"], HIGH_SCORE_THRESHOLD)
        self.assertEqual(row["latest_score_date"], "2026-10-20")
        self.assertEqual(row["latest_timeout_count"], 0)
        self.assertEqual(row["latest_timeout_rate"], 0)

    def test_new_uses_four_point_threshold_for_first_and_second_day(self):
        for day, expected in [("2026-10-19", True), ("2026-10-20", True), ("2026-10-21", False)]:
            with self.subTest(day=day):
                rows = self.dashboard(day)["high_scores_by_date"][day]
                row = next(row for row in rows if row["branch"] == "首次四分")
                self.assertEqual(row["is_new"], expected)


if __name__ == "__main__":
    unittest.main()
