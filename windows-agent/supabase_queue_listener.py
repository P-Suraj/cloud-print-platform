import logging
import os
import datetime
from supabase import create_client, Client
from queue_listener import QueueListener
import config

class SupabaseQueueListener(QueueListener):
    """
    Queue listener that polls Supabase database for new print jobs.
    Uses a PostgreSQL RPC function to atomically claim jobs.
    Supports connection re-initialization on failures.
    """
    def __init__(self):
        self.logger = logging.getLogger("PrintAgent.SupabaseQueueListener")
        self.client = None
        self.connect()

    def connect(self):
        """Initializes a new Supabase client connection."""
        try:
            self.client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
            self.logger.info("Supabase client initialized successfully.")
        except Exception as e:
            self.logger.error(f"Failed to initialize Supabase client: {e}")
            raise e

    def reconnect(self):
        """Closes old resources and establishes a fresh connection client."""
        self.logger.info("Re-establishing Supabase client connection...")
        self.connect()

    def poll_for_next_job(self):
        """
        Polls Supabase for a single job with status 'queued' using the RPC function.
        Re-raises exceptions so that the main loop can detect connection failures.
        """
        try:
            response = self.client.rpc("claim_next_job", {"target_shop_id": config.SHOP_ID}).execute()
            job_data = response.data
            if job_data:
                return job_data
        except Exception as e:
            self.logger.error(f"Error polling next job from Supabase: {e}")
            raise e
            
        return None

    def log_event(self, event_type, metadata=None):
        """Logs a telemetry event to the public events table."""
        try:
            insert_data = {
                "shop_id": config.SHOP_ID,
                "event_type": event_type,
                "metadata": metadata or {}
            }
            self.client.table("events").insert(insert_data).execute()
            self.logger.info(f"Logged telemetry event: {event_type}")
        except Exception as e:
            self.logger.warning(f"Failed to log telemetry event '{event_type}': {e}")

    def update_job_status(self, job_id, status, error_message=None, page_count=None, file_path=None):
        """
        Updates the job row in Supabase print_jobs table with final status.
        Also records analytics timestamps: started_printing_at when processing begins,
        completed_at when printing finishes.
        Re-raises exceptions on network failures.
        """
        try:
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            updates = {
                "status": status,
                "updated_at": now_iso
            }
            if error_message:
                updates["error"] = error_message
            else:
                updates["error"] = None

            if page_count is not None:
                updates["page_count"] = page_count

            # Analytics: record precise timestamps for latency/throughput metrics
            if status == "processing":
                updates["started_printing_at"] = now_iso
            elif status == "completed":
                updates["completed_at"] = now_iso

            self.client.table("print_jobs").update(updates).eq("id", job_id).execute()
            self.logger.info(f"Updated Supabase job {job_id} status to '{status}'")

            # Log telemetry events for final states
            if status == "completed":
                self.log_event("job_completed", {"job_id": job_id})
                if file_path:
                    self.delete_file(file_path, job_id=job_id)
            elif status == "failed":
                self.log_event("job_failed", {
                    "job_id": job_id,
                    "error": error_message or "Unknown failure"
                })
        except Exception as e:
            self.logger.error(f"Failed to update status for Supabase job {job_id}: {e}")
            raise e

    def download_file(self, file_path, dest_path):
        """
        Downloads the PDF file from the Supabase Storage bucket and writes it to dest_path.
        Re-raises exceptions on download failures.
        """
        try:
            self.logger.info(f"Downloading file '{file_path}' from Supabase Storage bucket '{config.SUPABASE_BUCKET}'...")
            
            # The download API returns raw bytes of the file
            file_bytes = self.client.storage.from_(config.SUPABASE_BUCKET).download(file_path)
            
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            with open(dest_path, "wb") as f:
                f.write(file_bytes)
                
            self.logger.info(f"Successfully downloaded file to isolated path: {dest_path}")
            return True
        except Exception as e:
            self.logger.error(f"Failed to download file '{file_path}' from Supabase Storage: {e}")
            raise e

    def delete_file(self, file_path, job_id=None):
        """
        Permanently deletes the PDF file from Supabase Storage after successful printing.

        CRITICAL ORDERING:
          1. Delete from Storage first.
          2. Only AFTER confirmed deletion: null file_path and set file_deleted_at.
          3. If Storage deletion fails: keep file_path intact and mark storage_cleanup_pending=True
             so the agent can retry on next cycle without losing the reference.

        Logs a warning on failure but does NOT raise — deletion failure should not
        affect the job's completed status.
        """
        try:
            self.logger.info(f"Deleting cloud file '{file_path}' from Supabase Storage bucket '{config.SUPABASE_BUCKET}'...")
            self.client.storage.from_(config.SUPABASE_BUCKET).remove([file_path])
            # Storage deletion confirmed — now safe to null the reference
            self.logger.info(f"Storage deletion confirmed for '{file_path}'.")
            if job_id:
                try:
                    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    self.client.table("print_jobs").update({
                        "file_deleted_at": now_iso,
                        "file_path": None,          # Safe: storage delete confirmed above
                        "storage_cleanup_pending": False
                    }).eq("id", job_id).execute()
                    self.logger.info(f"Nulled file_path and recorded file_deleted_at for job {job_id}.")
                except Exception as db_err:
                    self.logger.warning(f"Storage deleted but failed to update DB for job {job_id}: {db_err}")
        except Exception as e:
            # Storage deletion FAILED — do NOT null file_path so we can retry later
            self.logger.warning(
                f"Storage deletion failed for '{file_path}': {e}. "
                f"file_path retained in DB. Marking storage_cleanup_pending=True for retry."
            )
            if job_id:
                try:
                    self.client.table("print_jobs").update({
                        "storage_cleanup_pending": True  # Agent will retry on next cycle
                    }).eq("id", job_id).execute()
                except Exception as db_err:
                    self.logger.warning(f"Failed to mark storage_cleanup_pending for job {job_id}: {db_err}")

    def retry_pending_deletions(self):
        """
        Retries storage deletions for jobs where storage_cleanup_pending=True.
        Called periodically by the main agent loop.
        On success: nulls file_path and clears the flag.
        On continued failure: leaves flag set for the next retry cycle.
        """
        try:
            response = self.client.table("print_jobs") \
                .select("id, file_path") \
                .eq("storage_cleanup_pending", True) \
                .not_.is_("file_path", None) \
                .execute()
            pending = response.data or []
            if not pending:
                return
            self.logger.info(f"Retrying storage deletion for {len(pending)} pending job(s).")
            for job in pending:
                self.delete_file(job["file_path"], job_id=job["id"])
        except Exception as e:
            self.logger.warning(f"retry_pending_deletions failed: {e}")

    def send_heartbeat(self, bw_printer="", color_printer=""):
        """Updates last_seen_at and printer destinations in shops table to prove agent is online."""
        try:
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            update_payload = {"last_seen_at": now_iso}
            if bw_printer:
                update_payload["printer_bw"] = bw_printer
            if color_printer:
                update_payload["printer_color"] = color_printer

            # Update by shop ID
            res = self.client.table("shops").update(update_payload).eq("id", config.SHOP_ID).execute()
            # Also update by shop_code if SHOP_ID is set to a code like TST001
            if not res.data:
                self.client.table("shops").update(update_payload).eq("shop_code", config.SHOP_ID).execute()
        except Exception as e:
            self.logger.warning(f"Failed to send heartbeat to Supabase: {e}")
