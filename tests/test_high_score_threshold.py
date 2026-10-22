import unittest

from process_data import PICKUP_SCORE_SCENE, build_dashboard


class HighScoreThresholdTests(unittest.TestCase):
    def dashboard(self, day):
        daily = {
            "首次五分": {"2026-10-17": 4, "2026-10-19": 1, "2026-10-20": 0},
            "低于五分": {"2026-10-19": 4.99},
            "窗口首日": {"2026-10-06": 5},
            "窗口以外": {"2026-10-05": 5},
            "持续六分": {"2026-10-17": 6},
        }
        scores = [{"branch": branch, "date": date, "scene": PICKUP_SCORE_SCENE,
                   "current_score": score, "shipment_timeout_abnormal_count": 0,
                   "shipment_timeout_rate": 0, "shipment_timeout_operation_count": 1}
                  for branch, points in daily.items() for date, score in points.items()]
        return build_dashboard([], [], [], {}, scores, daily, {}, [], [], [], {}, {}, {}, day, 0)

    def test_five_included_lower_excluded_and_window_stays_sixteen_days(self):
        rows = self.dashboard("2026-10-21")["high_scores_by_date"]["2026-10-21"]
        self.assertEqual([row["branch"] for row in rows], ["持续六分", "窗口首日", "首次五分"])
        row = next(row for row in rows if row["branch"] == "首次五分")
        self.assertEqual(row["stagnant_score"], 5)
        self.assertEqual(row["latest_score_date"], "2026-10-20")
        self.assertEqual(row["latest_timeout_count"], 0)
        self.assertEqual(row["latest_timeout_rate"], 0)

    def test_new_uses_five_point_threshold_for_first_and_second_day(self):
        for day, expected in [("2026-10-19", True), ("2026-10-20", True), ("2026-10-21", False)]:
            with self.subTest(day=day):
                rows = self.dashboard(day)["high_scores_by_date"][day]
                row = next(row for row in rows if row["branch"] == "首次五分")
                self.assertEqual(row["is_new"], expected)


if __name__ == "__main__":
    unittest.main()
