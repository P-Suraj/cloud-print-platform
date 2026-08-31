import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.capabilities import hash_capability_token

class TestQuoteAcceptance(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    @patch("app.routes.quotes.get_supabase_client")
    def test_accept_quote_success(self, mock_db):
        raw_cap = "mock-cap-123"
        cap_h = hash_capability_token(raw_cap)
        headers = {"X-AutoPrint-Capability": raw_cap}
        
        mock_client = MagicMock()
        mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": "quote-1",
            "artifact_id": "art-1",
            "orders": {
                "id": "order-1",
                "shop_id": "shop-1",
                "capability_hash": cap_h,
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            },
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
        }]
        mock_client.rpc.return_value.execute.return_value.data = {
            "status": "accepted", "job_id": "job-1", "order_id": "order-1",
            "job_status": "waiting_for_shop",
        }
        mock_db.return_value = mock_client

        response = self.client.post("/api/v3/quotes/quote-1/accept", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "accepted")
        self.assertEqual(data["job_id"], "job-1")

if __name__ == "__main__":
    unittest.main()
