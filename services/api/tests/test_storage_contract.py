import unittest
from unittest.mock import MagicMock, patch

from app.storage import generate_signed_download_url


class TestStorageContract(unittest.TestCase):
    @patch("app.storage.get_supabase_client")
    def test_installed_storage3_signed_url_shape_is_normalized(self, get_client):
        client = MagicMock()
        client.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.example/object/sign/path?token=x"
        }
        get_client.return_value = client
        result = generate_signed_download_url("path.pdf", 60)
        self.assertEqual(result["signed_url"], result["signedURL"])


if __name__ == "__main__":
    unittest.main()
