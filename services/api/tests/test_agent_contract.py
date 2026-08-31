import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app

class TestAgentContract(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_unauthenticated_agent_heartbeat(self):
        response = self.client.post("/api/v3/agent/heartbeat", json={"agent_version": "3.0.0", "printer_status_bw": "ready", "printer_status_color": "ready"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Device authentication headers missing")

    @patch("app.routes.agent.verify_device_credentials")
    @patch("app.routes.agent.get_supabase_client")
    @patch("app.routes.agent.get_public_supabase_client")
    def test_authenticated_agent_heartbeat(self, mock_public_db, mock_db, mock_auth):
        mock_auth.return_value = {"id": "dev-1", "shop_id": "shop-1"}
        mock_db.return_value = MagicMock()
        mock_public_db.return_value = MagicMock()

        headers = {
            "X-AutoPrint-Device-Id": "dev-1",
            "X-AutoPrint-Device-Secret": "secret-123"
        }
        payload = {
            "agent_version": "3.0.0",
            "printer_status_bw": "ready",
            "printer_status_color": "ready"
        }
        response = self.client.post("/api/v3/agent/heartbeat", json=payload, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "heartbeat_ack")

if __name__ == "__main__":
    unittest.main()
