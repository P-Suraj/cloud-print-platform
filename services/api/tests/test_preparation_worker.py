import unittest
from unittest.mock import patch, MagicMock

from worker.preparation import process_single_preparation_task


class TestPreparationWorker(unittest.TestCase):

    @patch("worker.preparation.validate_pdf_bytes")
    @patch("worker.preparation.claim_next_preparation_task")
    @patch("worker.preparation.get_worker_supabase_client")
    def test_process_preparation_task_success(
        self, mock_db, mock_claim, mock_validate
    ):
        """Worker downloads real bytes from Storage, validates, uploads artifact, completes task."""
        # Minimal valid PDF bytes
        valid_pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nxref\n0 2\ntrailer<</Size 2>>\nstartxref\n9\n%%EOF"

        mock_claim.return_value = {
            "task_id": "task-1",
            "source_document_id": "doc-1",
            "source_object_path": "v3/shop1/order1/test.pdf",
            "options_hash": "hash123",
            "lease_token": "token123",
        }
        mock_validate.return_value = (True, 3, "")

        mock_client = MagicMock()
        # Source document lookup
        mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"order_id": "order-1"}
        ]
        # Authenticated Storage download + artifact upload
        mock_client.storage.from_.return_value.download.return_value = valid_pdf
        mock_client.storage.from_.return_value.upload.return_value = {}
        mock_client.rpc.return_value.execute.return_value.data = True
        mock_db.return_value = mock_client

        res = process_single_preparation_task("test-worker")

        self.assertTrue(res)
        mock_client.rpc.assert_called_once()

    @patch("worker.preparation.claim_next_preparation_task")
    def test_process_preparation_no_tasks(self, mock_claim):
        """Worker returns False gracefully when no tasks are available."""
        mock_claim.return_value = None
        res = process_single_preparation_task("test-worker")
        self.assertFalse(res)

    @patch("worker.preparation.claim_next_preparation_task")
    @patch("worker.preparation.get_worker_supabase_client")
    def test_missing_object_path_fails_task(self, mock_db, mock_claim):
        """Worker marks task failed and returns False if source_object_path is missing."""
        mock_claim.return_value = {
            "task_id": "task-2",
            "source_document_id": "doc-2",
            "source_object_path": None,  # Missing path
            "options_hash": "hash456",
            "lease_token": "token456",
        }
        mock_client = MagicMock()
        mock_db.return_value = mock_client

        res = process_single_preparation_task("test-worker")
        self.assertFalse(res)


if __name__ == "__main__":
    unittest.main()
