import unittest

from process_data import estimated_timeout_rate_48h, jd_warning_sort_key


class DashboardMetricTests(unittest.TestCase):
    def test_estimated_48h_rate_uses_unrounded_36h_shipment_volume(self):
        # 3 / 7.3% = 41.095890...; 2 / that volume = 4.8666%.
        self.assertEqual(estimated_timeout_rate_48h(3, 7.3, 2), 4.8667)
        self.assertEqual(estimated_timeout_rate_48h(3, 7.3, 0), 0)

    def test_estimated_48h_rate_keeps_unusable_sources_missing(self):
        for values in ((None, 7.3, 2), (0, 7.3, 2), (3, None, 2), (3, 0, 2), (3, 7.3, None)):
            with self.subTest(values=values):
                self.assertIsNone(estimated_timeout_rate_48h(*values))

    def test_jd_order_uses_36h_before_48h_and_stable_identity_ties(self):
        rows = [
            {"branch": "B", "customer": "A", "timeout_36h": 2, "timeout_rate_36h": 1, "timeout_48h": 999},
            {"branch": "A", "customer": "B", "timeout_36h": 2, "timeout_rate_36h": 1, "timeout_48h": 0},
            {"branch": "A", "customer": "A", "timeout_36h": 2, "timeout_rate_36h": 1, "timeout_48h": 0},
            {"branch": "C", "customer": "A", "timeout_36h": 3, "timeout_rate_36h": 0, "timeout_48h": 0},
        ]
        rows.sort(key=jd_warning_sort_key)
        self.assertEqual([(row["branch"], row["customer"]) for row in rows], [("C", "A"), ("A", "A"), ("A", "B"), ("B", "A")])

    def test_jd_top60_excludes_by_36h_even_if_old_48h_order_is_opposite(self):
        rows = [
            {"branch": f"B{i:02}", "customer": "C", "timeout_36h": i, "timeout_rate_36h": i / 10, "timeout_48h": 1000 - i}
            for i in range(65)
        ]
        selected = sorted(rows, key=jd_warning_sort_key)[:60]
        self.assertEqual(len(selected), 60)
        self.assertEqual(selected[0]["timeout_36h"], 64)
        self.assertEqual(selected[-1]["timeout_36h"], 5)
        self.assertNotIn(4, [row["timeout_36h"] for row in selected])


if __name__ == "__main__":
    unittest.main()
