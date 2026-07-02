import unittest
from shop_resolver import extract_shop_code, resolve_shop_code

class TestShopResolver(unittest.TestCase):
    def test_direct_code(self):
        self.assertEqual(extract_shop_code("KRL004"), "KRL004")
        self.assertEqual(extract_shop_code("  krl004  "), "KRL004") # Converts to uppercase
        self.assertEqual(extract_shop_code("KRL004/"), "KRL004")

    def test_https_url(self):
        self.assertEqual(extract_shop_code("https://autoprint.in/setup/KRL004"), "KRL004")
        self.assertEqual(extract_shop_code("https://autoprint.in/setup/krl004/"), "KRL004")

    def test_http_www_url(self):
        self.assertEqual(extract_shop_code("http://www.autoprint.in/setup/KRL004"), "KRL004")
        self.assertEqual(extract_shop_code("  http://www.autoprint.in/setup/krl004/  "), "KRL004")

    def test_naked_domain_url(self):
        self.assertEqual(extract_shop_code("autoprint.in/setup/KRL004"), "KRL004")
        self.assertEqual(extract_shop_code("www.autoprint.in/setup/krl004/"), "KRL004")

    def test_empty_input(self):
        self.assertEqual(extract_shop_code(""), "")
        self.assertEqual(extract_shop_code(None), "")

    def test_resolve_format_validation(self):
        # Invalid format should fail early before any database connection attempts
        res1 = resolve_shop_code("krl004")
        self.assertFalse(res1["success"])
        self.assertIn("Invalid format", res1["error"])

        res2 = resolve_shop_code("ABCD12")
        self.assertFalse(res2["success"])
        self.assertIn("Invalid format", res2["error"])

        res3 = resolve_shop_code("KRL0004")
        self.assertFalse(res3["success"])
        self.assertIn("Invalid format", res3["error"])

        res4 = resolve_shop_code("")
        self.assertFalse(res4["success"])
        self.assertEqual(res4["error"], "Shop code cannot be empty.")

if __name__ == "__main__":
    unittest.main()
