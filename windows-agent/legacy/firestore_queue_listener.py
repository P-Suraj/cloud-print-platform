import logging
import firebase_admin
from firebase_admin import credentials, firestore
from queue_listener import QueueListener
import config

class FirestoreQueueListener(QueueListener):
    """
    Queue listener that polls Firestore database for new print jobs.
    Uses atomic transaction to claim jobs to prevent duplicate printing.
    """
    def __init__(self):
        self.logger = logging.getLogger("PrintAgent.FirestoreQueueListener")
        
        # Initialize Firebase Admin SDK if not already initialized
        if not firebase_admin._apps:
            try:
                cred = credentials.Certificate(config.FIREBASE_CREDENTIALS_PATH)
                firebase_admin.initialize_app(cred)
                self.logger.info("Firebase Admin SDK initialized successfully.")
            except Exception as e:
                self.logger.error(f"Failed to initialize Firebase Admin SDK: {e}")
                raise e
        
        self.db = firestore.client()
        self.jobs_ref = self.db.collection("print_jobs")

    def poll_for_next_job(self):
        """
        Polls Firestore for a single job with status 'queued', ordered by 'created_at'.
        Uses a transaction to atomically transition the job to 'processing' to avoid race conditions.
        """
        try:
            # Query for the oldest queued job
            query = self.jobs_ref.where("status", "==", "queued").order_by("created_at").limit(1)
            docs = list(query.stream())
            if not docs:
                return None
            
            target_doc = docs[0]
            job_ref = target_doc.reference
            job_id = target_doc.id
            
            # Use transaction to update status to 'processing' to claim the job safely
            transaction = self.db.transaction()
            
            @firestore.transactional
            def claim_job(tx, doc_ref):
                snapshot = doc_ref.get(transaction=tx)
                if snapshot.exists and snapshot.get("status") == "queued":
                    tx.update(doc_ref, {
                        "status": "processing",
                        "updated_at": firestore.SERVER_TIMESTAMP
                    })
                    return snapshot.to_dict()
                return None
            
            job_data = claim_job(transaction, job_ref)
            if job_data:
                # Add doc ID to job data so agent knows how to reference it
                job_data["id"] = job_id
                return job_data
            
        except Exception as e:
            self.logger.error(f"Error polling/claiming next job from Firestore: {e}")
            
        return None

    def update_job_status(self, job_id, status, error_message=None):
        """
        Updates the job document in Firestore with the final status (completed/failed).
        """
        try:
            doc_ref = self.jobs_ref.document(job_id)
            updates = {
                "status": status,
                "updated_at": firestore.SERVER_TIMESTAMP
            }
            if error_message:
                updates["error"] = error_message
                
            doc_ref.update(updates)
            self.logger.info(f"Updated Firestore job {job_id} status to '{status}'")
        except Exception as e:
            self.logger.error(f"Failed to update status for Firestore job {job_id}: {e}")
