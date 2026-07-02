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
        Re-raises exceptions on network failures.
        """
        try:
            updates = {
                "status": status,
                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
            if error_message:
                updates["error"] = error_message
            else:
                updates["error"] = None
                
            if page_count is not None:
                updates["page_count"] = page_count
                
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
        Also records the deletion timestamp in the print_jobs table if job_id is provided.
        Logs a warning on failure but does NOT raise — deletion failure should not
        affect the job's completed status.
        """
        try:
            self.logger.info(f"Deleting cloud file '{file_path}' from Supabase Storage bucket '{config.SUPABASE_BUCKET}'...")
            self.client.storage.from_(config.SUPABASE_BUCKET).remove([file_path])
            self.logger.info(f"Successfully deleted cloud file '{file_path}' from Supabase Storage.")
            # Record deletion timestamp in database for audit trail
            if job_id:
                try:
                    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    self.client.table("print_jobs").update({"file_deleted_at": now_iso}).eq("id", job_id).execute()
                    self.logger.info(f"Recorded file_deleted_at for job {job_id}.")
                except Exception as db_err:
                    self.logger.warning(f"Failed to record file_deleted_at for job {job_id}: {db_err}")
        except Exception as e:
            self.logger.warning(f"Failed to delete cloud file '{file_path}' from Supabase Storage: {e}. File may need manual cleanup.")

    def send_heartbeat(self):
        """Updates last_seen_at in shops table to prove agent is online."""
        try:
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            self.client.table("shops").update({"last_seen_at": now_iso}).eq("id", config.SHOP_ID).execute()
        except Exception as e:
            self.logger.warning(f"Failed to send heartbeat to Supabase: {e}")
