import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import hashlib

from fastapi.testclient import TestClient

from app.main import app
from app.pickup_security import (
    derive_pickup_code,
    hash_pickup_code,
    normalize_pickup_code,
    generate_qr_bearer_token,
    verify_qr_bearer_token,
    verify_code_hash_constant_time,
    compute_actor_bucket_hash,
)
from worker.pickup_expiry import run_pickup_expiry_cycle, get_worker_health


class TestPhase3PickupWorkflow(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @staticmethod
    def _hardening_sql() -> str:
        return (Path(__file__).parents[1] / "migrations" / "0019_phase3_pickup_transition_and_rate_limit_hardening.sql").read_text(encoding="utf-8")

    # 1. Counter flow still works and does not unexpectedly require pickup.
    def test_counter_order_returns_not_applicable_pickup_status(self):
        with patch("app.routes.customer_pickups.get_supabase_client") as mock_db, \
             patch("app.routes.customer_pickups.get_public_supabase_client") as mock_pub_db:
            mock_db.return_value.table.return_value.select.return_value.eq.return_value.eq.return_value.gt.return_value.execute.return_value.data = [
                {"id": "order-c1", "shop_id": "shop-1", "customer_id": None, "fulfillment_mode": "counter", "status": "completed", "expires_at": "2099-01-01T00:00:00+00"}
            ]
            mock_db.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
            
            res = self.client.get("/api/v3/orders/order-c1/pickup", headers={"X-AutoPrint-Capability": "test-cap"})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["status"], "not_applicable")
            self.assertFalse(res.json()["code_available"])

    # 2. Remote job cannot become ready before confirmed print completion.
    def test_sql_prevents_readiness_before_confirmed_print(self):
        migration_sql = (Path(__file__).parents[1] / "migrations" / "0016_phase3_pickup_lifecycle.sql").read_text(encoding="utf-8")
        self.assertIn("IF v_job.status != 'completed' THEN", migration_sql)
        self.assertIn("pickup_collected_consistency", migration_sql)
        self.assertIn("pickup_ready_requires_times", migration_sql)

    # 3. Both agent-completed and operator-resolved-completed paths change the
    # authoritative job state; migration 0019 synchronizes pickup in that same DB transaction.
    @patch("app.routes.agent.get_authenticated_device")
    @patch("app.routes.agent.get_supabase_client")
    def test_agent_completed_triggers_pickup_creation(self, mock_db, mock_auth):
        mock_auth.return_value = {"id": "device-1", "shop_id": "shop-1"}
        mock_db.return_value.rpc.return_value.execute.return_value.data = True
        
        res = self.client.post(
            "/api/v3/agent/attempts/att-1/outcome",
            headers={"X-AutoPrint-Device-Id": "dev-1", "X-AutoPrint-Device-Secret": "sec"},
            json={
                "job_id": "job-1",
                "fencing_token": "fence-1",
                "outcome_status": "completed",
                "completion_source": "spooler_presumed"
            }
        )
        self.assertEqual(res.status_code, 200)
        calls = [c[0][0] for c in mock_db.return_value.rpc.call_args_list]
        self.assertEqual(calls, ["report_print_outcome"])
        hardening = self._hardening_sql()
        self.assertIn("AFTER UPDATE OF status ON autoprint_v3.print_jobs", hardening)
        self.assertIn("create_or_ready_pickup_after_confirmed_print(NEW.id)", hardening)

    @patch("app.dependencies.verify_session_and_csrf")
    @patch("app.routes.shop_jobs.get_session_shop_id")
    @patch("app.routes.shop_jobs.get_supabase_client")
    def test_operator_resolved_completed_triggers_pickup_creation(self, mock_db, mock_shop_id, mock_auth):
        mock_auth.return_value = {
            "id": "sess-1",
            "user_id": "user-1",
            "role": "owner",
            "shop_memberships": [{"shop_id": "shop-1", "role": "owner", "active": True}]
        }
        mock_shop_id.return_value = "shop-1"
        mock_db.return_value.rpc.return_value.execute.return_value.data = True

        self.client.cookies.set("autoprint_session", "session-123")
        res = self.client.post(
            "/api/v3/shop/jobs/job-1/resolve",
            headers={"X-AutoPrint-CSRF": "csrf-1"},
            json={"outcome_status": "completed", "reason": "Operator confirmed physical sheet output"}
        )
        self.assertEqual(res.status_code, 200)
        calls = [c[0][0] for c in mock_db.return_value.rpc.call_args_list]
        self.assertEqual(calls, ["resolve_uncertain_print_attempt"])
        self.assertIn("sync_pickup_for_print_job_status", self._hardening_sql())

    # 4. Repeated completion callbacks create one pickup and one ready event (idempotency).
    def test_sql_has_dedup_and_idempotency_for_pickup_ready(self):
        migration_sql = (Path(__file__).parents[1] / "migrations" / "0016_phase3_pickup_lifecycle.sql").read_text(encoding="utf-8")
        self.assertIn("ON CONFLICT (dedup_key) DO NOTHING", migration_sql)
        self.assertIn("v_pickup.id IS NOT NULL", migration_sql)
        self.assertIn("already_ready", migration_sql)

    # 5. Code derivation, formatting, normalization, and absence of plaintext in DB.
    def test_pickup_code_derivation_normalization_and_hashing(self):
        code1 = derive_pickup_code("pickup-uuid-1", "order-uuid-1", key_version=1)
        code2 = derive_pickup_code("pickup-uuid-1", "order-uuid-1", key_version=1)
        self.assertEqual(code1, code2)
        self.assertEqual(len(code1), 8)
        for char in "0O1I":
            self.assertNotIn(char, code1)

        # Test normalization handles formatted inputs
        self.assertEqual(normalize_pickup_code(f" {code1[:4]} - {code1[4:]} "), code1)
        self.assertEqual(normalize_pickup_code(f"{code1.lower()}"), code1)

        code_hash = hash_pickup_code(code1, "pickup-uuid-1")
        self.assertTrue(verify_code_hash_constant_time(code1, "pickup-uuid-1", code_hash))
        self.assertTrue(verify_code_hash_constant_time(f" {code1[:4]}-{code1[4:]} ", "pickup-uuid-1", code_hash))
        self.assertFalse(verify_code_hash_constant_time("WRONGCOD", "pickup-uuid-1", code_hash))

    # 6. Unforgeable QR bearer token generation and verification.
    def test_unforgeable_qr_bearer_token(self):
        pickup_id = "p-test-123"
        order_id = "o-test-456"
        token = generate_qr_bearer_token(pickup_id, order_id, key_version=1)
        self.assertTrue(token.startswith("autoprint:pickup:v3:"))
        
        # Valid signature passes
        self.assertTrue(verify_qr_bearer_token(token, pickup_id, order_id, key_version=1))
        
        # Tampered pickup_id or forged signature fails closed
        tampered_pickup = token.replace(pickup_id, "p-forged-999")
        self.assertFalse(verify_qr_bearer_token(tampered_pickup, "p-forged-999", order_id, key_version=1))
        
        # Plain UUID without HMAC signature fails closed
        plain_uuid = f"autoprint:pickup:v3:{pickup_id}"
        self.assertFalse(verify_qr_bearer_token(plain_uuid, pickup_id, order_id, key_version=1))

    # 7. Customer status requires capability AND verified matching customer session for remote orders.
    @patch("app.routes.customer_pickups.require_customer_session")
    @patch("app.routes.customer_pickups.get_supabase_client")
    def test_customer_pickup_status_requires_matching_session(self, mock_db, mock_session):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.eq.return_value.gt.return_value.execute.return_value.data = [
            {"id": "order-1", "shop_id": "shop-1", "customer_id": "cust-A", "fulfillment_mode": "remote", "status": "completed", "expires_at": "2099-01-01T00:00:00+00"}
        ]
        # Session belongs to cust-B -> must fail 403
        mock_session.return_value = {"customer_id": "cust-B"}

        res = self.client.get("/api/v3/orders/order-1/pickup", headers={"X-AutoPrint-Capability": "test-cap"})
        self.assertEqual(res.status_code, 403)

    # 8. Code guessing rate limiting is database-authoritative across workers.
    def test_database_rate_limiter_uses_lock_and_never_falls_back_to_memory(self):
        hardening = self._hardening_sql()
        route_source = (Path(__file__).parents[1] / "app" / "routes" / "shop_pickups.py").read_text(encoding="utf-8")
        self.assertIn("pg_advisory_xact_lock", hardening)
        self.assertIn("interval '15 minutes'", hardening)
        self.assertIn("consume_pickup_attempt", route_source)
        self.assertIn("Pickup verification is temporarily unavailable", route_source)
        self.assertNotIn("check_and_record_pickup_attempt", route_source)

    # 9. Voiding on terminal and failed outcomes is part of the job-state transaction.
    @patch("app.routes.agent.get_authenticated_device")
    @patch("app.routes.agent.get_supabase_client")
    def test_void_pickup_called_on_agent_failed_outcome(self, mock_db, mock_auth):
        mock_auth.return_value = {"id": "device-1", "shop_id": "shop-1"}
        mock_db.return_value.rpc.return_value.execute.return_value.data = True

        res = self.client.post(
            "/api/v3/agent/attempts/att-1/outcome",
            headers={"X-AutoPrint-Device-Id": "dev-1", "X-AutoPrint-Device-Secret": "sec"},
            json={
                "job_id": "job-1",
                "fencing_token": "fence-1",
                "outcome_status": "failed",
                "completion_source": "device_telemetry_confirmed"
            }
        )
        self.assertEqual(res.status_code, 200)
        calls = [c[0][0] for c in mock_db.return_value.rpc.call_args_list]
        self.assertEqual(calls, ["report_print_outcome"])
        hardening = self._hardening_sql()
        self.assertIn("NEW.status IN ('failed', 'rejected', 'cancelled')", hardening)
        self.assertIn("void_pickup_for_terminal_order", hardening)

    @patch("app.dependencies.verify_session_and_csrf")
    @patch("app.routes.shop_jobs.get_session_shop_id")
    @patch("app.routes.shop_jobs.get_supabase_client")
    def test_void_pickup_called_on_shop_rejection(self, mock_db, mock_shop_id, mock_auth):
        mock_auth.return_value = {
            "id": "sess-1",
            "user_id": "user-1",
            "role": "owner",
            "shop_memberships": [{"shop_id": "shop-1", "role": "owner", "active": True}]
        }
        mock_shop_id.return_value = "shop-1"
        mock_db.return_value.rpc.return_value.execute.return_value.data = True

        self.client.cookies.set("autoprint_session", "session-123")
        res = self.client.post(
            "/api/v3/shop/jobs/job-1/reject",
            headers={"X-AutoPrint-CSRF": "csrf-1"},
            json={"reason": "Paper jam or unreadable document"}
        )
        self.assertEqual(res.status_code, 200)
        calls = [c[0][0] for c in mock_db.return_value.rpc.call_args_list]
        self.assertEqual(calls, ["reject_print_job"])

    # 10. CSRF enforcement on mutating shop routes.
    def test_shop_mutating_routes_require_csrf(self):
        # Missing CSRF header
        self.client.cookies.set("autoprint_session", "session-123")
        res = self.client.post("/api/v3/shop/pickups/p-1/collect", json={"code": "23AB78KL"})
        self.assertEqual(res.status_code, 403)
        self.assertIn("CSRF", res.json()["detail"])

    # 11. Expiry worker execution and health metrics.
    @patch("worker.pickup_expiry.get_supabase_client")
    def test_pickup_expiry_worker_cycle_and_health(self, mock_db):
        mock_db.return_value.rpc.return_value.execute.return_value.data = 2
        count = run_pickup_expiry_cycle()
        self.assertEqual(count, 2)
        health = get_worker_health()
        self.assertEqual(health["status"], "healthy")
        self.assertGreaterEqual(health["total_cycles"], 1)
        self.assertGreaterEqual(health["total_expired"], 2)

    # 12. Feature-disable rollback verification.
    def test_sql_feature_disable_skips_creation_and_preserves_rows(self):
        migration_sql = (Path(__file__).parents[1] / "migrations" / "0016_phase3_pickup_lifecycle.sql").read_text(encoding="utf-8")
        self.assertIn("IF v_policy.shop_id IS NULL OR NOT v_policy.pickup_workflow_enabled THEN", migration_sql)
        self.assertIn("pickup_workflow_disabled", migration_sql)

    # 13. Plaintext code absence across DB schema and audit events.
    def test_sql_schema_stores_only_code_hash(self):
        migration_sql = (Path(__file__).parents[1] / "migrations" / "0016_phase3_pickup_lifecycle.sql").read_text(encoding="utf-8")
        self.assertIn("code_hash              text", migration_sql)
        self.assertNotIn("plaintext_code", migration_sql)
        self.assertNotIn("pickup_code text", migration_sql)

    # 14. Manual collection cannot manufacture an idempotency key server-side.
    def test_manual_collection_requires_explicit_idempotency_key(self):
        route_source = (Path(__file__).parents[1] / "app" / "routes" / "shop_pickups.py").read_text(encoding="utf-8")
        self.assertIn("Idempotency-Key is required for manual collection", route_source)
        self.assertNotIn('f"manual-{pickup_id}-{user_id}"', route_source)


if __name__ == "__main__":
    unittest.main()
