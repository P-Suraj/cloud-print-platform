import os
import unittest
from unittest.mock import patch

from app.settings import Settings


class TestProductionSettings(unittest.TestCase):
    @patch.dict(os.environ, {
        "ENVIRONMENT": "production",
        "SUPABASE_URL": "https://project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service",
        "SUPABASE_ANON_KEY": "anon",
        "SUPABASE_API_ROLE_KEY": "api-role",
        "SUPABASE_WORKER_ROLE_KEY": "worker-role",
        "COOKIE_SECRET": "cookie-secret",
        "PICKUP_CODE_KEY_V1": "pickup-code-key-that-is-longer-than-32-characters",
        "CORS_ALLOWED_ORIGINS": "https://app.example",
    }, clear=True)
    def test_complete_production_configuration_passes(self):
        Settings().validate_production()

    @patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=True)
    def test_mock_production_configuration_is_rejected(self):
        with self.assertRaises(ValueError):
            Settings().validate_production()

    @patch.dict(os.environ, {
        "ENVIRONMENT": "production",
        "SUPABASE_URL": "https://project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service",
        "SUPABASE_ANON_KEY": "anon",
        "SUPABASE_API_ROLE_KEY": "api-role",
        "SUPABASE_WORKER_ROLE_KEY": "worker-role",
        "COOKIE_SECRET": "cookie-secret",
        "CORS_ALLOWED_ORIGINS": "https://app.example",
    }, clear=True)
    def test_default_pickup_secret_is_rejected_in_production(self):
        with self.assertRaises(ValueError):
            Settings().validate_production()


if __name__ == "__main__":
    unittest.main()
