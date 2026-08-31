import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


class TestCustomerAuthentication(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("app.routes.customer_auth.create_auth_client")
    def test_request_email_code_uses_auth_provider(self, mock_auth_client):
        response = self.client.post(
            "/api/v3/customer-auth/request-code", json={"email": "student@example.com"}
        )
        self.assertEqual(response.status_code, 200)
        mock_auth_client.return_value.auth.sign_in_with_otp.assert_called_once_with({
            "email": "student@example.com", "options": {"should_create_user": True}
        })

    @patch("app.routes.customer_auth.create_customer_session", return_value=("raw-session", "raw-csrf"))
    @patch("app.routes.customer_auth.get_supabase_client")
    @patch("app.routes.customer_auth.create_auth_client")
    def test_verified_code_creates_customer_cookie(self, mock_auth_client, mock_db, _create_session):
        mock_auth_client.return_value.auth.verify_otp.return_value = SimpleNamespace(
            user=SimpleNamespace(id="identity-1")
        )
        customer_table = MagicMock()
        customer_table.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{
            "id": "customer-1", "email": "student@example.com", "verified_at": "2026-08-26T00:00:00+00:00"
        }]
        customer_table.update.return_value.eq.return_value.execute.return_value.data = []
        mock_db.return_value.table.return_value = customer_table

        response = self.client.post(
            "/api/v3/customer-auth/verify-code",
            json={"email": "student@example.com", "code": "123456"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["csrf_token"], "raw-csrf")
        self.assertIn("autoprint_customer_session", response.headers.get("set-cookie", ""))

    @patch("app.routes.customer_auth.create_auth_client")
    def test_invalid_code_fails_closed(self, mock_auth_client):
        mock_auth_client.return_value.auth.verify_otp.side_effect = Exception("invalid")
        response = self.client.post(
            "/api/v3/customer-auth/verify-code",
            json={"email": "student@example.com", "code": "000000"},
        )
        self.assertEqual(response.status_code, 401)

    @patch("app.routes.customer_auth.create_customer_session", return_value=("guest-session", "guest-csrf"))
    @patch("app.routes.customer_auth.get_supabase_client")
    @patch("app.routes.customer_auth.settings.customer_verification_required", False)
    def test_guest_session_is_available_only_when_testing_bypass_enabled(self, mock_db, _create_session):
        customer_table = MagicMock()
        customer_table.insert.return_value.execute.return_value.data = [{"id": "guest-customer"}]
        mock_db.return_value.table.return_value = customer_table

        response = self.client.post("/api/v3/customer-auth/guest-session")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "guest_testing_session")
        self.assertEqual(response.json()["csrf_token"], "guest-csrf")
        self.assertIn("autoprint_customer_session", response.headers.get("set-cookie", ""))

    @patch("app.routes.customer_auth.require_customer_session", return_value={"id": "session-1", "customer_id": "customer-1"})
    @patch("app.routes.customer_auth.get_supabase_client")
    def test_csrf_can_be_rotated_after_page_reload(self, mock_db, _session):
        table = MagicMock()
        table.update.return_value.eq.return_value.execute.return_value.data = []
        mock_db.return_value.table.return_value = table
        response = self.client.post("/api/v3/customer-auth/csrf")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["csrf_token"])


if __name__ == "__main__":
    unittest.main()
