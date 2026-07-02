import os
import json
import glob
import logging

class QueueListener:
    """
    Abstract Base Class for watching and fetching print jobs.
    This enables seamless transition to cloud-based queue listeners.
    """
    def poll_for_next_job(self):
        raise NotImplementedError("Subclasses must implement poll_for_next_job()")

    def update_job_status(self, job_id, status, error_message=None):
        raise NotImplementedError("Subclasses must implement update_job_status()")


class LocalFolderQueueListener(QueueListener):
    """
    A queue listener that watches a local directory for job configuration files.
    Expected job file format: a JSON file matching 'job_*.json' containing metadata.
    """
    def __init__(self, watch_dir):
        self.watch_dir = watch_dir
        self.logger = logging.getLogger("PrintAgent.QueueListener")

    def poll_for_next_job(self):
        """
        Scan the watch directory for job JSON files that are in 'queued' state.
        Returns a dictionary representing the job metadata, or None.
        """
        pattern = os.path.join(self.watch_dir, "job_*.json")
        job_files = glob.glob(pattern)

        for filepath in job_files:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    job_data = json.load(f)
                
                # Check if the job status is eligible for printing
                if job_data.get("status") == "queued":
                    job_data["_meta_filepath"] = filepath
                    return job_data
            except (json.JSONDecodeError, IOError) as e:
                self.logger.error(f"Error reading job config file {os.path.basename(filepath)}: {e}")
                
        return None

    def update_job_status(self, job_id, status, error_message=None):
        """
        Update the status inside the local job JSON file.
        """
        filename = f"job_{job_id}.json"
        filepath = os.path.join(self.watch_dir, filename)
        
        if not os.path.exists(filepath):
            self.logger.warning(f"Cannot update status for job {job_id}; file {filename} does not exist.")
            return

        try:
            with open(filepath, 'r+', encoding='utf-8') as f:
                job_data = json.load(f)
                job_data["status"] = status
                if error_message:
                    job_data["error_message"] = error_message
                
                f.seek(0)
                json.dump(job_data, f, indent=2)
                f.truncate()
            
            self.logger.info(f"Updated job {job_id} status to '{status}'")
        except Exception as e:
            self.logger.error(f"Failed to write status update for job {job_id}: {e}")
