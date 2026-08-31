from fastapi import APIRouter, HTTPException, Header, Body
from pydantic import BaseModel
from postgrest.exceptions import APIError
import logging
import secrets
import hashlib
import time
from typing import Optional

from app.capabilities import hash_capability_token
from app.db import get_supabase_client
from app.storage import generate_signed_upload_url, generate_signed_download_url
from app.pdf_validation import validate_pdf_bytes
from app.settings import settings

router = APIRouter(prefix="/api/v3/orders", tags=["Uploads"])
logger = logging.getLogger("autoprint.uploads")


class UploadIntentRequest(BaseModel):
    original_file_name: str
    declared_media_type: str
    byte_size: int


class UploadIntentResponse(BaseModel):
    source_document_id: str
    object_path: str
    signed_upload_url: str


@router.post("/{order_id}/upload-intent", response_model=UploadIntentResponse)
async def create_upload_intent(
    order_id: str,
    req: UploadIntentRequest,
    x_autoprint_capability: Optional[str] = Header(None)
):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")

    if req.declared_media_type.lower() != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only application/pdf media type is allowed in M1"
        )

    if req.byte_size <= 0 or req.byte_size > 26214400:  # 25 MB
        raise HTTPException(
            status_code=400,
            detail="File size exceeds maximum 25 MB limit"
        )

    cap_h = hash_capability_token(x_autoprint_capability)
    client = get_supabase_client()

    order_res = client.table("orders").select("*").eq(
        "id", order_id
    ).eq("capability_hash", cap_h).gt(
        "expires_at", time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())
    ).execute()
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    order = order_res.data[0]

    # Generate a unique, per-upload object path scoped to the shop and order
    object_path = f"v3/{order['shop_id']}/{order_id}/{secrets.token_hex(16)}.pdf"
    signed_grant = generate_signed_upload_url(object_path)

    doc_data = {
        "order_id": order_id,
        "object_path": object_path,
        "original_file_name": req.original_file_name,
        "declared_media_type": req.declared_media_type,
        "declared_byte_size": req.byte_size,
        "retention_until": time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime(time.time() + 3600)),
        "cleanup_status": "pending",
    }
    doc_res = client.table("source_documents").insert(doc_data).execute()
    doc_row = doc_res.data[0]

    signed_url = signed_grant.get("signed_url") if isinstance(signed_grant, dict) else None
    if not signed_url:
        raise HTTPException(status_code=503, detail="Storage upload grant could not be created")

    return UploadIntentResponse(
        source_document_id=doc_row["id"],
        object_path=object_path,
        signed_upload_url=signed_url,
    )


