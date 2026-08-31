import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from datetime import datetime, timedelta, timezone

from app.main import app
from app.queue_estimates import format_queue_estimate

class TestPhase5Estimates(unittest.TestCase):
    def setUp(self):
        self.feature_flag = patch("app.routes.estimates.settings.queue_estimates_enabled", True)
        self.feature_flag.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.feature_flag.stop()

    def test_00_feature_is_dark_launched_by_default(self):
        with patch("app.routes.estimates.settings.queue_estimates_enabled", False):
            response = self.client.get("/api/v3/shops/EST001/estimate?pages=2")
        self.assertEqual(response.status_code, 404)

    def test_01_raw_workload_calculation(self):
        # Format function test
        res = format_queue_estimate({
            "estimated_min": 10,
            "estimated_max": 14,
            "confidence": "high",
            "queue_depth": 2,
            "agent_freshness_seconds": 10
        })
        self.assertEqual(res.estimated_min_minutes, 10)
        self.assertEqual(res.estimated_max_minutes, 14)
        self.assertEqual(res.customer_wording, "Likely ready in 10\u201314 min")
        self.assertEqual(res.confidence, "high")

    def test_02_empty_queue_estimate(self):
        res = format_queue_estimate({
            "estimated_min": 1,
            "estimated_max": 2,
            "confidence": "high",
            "queue_depth": 0,
            "agent_freshness_seconds": 10
        })
        self.assertEqual(res.customer_wording, "Ready soon (< 5 min)")

    @patch("app.routes.estimates.get_supabase_client")
    def test_03_stale_agent_is_unavailable(self, mock_db):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"id": "shop123"}]
        mock_db.return_value.rpc.return_value.execute.return_value.data = {
            "estimated_min": 0, "estimated_max": 0, "confidence": "unavailable", "queue_depth": 0, "agent_freshness_seconds": 120
        }
        
        resp = self.client.get("/api/v3/shops/EST001/estimate?pages=2&copies=1")
        data = resp.json()
        self.assertEqual(data["confidence"], "unavailable")
        self.assertIn("unavailable", data["customer_wording"])

    @patch("app.routes.estimates.get_supabase_client")
    def test_04_walkin_backlog_addition(self, mock_db):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"id": "shop123"}]
        mock_db.return_value.rpc.return_value.execute.return_value.data = {
            "estimated_min": 16, "estimated_max": 22, "confidence": "high", "queue_depth": 1, "agent_freshness_seconds": 5
        }
        resp = self.client.get("/api/v3/shops/EST001/estimate?pages=2&copies=1")
        data = resp.json()
        self.assertEqual(data["estimated_min_minutes"], 16)

    @patch("app.routes.estimates.get_supabase_client")
    def test_05_shop_not_found(self, mock_db):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        resp = self.client.get("/api/v3/shops/NOTFOUND/estimate")
        self.assertEqual(resp.status_code, 404)

    def test_06_unauth_shop_put(self):
        resp = self.client.put("/api/v3/shop/walkin-backlog", json={"lane_type": "bw", "backlog_minutes": 10, "duration_minutes": 30})
        self.assertEqual(resp.status_code, 401)
        
    def test_07_shop_put_lanes_unauth(self):
        resp = self.client.put("/api/v3/shop/printer-lanes", json={
            "lane_type": "bw", "ppm_simplex": 30.0, "ppm_duplex": 20.0, "job_setup_overhead_sec": 10, "enabled": True
        })
        self.assertEqual(resp.status_code, 401)

    @patch("app.routes.estimates.get_supabase_client")
    def test_08_rpc_failure_returns_unavailable(self, mock_db):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"id": "shop123"}]
        mock_db.return_value.rpc.return_value.execute.return_value.data = None
        
        resp = self.client.get("/api/v3/shops/EST001/estimate?pages=2")
        data = resp.json()
        self.assertEqual(data["confidence"], "unavailable")

    @patch("app.routes.estimates.get_supabase_client")
    def test_09_get_queue_settings_unauth(self, mock_db):
        resp = self.client.get("/api/v3/shop/queue-settings")
        self.assertEqual(resp.status_code, 401)

    @patch("app.routes.estimates.get_supabase_client")
    def test_10_page_range_uses_selected_pages_not_document_pages(self, mock_db):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"id": "shop123"}]
        mock_db.return_value.rpc.return_value.execute.return_value.data = {
            "estimated_min": 2, "estimated_max": 3, "confidence": "high", "queue_depth": 0, "agent_freshness_seconds": 4
        }
        response = self.client.get("/api/v3/shops/EST001/estimate?pages=10&page_range=1-2,8&copies=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_db.return_value.rpc.call_args.args[1]["p_job_pages"], 3)

    def test_11_unknown_confidence_never_looks_ready(self):
        result = format_queue_estimate({"estimated_min": 1, "estimated_max": 2, "confidence": "degraded", "queue_depth": 2, "agent_freshness_seconds": 9})
        self.assertEqual(result.confidence, "degraded")
        self.assertIn("unavailable", result.customer_wording.lower())
