import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


class TestPublicShops(unittest.TestCase):
    def test_development_demo_shop_resolves_without_database(self):
        with patch("app.routes.shops.get_public_supabase_client") as database:
            response = self.client.get("/api/v3/shops/DEMO001")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["shop_code"], "DEMO001")
        self.assertTrue(response.json()["demo_mode"])
        database.assert_not_called()

    def setUp(self):
        self.client = TestClient(app)

    @patch("app.routes.shops.get_public_supabase_client")
    def test_active_v3_shop_is_resolved_without_private_fields(self, mock_public_client):
        now = datetime.now(timezone.utc).isoformat()
        query = MagicMock()
        query.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{
            "name": "Campus Print",
            "shop_code": "CANARY01",
            "is_active": True,
            "migration_mode": "v3_canary",
            "last_seen_at": now,
            "pin": "must-not-leak",
        }]
        mock_public_client.return_value.table.return_value = query

        response = self.client.get("/api/v3/shops/canary01")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["shop_code"], "CANARY01")
        self.assertEqual(payload["name"], "Campus Print")
        self.assertTrue(payload["accepting_orders"])
        self.assertTrue(payload["agent_online"])
        self.assertNotIn("pin", payload)
        self.assertNotIn("id", payload)

    @patch("app.routes.shops.get_public_supabase_client")
    def test_legacy_or_inactive_shop_is_not_exposed_as_orderable(self, mock_public_client):
        query = MagicMock()
        query.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{
            "name": "Legacy Shop",
            "shop_code": "OLD001",
            "is_active": True,
            "migration_mode": "legacy",
            "last_seen_at": None,
        }]
        mock_public_client.return_value.table.return_value = query

        response = self.client.get("/api/v3/shops/OLD001")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Shop is not accepting AutoPrint orders")

    @patch("app.routes.shops.get_public_supabase_client")
    def test_unknown_shop_code_returns_not_found(self, mock_public_client):
        query = MagicMock()
        query.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_public_client.return_value.table.return_value = query

        response = self.client.get("/api/v3/shops/UNKNOWN")

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
