import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from datetime import datetime, time, date, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app
from app.maps_url import validate_maps_url
from app.shop_hours import compute_is_open_now, parse_time_str


class TestPhase4DiscoveryWorkflow(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    # 1. Nearby search returns shops within radius in ascending distance order
    @patch("app.routes.discovery.get_supabase_client")
    def test_nearby_search_returns_ordered_shops(self, mock_db):
        mock_db.return_value.rpc.return_value.execute.return_value.data = [
            {
                "shop_id": "shop-1",
                "shop_code": "CANARY01",
                "name": "Canary Print Hub",
                "address_line": "Campus Gate 1",
                "locality": "North Campus",
                "pincode": "560001",
                "maps_url": "https://maps.google.com/?q=Canary",
                "distance_km": 0.3,
                "manual_closed_override": False,
                "timezone": "Asia/Kolkata",
                "remote_orders_enabled": True,
                "remote_orders_paused": False,
                "bw_printing": True,
                "colour_printing": True,
                "a4_paper": True,
                "a3_paper": False,
                "duplex_printing": True
            },
            {
                "shop_id": "shop-2",
                "shop_code": "SHOP02",
                "name": "South Campus Xerox",
                "address_line": "Library Block",
                "locality": "South Campus",
                "pincode": "560001",
                "maps_url": "https://maps.google.com/?q=South",
                "distance_km": 1.2,
                "manual_closed_override": False,
                "timezone": "Asia/Kolkata",
                "remote_orders_enabled": False,
                "remote_orders_paused": False,
                "bw_printing": True,
                "colour_printing": False,
                "a4_paper": True,
                "a3_paper": False,
                "duplex_printing": False
            }
        ]
        mock_db.return_value.table.return_value.select.return_value.in_.return_value.execute.return_value.data = []
        mock_db.return_value.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value.data = []

        res = self.client.get("/api/v3/discovery/shops/nearby?lat=12.9716&lng=77.5946&radius_km=5")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["shops"][0]["shop_code"], "CANARY01")
        self.assertEqual(data["shops"][0]["distance_km"], 0.3)
        self.assertEqual(data["shops"][1]["distance_km"], 1.2)
        self.assertTrue(data["shops"][0]["remote_orders_available"])

    # 2. Search with locality string returns shops in that locality (GPS-denied path)
    @patch("app.routes.discovery.get_public_supabase_client")
    @patch("app.routes.discovery.get_supabase_client")
    def test_search_by_locality_fallback(self, mock_db, mock_pub_db):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.ilike.return_value.limit.return_value.execute.return_value.data = [
            {
                "shop_id": "shop-1",
                "address_line": "Gate 2",
                "locality": "Engineering Block",
                "pincode": "560001",
                "maps_url": "https://maps.google.com/?q=Engg",
                "timezone": "Asia/Kolkata",
                "manual_closed_override": False,
                "discovery_enabled": True
            }
        ]
        mock_pub_db.return_value.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value.data = [
            {"id": "shop-1", "shop_code": "ENGG01", "name": "Engineering Print Shop", "is_active": True, "migration_mode": "v3_canary"}
        ]
        mock_db.return_value.table.return_value.select.return_value.in_.return_value.execute.return_value.data = []
        mock_db.return_value.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value.data = []

        res = self.client.get("/api/v3/discovery/shops/search?locality=Engineering")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["shops"][0]["shop_code"], "ENGG01")
        self.assertEqual(data["shops"][0]["locality"], "Engineering Block")
        self.assertIsNone(data["shops"][0]["distance_km"])

    # 3. Search with pincode string returns shops in that PIN code
    @patch("app.routes.discovery.get_public_supabase_client")
    @patch("app.routes.discovery.get_supabase_client")
    def test_search_by_pincode_fallback(self, mock_db, mock_pub_db):
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {
                "shop_id": "shop-1",
                "address_line": "Main Street",
                "locality": "University Town",
                "pincode": "560037",
                "maps_url": "https://maps.google.com/?q=Uni",
                "timezone": "Asia/Kolkata",
                "manual_closed_override": False,
                "discovery_enabled": True
            }
        ]
        mock_pub_db.return_value.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value.data = [
            {"id": "shop-1", "shop_code": "UNI01", "name": "Uni Central Print", "is_active": True, "migration_mode": "v3_canary"}
        ]
        mock_db.return_value.table.return_value.select.return_value.in_.return_value.execute.return_value.data = []
        mock_db.return_value.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value.data = []

        res = self.client.get("/api/v3/discovery/shops/search?pincode=560037")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["shops"][0]["pincode"], "560037")

    # 4. open_now filter and helper calculation
    def test_open_now_calculation_open_and_closed(self):
        weekly_hours = [
            {"day_of_week": 1, "opens_at": "09:00", "closes_at": "20:00", "is_closed": False}
        ]
        # Monday at 11:00 UTC (16:30 IST) -> OPEN
        monday_noon = datetime(2026, 8, 24, 11, 0, 0, tzinfo=timezone.utc)
        res_open = compute_is_open_now(weekly_hours, [], manual_closed_override=False, shop_timezone="Asia/Kolkata", now_utc=monday_noon)
        self.assertTrue(res_open["is_open"])
        self.assertEqual(res_open["reason"], "open")

        # Monday at 19:00 UTC (00:30 IST Tuesday) -> OUTSIDE HOURS
        monday_night = datetime(2026, 8, 24, 19, 0, 0, tzinfo=timezone.utc)
        res_closed = compute_is_open_now(weekly_hours, [], manual_closed_override=False, shop_timezone="Asia/Kolkata", now_utc=monday_night)
        self.assertFalse(res_closed["is_open"])

    # 5. Holiday exception overrides weekly hours
    def test_holiday_exception_overrides_weekly_schedule(self):
        weekly_hours = [
            {"day_of_week": 1, "opens_at": "09:00", "closes_at": "20:00", "is_closed": False}
        ]
        exceptions = [
            {"exception_date": "2026-08-24", "is_closed": True, "note": "National Holiday"}
        ]
        monday_noon = datetime(2026, 8, 24, 11, 0, 0, tzinfo=timezone.utc)
        res = compute_is_open_now(weekly_hours, exceptions, manual_closed_override=False, shop_timezone="Asia/Kolkata", now_utc=monday_noon)
        self.assertFalse(res["is_open"])
        self.assertEqual(res["reason"], "holiday")

    # 6. Manual closed override wins over published open hours
    def test_manual_closed_override_always_wins(self):
        weekly_hours = [
            {"day_of_week": 1, "opens_at": "09:00", "closes_at": "20:00", "is_closed": False}
        ]
        monday_noon = datetime(2026, 8, 24, 11, 0, 0, tzinfo=timezone.utc)
        res = compute_is_open_now(
            weekly_hours, [], manual_closed_override=True,
            manual_closed_until="2026-08-25T00:00:00+00:00",
            shop_timezone="Asia/Kolkata", now_utc=monday_noon
        )
        self.assertFalse(res["is_open"])
        self.assertEqual(res["reason"], "manual_override")

    def test_expired_manual_override_no_longer_closes_shop(self):
        weekly_hours = [{"day_of_week": 1, "opens_at": "09:00", "closes_at": "20:00", "is_closed": False}]
        monday_noon = datetime(2026, 8, 24, 11, 0, 0, tzinfo=timezone.utc)
        res = compute_is_open_now(
            weekly_hours, [], manual_closed_override=True,
            manual_closed_until="2026-08-24T10:00:00+00:00",
            shop_timezone="Asia/Kolkata", now_utc=monday_noon
        )
        self.assertTrue(res["is_open"])

    # 7. Radius cap (>25 km) is rejected with 422
    def test_radius_over_25km_rejected(self):
        res = self.client.get("/api/v3/discovery/shops/nearby?lat=12.9716&lng=77.5946&radius_km=30.0")
        self.assertEqual(res.status_code, 422)
        self.assertIn("25 km", res.json()["detail"])

    # 8. Invalid coordinates are rejected
    def test_invalid_coordinates_rejected(self):
        res = self.client.get("/api/v3/discovery/shops/nearby?lat=999.0&lng=77.5946")
        self.assertEqual(res.status_code, 422)

    # 9. Invalid/injected maps_url is rejected
    def test_maps_url_validation(self):
        # Valid links
        self.assertTrue(validate_maps_url("https://maps.google.com/?q=AutoPrint+Shop"))
        self.assertTrue(validate_maps_url("https://www.google.com/maps/place/PrintHub/@12.97,77.59,17z"))
        self.assertTrue(validate_maps_url("https://maps.app.goo.gl/abcdef12345"))
        self.assertTrue(validate_maps_url("https://goo.gl/maps/xyz987"))

        # Invalid or dangerous links
        self.assertFalse(validate_maps_url("javascript:alert(1)"))
        self.assertFalse(validate_maps_url("http://maps.google.com/?q=UnsafeHttp"))
        self.assertFalse(validate_maps_url("https://evil-phishing.com/maps.google.com"))
        self.assertFalse(validate_maps_url("https://google.com.attacker.com/maps"))
        self.assertFalse(validate_maps_url("data:text/html,<script>alert(1)</script>"))

    # 10. Internal fields never appear in public profile response
    @patch("app.routes.discovery.get_public_supabase_client")
    @patch("app.routes.discovery.get_supabase_client")
    def test_public_profile_redacts_internal_fields(self, mock_db, mock_pub_db):
        mock_pub_db.return_value.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": "shop-secret-uuid-123", "shop_code": "CANARY01", "name": "Canary Shop", "is_active": True, "migration_mode": "v3_canary"}
        ]
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {
                "shop_id": "shop-secret-uuid-123",
                "lat": 12.9716,
                "lng": 77.5946,
                "address_line": "Campus Main Street",
                "locality": "Central Campus",
                "pincode": "560001",
                "maps_url": "https://maps.google.com/?q=Canary",
                "updated_by_user_id": "user-secret-uuid-456"
            }
        ]
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        mock_db.return_value.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []

        res = self.client.get("/api/v3/discovery/shops/CANARY01/profile")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        
        # Verify public fields are present
        self.assertEqual(body["shop_code"], "CANARY01")
        self.assertEqual(body["name"], "Canary Shop")
        self.assertEqual(body["locality"], "Central Campus")

        # Verify internal sensitive fields are strictly ABSENT
        self.assertNotIn("id", body)
        self.assertNotIn("shop_id", body)
        self.assertNotIn("updated_by_user_id", body)
        self.assertNotIn("lat", body)
        self.assertNotIn("lng", body)
        self.assertNotIn("device_id", body)

    # 11. Discovery flag off: shop excluded in SQL
    def test_sql_filters_discovery_flag(self):
        migration_sql = (Path(__file__).parents[1] / "migrations" / "0017_phase4_shop_discovery.sql").read_text(encoding="utf-8")
        self.assertIn("loc.discovery_enabled = true", migration_sql)
        self.assertIn("s.is_active = true", migration_sql)

    # 12. Overnight hours handled correctly
    def test_overnight_hours_calculation(self):
        # 20:00 to 04:00 overnight shift
        weekly_hours = [
            {"day_of_week": 1, "opens_at": "20:00", "closes_at": "04:00", "is_closed": False}
        ]
        # 22:00 -> OPEN
        t_2200 = datetime(2026, 8, 24, 16, 30, 0, tzinfo=timezone.utc) # 22:00 IST
        res_open = compute_is_open_now(weekly_hours, [], manual_closed_override=False, shop_timezone="Asia/Kolkata", now_utc=t_2200)
        self.assertTrue(res_open["is_open"])

        # 02:00 next day -> OPEN
        t_0200 = datetime(2026, 8, 24, 20, 30, 0, tzinfo=timezone.utc) # 02:00 IST
        res_open_late = compute_is_open_now(weekly_hours, [], manual_closed_override=False, shop_timezone="Asia/Kolkata", now_utc=t_0200)
        self.assertTrue(res_open_late["is_open"])

        # 10:00 day time -> CLOSED
        t_1000 = datetime(2026, 8, 24, 4, 30, 0, tzinfo=timezone.utc) # 10:00 IST
        res_closed = compute_is_open_now(weekly_hours, [], manual_closed_override=False, shop_timezone="Asia/Kolkata", now_utc=t_1000)
        self.assertFalse(res_closed["is_open"])

    # 13. Remote orders filter excludes paused shops
    def test_sql_filters_paused_remote_orders(self):
        migration_sql = (Path(__file__).parents[1] / "migrations" / "0017_phase4_shop_discovery.sql").read_text(encoding="utf-8")
        self.assertIn("NOT c.c_remote_orders_paused", migration_sql)
        self.assertIn("c.c_remote_orders_enabled", migration_sql)

    def test_phase4_hardening_uses_coordinate_directions_and_expiring_closure(self):
        migration_sql = (Path(__file__).parents[1] / "migrations" / "0020_phase4_discovery_safety_hardening.sql").read_text(encoding="utf-8")
        self.assertIn("manual_closed_until", migration_sql)
        self.assertIn("now() + interval '12 hours'", migration_sql)
        self.assertIn("https://www.google.com/maps/dir/?api=1&destination=", migration_sql)
        self.assertNotIn("loc.maps_url AS c_maps_url", migration_sql)


if __name__ == "__main__":
    unittest.main()
