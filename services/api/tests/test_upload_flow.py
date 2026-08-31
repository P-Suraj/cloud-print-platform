import unittest
import io
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from pypdf import PdfWriter

from app.main import app

class TestUploadFlow(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_upload_intent_non_pdf_rejected(self):
        headers = {"X-AutoPrint-Capability": "mock-cap-123"}
        payload = {
            "original_file_name": "document.docx",
            "declared_media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "byte_size": 5000
        }
        response = self.client.post("/api/v3/orders/order-123/upload-intent", json=payload, headers=headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Only application/pdf media type is allowed in M1")

    def test_upload_intent_oversized_rejected(self):
        headers = {"X-AutoPrint-Capability": "mock-cap-123"}
        payload = {
            "original_file_name": "huge.pdf",
            "declared_media_type": "application/pdf",
            "byte_size": 30000000 # 30MB
        }
        response = self.client.post("/api/v3/orders/order-123/upload-intent", json=payload, headers=headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "File size exceeds maximum 25 MB limit")

    def test_finalize_invalid_source_document_not_found(self):
        """finalize-upload returns 404 if the source_document does not belong to the order."""
        headers = {"X-AutoPrint-Capability": "mock-cap-123"}
        payload = {"source_document_id": "doc-missing"}

        with patch("app.routes.uploads.get_supabase_client") as mock_db:
            mock_client = MagicMock()
            # Order found
            mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "order-123", "shop_id": "shop-1", "capability_hash": "cap-h"}
            ]
            # But source_document not found for this order
            def side_effect_table(name):
                t = MagicMock()
                if name == "orders":
                    t.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                        {"id": "order-123", "shop_id": "shop-1", "capability_hash": "cap-h"}
                    ]
                elif name == "source_documents":
                    t.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
                return t
            mock_client.table.side_effect = side_effect_table
            mock_db.return_value = mock_client

            response = self.client.post("/api/v3/orders/order-123/finalize-upload", json=payload, headers=headers)
            self.assertEqual(response.status_code, 404)

    def test_finalize_claim_rpc_error_is_logged_and_returned_as_controlled_503(self):
        """A downstream PostgREST failure must not escape as an opaque API 500."""
        pdf = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.write(pdf)
        pdf_bytes = pdf.getvalue()

        mock_client = MagicMock()

        def table_side_effect(name):
            query = MagicMock()
            if name == "orders":
                query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "order-123"}
                ]
            elif name == "source_documents":
                query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{
                    "id": "document-123",
                    "object_path": "v3/test/document.pdf",
                    "declared_byte_size": len(pdf_bytes),
                    "finalized_at": None,
                }]
            return query

        mock_client.table.side_effect = table_side_effect
        mock_client.storage.from_.return_value.download.return_value = pdf_bytes

        def rpc_side_effect(name, _payload):
            call = MagicMock()
            if name == "finalize_source_document":
                call.execute.return_value.data = [True]
            elif name == "claim_preparation_task_for_document":
                call.execute.side_effect = APIError({
                    "code": "42702",
                    "message": "column reference is ambiguous",
                    "details": "redacted diagnostic detail",
                    "hint": None,
                })
            return call

        mock_client.rpc.side_effect = rpc_side_effect

        with patch("app.routes.uploads.get_supabase_client", return_value=mock_client):
            with self.assertLogs("autoprint.uploads", level="ERROR") as logs:
                response = self.client.post(
                    "/api/v3/orders/order-123/finalize-upload",
                    json={"source_document_id": "document-123"},
                    headers={"X-AutoPrint-Capability": "mock-cap-123"},
                )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "Your PDF could not be prepared. Please try again.")
        self.assertIn("claim_preparation_task_for_document", logs.output[0])
        self.assertIn("42702", logs.output[0])

if __name__ == "__main__":
    unittest.main()
