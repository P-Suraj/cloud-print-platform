import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app

class TestShopJobs(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_unauthenticated_list_jobs_rejected(self):
        response = self.client.get("/api/v3/shop/jobs")
        self.assertEqual(response.status_code, 401)

    @patch("app.dependencies.verify_session_and_csrf")
    @patch("app.routes.shop_jobs.get_supabase_client")
    def test_approve_job_success(self, mock_db, mock_auth):
        mock_auth.return_value = {
            "id": "sess-1",
            "user_id": "user-1",
            "shop_memberships": [{"shop_id": "shop-1", "role": "owner", "active": True}]
        }

        mock_client = MagicMock()
        mock_client.rpc.return_value.execute.return_value.data = True
        mock_db.return_value = mock_client

        headers = {"X-AutoPrint-CSRF": "csrf-123"}
        self.client.cookies.set("autoprint_session", "session-123")

        response = self.client.post("/api/v3/shop/jobs/job-1/approve", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "approved")
        mock_client.rpc.assert_called_once_with("approve_print_job", {
            "p_job_id": "job-1", "p_user_id": "user-1"
        })

if __name__ == "__main__":
    unittest.main()
