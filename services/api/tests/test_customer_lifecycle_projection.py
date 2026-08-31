import unittest

from app.routes.customer_jobs import _customer_lifecycle


class CustomerLifecycleProjectionTests(unittest.TestCase):
    def test_waiting_is_file_queued(self):
        self.assertEqual(_customer_lifecycle([{"status": "waiting_for_shop", "approved_at": None}])["current"], "file_queued")

    def test_approval_is_distinct_from_printing(self):
        self.assertEqual(_customer_lifecycle([{"status": "waiting_for_shop", "approved_at": "2026-08-31T00:00:00Z"}])["current"], "approved")

    def test_mixed_batch_with_active_attempt_is_printing(self):
        jobs = [{"status": "completed"}, {"status": "printing"}, {"status": "waiting_for_shop", "approved_at": "now"}]
        self.assertEqual(_customer_lifecycle(jobs)["current"], "printing")

    def test_only_all_completed_is_ready(self):
        jobs = [{"status": "completed"}, {"status": "completed"}, {"status": "completed"}]
        self.assertEqual(_customer_lifecycle(jobs)["current"], "ready_for_pickup")


if __name__ == "__main__":
    unittest.main()
