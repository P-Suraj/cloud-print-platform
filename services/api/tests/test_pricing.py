import unittest

from app.pricing import calculate_quote_price

class TestPricing(unittest.TestCase):
    def test_page_range_prices_only_unique_selected_pages(self):
        total, breakdown = calculate_quote_price(
            12,
            {"copies": 2, "color_mode": "bw", "duplex": False, "page_range": "1-3, 3, 8"},
            self.rules,
        )
        self.assertEqual(breakdown["selected_page_count"], 4)
        self.assertEqual(breakdown["total_printed_sides"], 8)
        self.assertEqual(total, 16.0)

    def test_page_range_rejects_pages_outside_document(self):
        with self.assertRaisesRegex(ValueError, "between 1 and 5"):
            calculate_quote_price(
                5,
                {"copies": 1, "color_mode": "bw", "duplex": False, "page_range": "1-7"},
                self.rules,
            )


    def setUp(self):
        self.rules = {
            "bw_simplex_slabs": [
                {"min_pages": 1, "max_pages": 10, "rate": 2.00},
                {"min_pages": 11, "max_pages": 9999, "rate": 1.50}
            ],
            "bw_duplex_slabs": [
                {"min_pages": 1, "max_pages": 10, "rate": 1.50},
                {"min_pages": 11, "max_pages": 9999, "rate": 1.25}
            ],
            "color_simplex_slabs": [
                {"min_pages": 1, "max_pages": 5, "rate": 10.00},
                {"min_pages": 6, "max_pages": 9999, "rate": 8.00}
            ]
        }

    def test_bw_simplex_under_10_pages(self):
        amount, breakdown = calculate_quote_price(5, {"copies": 1, "color_mode": "bw", "duplex": False}, self.rules)
        self.assertEqual(amount, 10.00) # 5 * 2.00
        self.assertEqual(breakdown["rate_per_side"], 2.00)

    def test_bw_simplex_over_10_pages(self):
        amount, breakdown = calculate_quote_price(20, {"copies": 1, "color_mode": "bw", "duplex": False}, self.rules)
        self.assertEqual(amount, 30.00) # 20 * 1.50
        self.assertEqual(breakdown["rate_per_side"], 1.50)

    def test_color_simplex_pricing(self):
        amount, breakdown = calculate_quote_price(3, {"copies": 2, "color_mode": "color", "duplex": False}, self.rules)
        self.assertEqual(amount, 48.00) # (3*2=6 sides) => rate 8.00 => 6 * 8.00 = 48.00

    def test_invalid_copies_rejected(self):
        with self.assertRaisesRegex(ValueError, "copies"):
            calculate_quote_price(3, {"copies": 0, "color_mode": "bw", "duplex": False}, self.rules)

    def test_missing_rate_slab_rejected_without_fallback(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            calculate_quote_price(3, {"copies": 1, "color_mode": "color", "duplex": True}, self.rules)

if __name__ == "__main__":
    unittest.main()
