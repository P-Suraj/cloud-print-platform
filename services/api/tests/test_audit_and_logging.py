import unittest

from app.audit import sanitize_metadata

class TestAuditAndLogging(unittest.TestCase):

    def test_sanitize_metadata_redacts_secrets(self):
        raw_meta = {
          "order_id": "order-123",
          "session_token": "secret-session-abc",
          "csrf_token": "csrf-123",
          "device_secret": "raw-sec-456",
          "file_size": 1024
        }

        clean = sanitize_metadata(raw_meta)
        self.assertEqual(clean["order_id"], "order-123")
        self.assertEqual(clean["session_token"], "[REDACTED]")
        self.assertEqual(clean["csrf_token"], "[REDACTED]")
        self.assertEqual(clean["device_secret"], "[REDACTED]")
        self.assertEqual(clean["file_size"], 1024)

if __name__ == "__main__":
    unittest.main()
