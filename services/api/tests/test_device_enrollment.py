"""
tests/test_device_enrollment.py
Unit tests for device enrollment: expiry checks, consumed-code rejection,
shop ownership enforcement, and atomicity guard.
All Supabase calls are mocked — no live DB required.
"""
import unittest
from unittest.mock import patch, MagicMock, call
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from fastapi.testclient import TestClient
from app.main import app


class TestDeviceEnrollmentExpiry(unittest.TestCase):
    """P1: Enrollment code expiry is enforced."""

    @patch('app.routes.devices.get_supabase_client')
    @patch('app.routes.devices.hash_secret', return_value='hashed-code')
    def test_expired_code_rejected(self, mock_hash, mock_db):
        """An enrollment code whose expires_at is in the past must be rejected with 400."""
        mock_client = MagicMock()
        mock_db.return_value = mock_client

        mock_client.rpc.return_value.execute.return_value.data = []

        client = TestClient(app)
        resp = client.post("/api/v3/devices/enroll", json={
            "enrollment_code": "ABCD-EFGH",
            "display_name": "Test Device"
        })

        self.assertEqual(resp.status_code, 400)
        self.assertIn("expired", resp.json()["detail"].lower())

    @patch('app.routes.devices.get_supabase_client')
    @patch('app.routes.devices.hash_secret', return_value='hashed-code')
    def test_valid_code_accepted(self, mock_hash, mock_db):
        """A valid, unexpired enrollment code must create a device and mark the code consumed."""
        mock_client = MagicMock()
        mock_db.return_value = mock_client

        device_row = {"device_id": "dev-001", "shop_id": "shop-001"}
        mock_client.rpc.return_value.execute.return_value.data = [device_row]

        with patch('app.routes.devices.generate_device_secret', return_value=('raw-secret', 'hashed-secret')):
            client = TestClient(app)
            resp = client.post("/api/v3/devices/enroll", json={
                "enrollment_code": "VALID-CODE",
                "display_name": "Test Device"
            })

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["device_id"], device_row["device_id"])
        self.assertEqual(body["shop_id"], device_row["shop_id"])
        self.assertEqual(body["device_secret"], "raw-secret")
        mock_client.rpc.assert_called_once_with("consume_device_enrollment", unittest.mock.ANY)


class TestDeviceEnrollmentConsumedCode(unittest.TestCase):
    """P1: Already-consumed enrollment codes are rejected."""

    @patch('app.routes.devices.get_supabase_client')
    @patch('app.routes.devices.hash_secret', return_value='hashed-code')
    def test_consumed_code_not_found(self, mock_hash, mock_db):
        """DB query filters consumed_at IS NULL — consumed codes return no rows."""
        mock_client = MagicMock()
        mock_db.return_value = mock_client

        mock_client.rpc.return_value.execute.return_value.data = []

        client = TestClient(app)
        resp = client.post("/api/v3/devices/enroll", json={
            "enrollment_code": "USED-CODE",
            "display_name": "Test Device"
        })

        self.assertEqual(resp.status_code, 400)
        self.assertIn("consumed", resp.json()["detail"].lower())


class TestDeviceEnrollmentShopOwnership(unittest.TestCase):
    """P1: Enrollment-code creation and device revocation verify shop ownership."""

    def _auth_headers(self):
        return {"X-AutoPrint-Contract-Version": "3"}

    @patch('app.routes.devices.get_supabase_client')
    @patch('app.dependencies.verify_session_and_csrf')
    def test_create_code_for_different_shop_rejected(self, mock_verify, mock_db):
        """Owner of shop-001 cannot create enrollment codes for shop-999."""
        mock_verify.return_value = {
            "id": "session-1",
            "user_id": "user-001",
            "shop_id": "shop-001",
            "role": "owner",
            "shop_memberships": [{"role": "owner", "active": True, "shop_id": "shop-001"}],
        }

        client = TestClient(app)
        resp = client.post(
            "/api/v3/shops/shop-999/device-enrollment-codes",
            cookies={"autoprint_session": "tok"},
            headers={"X-AutoPrint-Contract-Version": "3", "X-AutoPrint-CSRF": "csrf-tok"},
        )
        self.assertEqual(resp.status_code, 403)

    @patch('app.routes.devices.get_supabase_client')
    @patch('app.dependencies.verify_session_and_csrf')
    def test_revoke_device_different_shop_rejected(self, mock_verify, mock_db):
        """Owner of shop-001 cannot revoke devices belonging to shop-999."""
        mock_verify.return_value = {
            "id": "session-1",
            "user_id": "user-001",
            "shop_id": "shop-001",
            "role": "owner",
            "shop_memberships": [{"role": "owner", "active": True, "shop_id": "shop-001"}],
        }

        mock_client = MagicMock()
        mock_db.return_value = mock_client
        # Device belongs to shop-999
        mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"shop_id": "shop-999"}
        ]

        client = TestClient(app)
        resp = client.post(
            "/api/v3/devices/dev-xyz/revoke",
            cookies={"autoprint_session": "tok"},
            headers={"X-AutoPrint-Contract-Version": "3", "X-AutoPrint-CSRF": "csrf-tok"},
        )
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
