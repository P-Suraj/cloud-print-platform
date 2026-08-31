import unittest
from fastapi.testclient import TestClient

from app.main import app

class TestHealthEndpoints(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_health_live(self):
        response = self.client.get("/health/live")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "live")
        self.assertEqual(data["contract_version"], 3)

    def test_contract_version_header_mismatch(self):
        response = self.client.get("/api/v3/protected-test", headers={"X-AutoPrint-Contract-Version": "2"})
        self.assertEqual(response.status_code, 426)
        data = response.json()
        self.assertEqual(data["error"], "update_required")

if __name__ == "__main__":
    unittest.main()