@router.post("/{order_id}/finalize-upload")
async def finalize_upload(
    order_id: str,
    payload: dict = Body(...),
    x_autoprint_capability: Optional[str] = Header(None),
    idempotency_key: Optional[str] = Header(None),
):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")

    cap_h = hash_capability_token(x_autoprint_capability)
    client = get_supabase_client()

    order_res = client.table("orders").select("*").eq(
        "id", order_id
    ).eq("capability_hash", cap_h).gt(
        "expires_at", time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())
    ).execute()
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    source_document_id = payload.get("source_document_id")
    if not source_document_id:
        raise HTTPException(status_code=400, detail="source_document_id is required")

    # Fetch the source document so we know the object path
    doc_res = client.table("source_documents").select("*").eq(
        "id", source_document_id
    ).eq("order_id", order_id).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Source document not found for this order")

    doc_row = doc_res.data[0]

    # An already-finalized document is returned idempotently.
    if doc_row.get("finalized_at"):
        return {
            "status": "finalized",
            "order_id": order_id,
            "source_document_id": source_document_id,
            "sha256": doc_row.get("sha256"),
            "idempotent": True,
        }

    object_path = doc_row["object_path"]

    # --- Step 1: Download the uploaded bytes from Storage (exactly once) ---
    # Using the authenticated Storage client avoids the signed-URL round-trip
    # which can hang in a serverless runtime after a browser upload.
    try:
        raw_bytes = client.storage.from_(settings.storage_bucket).download(object_path)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Upload not found in storage — upload the file before finalizing"
        ) from exc

    if len(raw_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Signed object uploads have no transport envelope in the stored bytes.
    declared_size = doc_row.get("declared_byte_size", 0)
    if len(raw_bytes) != declared_size:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Uploaded file size ({len(raw_bytes)} bytes) does not match "
                f"declared size ({declared_size} bytes)"
            )
        )

    # --- Step 2: Validate PDF in-process (no subprocess — serverless-safe) ---
    # validate_pdf_bytes_bounded() uses multiprocessing.get_context("spawn")
    # which does not work in Vercel serverless. validate_pdf_bytes() is safe for
    # the bounded pilot upload path (25 MB cap, PDF magic header pre-checked).
    is_valid, page_count, err_msg = validate_pdf_bytes(raw_bytes)
    if not is_valid:
        raise HTTPException(status_code=400, detail=err_msg)

    sha256_hash = hashlib.sha256(raw_bytes).hexdigest()
    options_hash = hashlib.sha256(b"default-m1-options").hexdigest()

    # --- Step 3: Persist finalization and create the preparation task ---
    finalized = client.rpc("finalize_source_document", {
        "p_order_id": order_id,
        "p_source_document_id": source_document_id,
        "p_sha256": sha256_hash,
        "p_verified_byte_size": len(raw_bytes),
        "p_page_count": page_count,
        "p_options_hash": options_hash,
    }).execute()
    if not finalized.data:
        raise HTTPException(status_code=409, detail="Upload finalization conflict")

    # --- Step 4: Inline preparation — claim task, upload artifact, complete ---
    #
    # Vercel has no always-on worker process. Running preparation inline lets
    # the order reach ready_for_approval in a single customer-facing request.
    #
    # KEY OPTIMISATION: We reuse raw_bytes already in memory for the artifact
    # upload. The old approach called process_single_preparation_task() which
    # re-downloaded the same bytes from Storage, doubling I/O and reliably
    # exceeding Vercel's 60-second function timeout for any non-trivial PDF.
    try:
        task_res = client.rpc("claim_preparation_task_for_document", {
            "p_source_document_id": source_document_id,
            "p_worker_id": "api-inline",
            "p_lease_seconds": 90,
        }).execute()
    except APIError as exc:
        # Keep the operational error observable without logging customer data,
        # capabilities, URLs, or document identifiers.
        logger.error(
            "preparation_claim_rpc_failed rpc=%s postgrest_code=%r message=%r details=%r hint=%r",
            "claim_preparation_task_for_document",
            exc.code,
            exc.message,
            exc.details,
            exc.hint,
        )
        raise HTTPException(
            status_code=503,
            detail="Your PDF could not be prepared. Please try again.",
        ) from exc

    if not task_res.data:
        # finalize_source_document should have created the task; not finding it
        # here is unexpected. Surface a retryable error rather than silently
        # leaving the order in the 'preparing' state forever.
        raise HTTPException(
            status_code=503,
            detail="Your PDF could not be prepared. Please try again."
        )

    task = task_res.data[0]
    task_id = task["task_id"]
    lease_token = task["lease_token"]

    # Upload the immutable artifact using bytes already in memory — no second download.
    artifact_path = f"artifacts/{source_document_id}/{sha256_hash}.pdf"
    try:
        client.storage.from_(settings.storage_bucket).upload(
            artifact_path,
            raw_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
    except Exception as exc:
        # Release the lease so a real worker can retry if one is ever deployed.
        client.rpc("fail_preparation_task", {
            "p_task_id": task_id,
            "p_lease_token": lease_token,
            "p_error": f"Artifact upload failed: {exc}",
        }).execute()
        raise HTTPException(
            status_code=503,
            detail="Your PDF could not be prepared. Please try again."
        ) from exc

    # Atomically: insert print_artifacts row + advance order to ready_for_approval.
    completion = client.rpc("complete_preparation_task", {
        "p_task_id": task_id,
        "p_lease_token": lease_token,
        "p_artifact_object_path": artifact_path,
        "p_artifact_sha256": sha256_hash,
        "p_page_count": page_count,
        "p_byte_size": len(raw_bytes),
        "p_renderer_name": "pypdf",
        "p_renderer_version": "6.13.2",
    }).execute()

    if not completion.data:
        raise HTTPException(
            status_code=503,
            detail="Your PDF could not be prepared. Please try again."
        )

    return {
        "status": "finalized",
        "order_id": order_id,
        "source_document_id": source_document_id,
        "page_count": page_count,
        "sha256": sha256_hash,
    }
