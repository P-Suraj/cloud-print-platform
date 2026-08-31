import unittest
from unittest.mock import patch, MagicMock
import time

from worker.cleanup import process_storage_cleanup_once


def _past_ts() -> str:
    """Return a timestamp 1 hour in the past."""
    return time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime(time.time() - 3600))


def _build_table_mock(name, expired_doc=None, live_jobs=False):
    """
    Build a MagicMock for a table call that correctly chains the methods
    used by process_storage_cleanup_once for source_documents, print_jobs,
    and print_artifacts.
    """
    t = MagicMock()
    if name == "source_documents":
        data = [expired_doc] if expired_doc else []
        # Source docs SELECT chain: .select().eq().lt().limit().execute()
        t.select.return_value.eq.return_value.lt.return_value.limit.return_value.execute.return_value.data = data
        # UPDATE chain
        t.update.return_value.eq.return_value.execute.return_value.data = []
    elif name == "print_jobs":
        jobs_data = [{"id": "live-job"}] if live_jobs else []
        # Live jobs chain: .select().eq().not_.in_().execute()
        (t.select.return_value
          .eq.return_value
          .not_
          .in_.return_value
          .execute.return_value.data) = jobs_data
    elif name == "print_artifacts":
        # Artifacts SELECT: no expired artifacts
        t.select.return_value.eq.return_value.lt.return_value.limit.return_value.execute.return_value.data = []
    return t


class TestStorageCleanup(unittest.TestCase):

    @patch("worker.cleanup.get_worker_supabase_client")
    def test_cleanup_skips_live_job_documents(self, mock_db):
        """Cleanup must NOT delete a source_document that has a live print_job."""
        mock_client = MagicMock()
        mock_db.return_value = mock_client

        expired_doc = {"id": "doc-1", "object_path": "v3/shop1/order1/doc1.pdf", "order_id": "order-1"}

        def table_se(name):
            return _build_table_mock(name, expired_doc=expired_doc, live_jobs=True)

        mock_client.table.side_effect = table_se

        deleted = process_storage_cleanup_once()
        self.assertEqual(deleted, 0, "Must not delete documents with live jobs")
        mock_client.storage.from_.assert_not_called()

    @patch("worker.cleanup.get_worker_supabase_client")
    def test_cleanup_deletes_expired_no_live_jobs(self, mock_db):
        """Cleanup deletes source_document when retention expired and no live jobs."""
        mock_client = MagicMock()
        mock_db.return_value = mock_client

        expired_doc = {"id": "doc-2", "object_path": "v3/shop1/order2/doc2.pdf", "order_id": "order-2"}

        call_counts = {"source_documents": 0}

        def table_se(name):
            t = _build_table_mock(name, expired_doc=None if call_counts["source_documents"] > 0 else expired_doc, live_jobs=False)
            if name == "source_documents":
                call_counts["source_documents"] += 1
            return t

        mock_client.table.side_effect = table_se
        mock_client.storage.from_.return_value.remove.return_value = {}

        deleted = process_storage_cleanup_once()
        self.assertGreaterEqual(deleted, 1, "Expired document with no live jobs should be deleted")

    @patch("worker.cleanup.get_worker_supabase_client")
    def test_dry_run_does_not_delete(self, mock_db):
        """--dry-run mode must not call Storage or mark rows deleted."""
        mock_client = MagicMock()
        mock_db.return_value = mock_client

        expired_doc = {"id": "doc-3", "object_path": "v3/shop1/order3/doc3.pdf", "order_id": "order-3"}

        def table_se(name):
            return _build_table_mock(name, expired_doc=expired_doc, live_jobs=False)

        mock_client.table.side_effect = table_se

        deleted = process_storage_cleanup_once(dry_run=True)
        self.assertGreaterEqual(deleted, 1, "Dry run should report 1 candidate")
        # Storage remove should NOT have been called in dry_run mode
        mock_client.storage.from_.assert_not_called()


if __name__ == "__main__":
    unittest.main()
