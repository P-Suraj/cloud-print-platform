import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


class TestPhase1RemoteOrders(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @staticmethod
    def _public_shop(mock_public):
        query = MagicMock()
        query.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": "shop-1", "is_active": True, "migration_mode": "v3_active"
        }]
        mock_public.return_value.table.return_value = query

    @patch("app.routes.orders.generate_capability_token", return_value=("raw", "hash"))
    @patch("app.routes.orders.get_supabase_client")
    @patch("app.routes.orders.get_public_supabase_client")
    def test_anonymous_counter_qr_flow_remains_available(self, mock_public, mock_api, _cap):
        self._public_shop(mock_public)
        mock_api.return_value.rpc.return_value.execute.return_value.data = {"id": "order-1"}
        response = self.client.post("/api/v3/shops/CANARY01/orders")
        self.assertEqual(response.status_code, 200)
        _, payload = mock_api.return_value.rpc.call_args.args
        self.assertEqual(payload["p_submission_channel"], "qr")
        self.assertEqual(payload["p_fulfillment_mode"], "counter")
        self.assertIsNone(payload["p_customer_id"])

    @patch("app.routes.orders.get_public_supabase_client")
    def test_remote_order_requires_verified_customer(self, mock_public):
        self._public_shop(mock_public)
        response = self.client.post(
            "/api/v3/shops/CANARY01/orders",
            json={"submission_channel": "shop_code", "fulfillment_mode": "remote"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Verified customer session required")

    @patch("app.routes.orders.require_customer_session", return_value={"customer_id": "customer-1"})
    @patch("app.routes.orders.get_public_supabase_client")
    @patch("app.routes.orders.get_supabase_client")
    def test_paused_shop_refuses_remote_order(self, mock_api, mock_public, _session):
        self._public_shop(mock_public)
        policy = MagicMock()
        policy.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{
            "remote_orders_enabled": True, "remote_orders_paused": True, "unpaid_policy": "print_on_arrival"
        }]
        mock_api.return_value.table.return_value = policy
        response = self.client.post(
            "/api/v3/shops/CANARY01/orders",
            json={"submission_channel": "saved_shop", "fulfillment_mode": "remote"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("paused", response.json()["detail"])

    @patch("app.dependencies.verify_session_and_csrf")
    @patch("app.routes.remote_policy.get_supabase_client")
    def test_shop_can_update_remote_policy_through_audited_rpc(self, mock_db, mock_auth):
        mock_auth.return_value = {
            "user_id": "user-1", "role": "owner",
            "shop_memberships": [{"shop_id": "shop-1", "role": "owner", "active": True}],
        }
        mock_db.return_value.rpc.return_value.execute.return_value.data = {
            "shop_id": "shop-1", "remote_orders_enabled": True,
            "remote_orders_paused": False, "unpaid_policy": "print_on_arrival", "version": 2,
        }
        self.client.cookies.set("autoprint_session", "session")
        response = self.client.put(
            "/api/v3/shop/remote-policy",
            headers={"X-AutoPrint-CSRF": "csrf"},
            json={"remote_orders_enabled": True, "remote_orders_paused": False, "unpaid_policy": "print_on_arrival"},
        )
        self.assertEqual(response.status_code, 200)
        mock_db.return_value.rpc.assert_called_once_with("set_shop_remote_policy", {
            "p_shop_id": "shop-1", "p_user_id": "user-1", "p_enabled": True,
            "p_paused": False, "p_unpaid_policy": "print_on_arrival",
        })

    @patch("app.dependencies.verify_session_and_csrf")
    @patch("app.routes.shop_jobs.get_supabase_client")
    def test_unpaid_risk_override_is_explicit_per_job(self, mock_db, mock_auth):
        mock_auth.return_value = {
            "user_id": "user-1", "role": "owner",
            "shop_memberships": [{"shop_id": "shop-1", "role": "owner", "active": True}],
        }
        mock_db.return_value.rpc.return_value.execute.return_value.data = True
        self.client.cookies.set("autoprint_session", "session")
        response = self.client.post(
            "/api/v3/shop/jobs/job-1/accept-unpaid-risk",
            headers={"X-AutoPrint-CSRF": "csrf"},
            json={"reason": "Known student collecting this afternoon"},
        )
        self.assertEqual(response.status_code, 200)
        mock_db.return_value.rpc.assert_called_once_with("accept_unpaid_preprint_risk", {
            "p_job_id": "job-1", "p_user_id": "user-1",
            "p_reason": "Known student collecting this afternoon",
        })

    @patch("app.routes.customer_orders.require_customer_session", return_value={"customer_id": "customer-1"})
    @patch("app.routes.customer_orders.get_supabase_client")
    def test_customer_order_list_is_scoped_server_side(self, mock_db, _session):
        query = MagicMock()
        query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        mock_db.return_value.table.return_value = query
        response = self.client.get("/api/v3/customer/orders")
        self.assertEqual(response.status_code, 200)
        query.select.return_value.eq.assert_called_once_with("customer_id", "customer-1")

    @patch("app.routes.customer_jobs.require_customer_session", return_value={"customer_id": "customer-1"})
    @patch("app.routes.customer_jobs.get_supabase_client")
    def test_verified_customer_can_check_in_remote_order(self, mock_db, _session):
        mock_db.return_value.rpc.return_value.execute.return_value.data = True
        response = self.client.post(
            "/api/v3/orders/order-1/check-in",
            headers={"X-AutoPrint-Capability": "cap", "X-AutoPrint-Customer-CSRF": "csrf"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "checked_in")


if __name__ == "__main__":
    unittest.main()
