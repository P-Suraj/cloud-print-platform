import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


class TestOrderEntryChannel(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_unknown_submission_channel_is_rejected_before_database_access(self):
        response = self.client.post(
            "/api/v3/shops/CANARY01/orders",
            json={"submission_channel": "forged_priority"},
        )
        self.assertEqual(response.status_code, 422)

    @patch("app.routes.orders.generate_capability_token", return_value=("raw-cap", "hashed-cap"))
    @patch("app.routes.orders.require_customer_session")
    @patch("app.routes.orders.get_public_supabase_client")
    @patch("app.routes.orders.get_supabase_client")
    def test_saved_shop_channel_is_recorded_server_side(self, mock_api_client, mock_public_client, mock_customer, _mock_cap):
        mock_customer.return_value = {"customer_id": "customer-1"}
        public_query = MagicMock()
        public_query.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": "shop-1",
            "is_active": True,
            "migration_mode": "v3_active",
        }]
        mock_public_client.return_value.table.return_value = public_query

        policy_table = MagicMock()
        policy_table.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{
            "remote_orders_enabled": True,
            "remote_orders_paused": False,
            "unpaid_policy": "print_on_arrival",
            "version": 2,
        }]
        mock_api_client.return_value.table.return_value = policy_table
        mock_api_client.return_value.rpc.return_value.execute.return_value.data = {"id": "order-1"}

        response = self.client.post(
            "/api/v3/shops/CANARY01/orders",
            json={"submission_channel": "saved_shop", "fulfillment_mode": "remote"},
        )

        self.assertEqual(response.status_code, 200)
        rpc_name, rpc_payload = mock_api_client.return_value.rpc.call_args.args
        self.assertEqual(rpc_name, "create_customer_order_v3")
        self.assertEqual(rpc_payload["p_submission_channel"], "saved_shop")
        self.assertEqual(rpc_payload["p_shop_id"], "shop-1")
        self.assertEqual(rpc_payload["p_customer_id"], "customer-1")
        self.assertEqual(rpc_payload["p_fulfillment_mode"], "remote")


if __name__ == "__main__":
    unittest.main()
