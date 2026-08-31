import hashlib
from app.db import get_worker_supabase_client
from app.pdf_validation import validate_pdf_bytes
from app.settings import settings
from worker.task_store import claim_next_preparation_task


def _download_bytes_from_signed_url(signed_url: str) -> bytes:
    """Download bytes from a signed Supabase Storage URL."""
    import urllib.request as _urlreq
    with _urlreq.urlopen(signed_url, timeout=60) as resp:
        return resp.read()


def _fail_task(client, task_id: str, lease_token: str, message: str) -> None:
    client.rpc("fail_preparation_task", {
        "p_task_id": task_id,
        "p_lease_token": lease_token,
        "p_error": message,
    }).execute()


def process_single_preparation_task(worker_id: str = "worker-1") -> bool:
    """
    Process a single leased preparation task.

    Steps:
      1. Claim next pending task (with lease).
      2. Fetch source_object_path from the claimed task.
      3. Download actual PDF bytes from Supabase Storage.
      4. Validate PDF and compute sha256 + page_count from real bytes.
      5. Upload prepared artifact to Storage under artifacts/ prefix.
      6. Atomically attach the artifact, complete the lease and advance the order.
    """
    task = claim_next_preparation_task(worker_id)
    if not task:
        return False

    task_id = task["task_id"]
    doc_id = task["source_document_id"]
    source_object_path = task.get("source_object_path")
    lease_token = task["lease_token"]

    client = get_worker_supabase_client()

    if not source_object_path:
        _fail_task(client, task_id, lease_token, "source_object_path is missing from task")
        return False

    # --- Download real source bytes from Storage ---
    # Use the authenticated worker client. Fetching a freshly signed public URL
    # from a serverless function can hang and exhaust the request timeout.
    try:
        file_bytes = client.storage.from_(settings.storage_bucket).download(source_object_path)
    except Exception as exc:
        _fail_task(client, task_id, lease_token, f"Failed to download source document: {exc}")
        return False

    if not file_bytes:
        _fail_task(client, task_id, lease_token, "Downloaded source document is empty")
        return False

    # --- Validate PDF ---
    is_valid, page_count, err_msg = validate_pdf_bytes(file_bytes)
    if not is_valid:
        _fail_task(client, task_id, lease_token, f"PDF validation failed: {err_msg}")
        return False

    sha256_hash = hashlib.sha256(file_bytes).hexdigest()
    expected_sha256 = task.get("source_sha256")
    if expected_sha256 and sha256_hash != expected_sha256:
        _fail_task(client, task_id, lease_token, "Source document SHA-256 no longer matches finalized metadata")
        return False

    # --- Upload prepared artifact to Storage ---
    artifact_path = f"artifacts/{doc_id}/{sha256_hash}.pdf"
    try:
        storage_bucket = client.storage.from_(settings.storage_bucket)
        storage_bucket.upload(
            artifact_path,
            file_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"}
        )
    except Exception as exc:
        _fail_task(client, task_id, lease_token, f"Failed to upload artifact to Storage: {exc}")
        return False

    # The RPC verifies the active lease, attaches the immutable artifact, and
    # advances the order in one database transaction.
    completion = client.rpc("complete_preparation_task", {
        "p_task_id": task_id,
        "p_lease_token": lease_token,
        "p_artifact_object_path": artifact_path,
        "p_artifact_sha256": sha256_hash,
        "p_page_count": page_count,
        "p_byte_size": len(file_bytes),
        "p_renderer_name": "pypdf",
        "p_renderer_version": "6.13.2",
    }).execute()
    if not completion.data:
        return False

    return True
