import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.auth import _parse_utc_timestamp

class TestAuthEndpoints(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_unauthenticated_session_access(self):
        response = self.client.get("/api/v3/auth/session")
        self.assertEqual(response.status_code, 401)
        data = response.json()
        self.assertEqual(data["detail"], "Unauthenticated session")

    def test_postgrest_utc_offset_parses_without_corruption(self):
        parsed = _parse_utc_timestamp("2026-08-24T10:15:00+00:00")
        self.assertEqual(parsed.utcoffset().total_seconds(), 0)

    @patch("app.routes.auth.create_auth_client")
    def test_login_invalid_credentials(self, mock_auth_client):
        mock_client = MagicMock()
        # Simulate Supabase Auth raising on wrong password
        mock_client.auth.sign_in_with_password.side_effect = Exception("Invalid login credentials")
        mock_auth_client.return_value = mock_client

        response = self.client.post("/api/v3/auth/login", json={"email": "nonexistent@canary.local", "password": "wrongpassword"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Invalid credentials")

if __name__ == "__main__":
    unittest.main()
