import unittest
from unittest.mock import MagicMock, patch

from supabase.lib.client_options import SyncClientOptions as ClientOptions

import app.db as db


class TestDatabaseClients(unittest.TestCase):
    def tearDown(self):
        db._supabase_client = None
        db._public_client = None
        db._worker_client = None

    @patch("app.db.create_client")
    def test_api_client_uses_anon_gateway_key_and_v3_role_authorization(self, create_client):
        client = MagicMock()
        create_client.return_value = client
        result = db.get_supabase_client()
        _, key, options = create_client.call_args.args[0], create_client.call_args.args[1], create_client.call_args.kwargs["options"]
        self.assertEqual(key, db.settings.supabase_anon_key)
        self.assertIsInstance(options, ClientOptions)
        self.assertEqual(options.schema, "autoprint_v3")
        self.assertFalse(options.persist_session)
        self.assertEqual(options.headers["Authorization"], f"Bearer {db.settings.supabase_api_role_key}")

    @patch("app.db.create_client")
    def test_opaque_secret_key_stays_in_trusted_runtime(self, create_client):
        client = MagicMock()
        create_client.return_value = client
        with patch.object(db.settings, "supabase_service_key", "sb_secret_server_only"):
            result = db._create_role_client("custom-role-token", "autoprint_v3")
        self.assertIs(result, client)
        self.assertEqual(create_client.call_args.args[1], "sb_secret_server_only")
        options = create_client.call_args.kwargs["options"]
        self.assertEqual(options.schema, "autoprint_v3")
        self.assertNotIn("Authorization", options.headers)

    @patch("app.db.create_client")
    def test_worker_client_is_separate_and_least_privilege(self, create_client):
        client = MagicMock()
        create_client.return_value = client
        result = db.get_worker_supabase_client()
        self.assertEqual(create_client.call_args.args[1], db.settings.supabase_anon_key)
        self.assertEqual(create_client.call_args.kwargs["options"].schema, "autoprint_v3")
        self.assertEqual(create_client.call_args.kwargs["options"].headers["Authorization"], f"Bearer {db.settings.supabase_worker_role_key}")

    @patch("app.db.create_client")
    def test_auth_client_is_isolated_and_non_persistent(self, create_client):
        create_client.return_value = MagicMock()
        db.create_auth_client()
        options = create_client.call_args.kwargs["options"]
        self.assertEqual(create_client.call_args.args[1], db.settings.supabase_anon_key)
        self.assertFalse(options.persist_session)
        self.assertFalse(options.auto_refresh_token)


if __name__ == "__main__":
    unittest.main()
