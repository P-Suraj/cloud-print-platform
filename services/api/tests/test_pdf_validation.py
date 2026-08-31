import io
import unittest

from pypdf import PdfWriter

from app.pdf_validation import validate_pdf_bytes, validate_pdf_bytes_bounded


class TestPdfValidation(unittest.TestCase):
    def test_valid_pdf_is_parsed_in_bounded_process(self):
        output = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.write(output)
        valid, pages, error = validate_pdf_bytes_bounded(output.getvalue(), timeout_seconds=10)
        self.assertTrue(valid, error)
        self.assertEqual(pages, 1)

    def test_javascript_marker_is_rejected(self):
        valid, _, error = validate_pdf_bytes(b"%PDF-1.4\n/JavaScript\n%%EOF")
        self.assertFalse(valid)
        self.assertIn("JavaScript", error)


if __name__ == "__main__":
    unittest.main()
