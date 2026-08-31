import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


class TestPhase2Cancellation(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_capability_and_idempotency_key_are_required(self):
        missing_cap = self.client.post("/api/v3/orders/order-1/cancel", headers={"Idempotency-Key": "idem"})
        self.assertEqual(missing_cap.status_code, 404)
        missing_key = self.client.post("/api/v3/orders/order-1/cancel", headers={"X-AutoPrint-Capability": "cap"})
        self.assertEqual(missing_key.status_code, 400)

    @patch("app.routes.cancellations.get_supabase_client")
    def test_successful_cancel_returns_stable_result(self, mock_db):
        mock_db.return_value.rpc.return_value.execute.return_value.data = {
            "result": "cancelled", "order_id": "order-1", "job_id": "job-1"
        }
        response = self.client.post(
            "/api/v3/orders/order-1/cancel",
            headers={"X-AutoPrint-Capability": "cap", "Idempotency-Key": "idem-1"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"], "cancelled")

    @patch("app.routes.cancellations.get_supabase_client")
    def test_claim_winner_returns_conflict(self, mock_db):
        mock_db.return_value.rpc.return_value.execute.return_value.data = {
            "result": "execution_started", "order_id": "order-1", "job_id": "job-1"
        }
        response = self.client.post(
            "/api/v3/orders/order-1/cancel",
            headers={"X-AutoPrint-Capability": "cap", "Idempotency-Key": "idem-2"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("already started", response.json()["detail"])

    def test_sql_locks_same_job_predicate_as_claim(self):
        root = Path(__file__).parents[1] / "migrations"
        cancel_sql = (root / "0015_phase2_atomic_customer_cancellation.sql").read_text(encoding="utf-8")
        claim_sql = (root / "0014_phase1_remote_order_policy.sql").read_text(encoding="utf-8")
        self.assertIn("WHERE order_id=p_order_id FOR UPDATE", cancel_sql)
        self.assertIn("v_job.current_attempt_id IS NOT NULL", cancel_sql)
        self.assertIn("FOR UPDATE OF pj SKIP LOCKED", claim_sql)
        self.assertIn("pj.current_attempt_id IS NULL", claim_sql)
        self.assertIn("print_eligibility IN('counter','shop_risk_accepted')", claim_sql)


if __name__ == "__main__":
    unittest.main()
