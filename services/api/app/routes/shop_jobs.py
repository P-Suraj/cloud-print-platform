from fastapi import APIRouter, HTTPException, Depends, Header, Body
from pydantic import BaseModel
import hashlib
import json
from typing import Optional

from app.dependencies import get_current_session, require_role
from app.shop_authorization import get_session_shop_id
from app.db import get_supabase_client
from app.storage import generate_signed_download_url

router = APIRouter(prefix="/api/v3/shop/jobs", tags=["Shop Jobs"])

class ResolveJobRequest(BaseModel):
    outcome_status: str # 'completed' or 'failed'
    reason: str


class RiskAcceptanceRequest(BaseModel):
    reason: str


class EditPrintOptionsRequest(BaseModel):
    copies: int
    color_mode: str
    duplex: bool
    page_range: Optional[str] = None
    orientation: str = "auto"
    fit_mode: str = "fit"
    paper_size: str = "A4"

@router.get("")
async def list_shop_jobs(session: dict = Depends(get_current_session)):
    shop_id = get_session_shop_id(session)
    jobs = []
    try:
        client = get_supabase_client()
        res = client.table("print_jobs").select("*, print_artifacts(*, source_documents(original_file_name)), price_quotes(options_json,breakdown_json,total_amount), price_quote_items(options_json,breakdown_json,total_amount), orders(fulfillment_mode,payment_mode,submission_channel,customer_id,customer_checked_in_at,customer_job_name)").eq("shop_id", shop_id).order("created_at", desc=True).execute()
        jobs = res.data or []
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Shop queue is temporarily unavailable") from exc

    return {"status": "success", "shop_id": shop_id, "jobs": jobs}


@router.put("/{job_id}/print-options")
async def edit_print_options(
    job_id: str,
    payload: EditPrintOptionsRequest,
    session: dict = Depends(require_role(["owner", "staff"])),
):
    if not 1 <= payload.copies <= 100:
        raise HTTPException(status_code=422, detail="copies must be between 1 and 100")
    if payload.color_mode not in {"bw", "color"}:
        raise HTTPException(status_code=422, detail="color_mode must be 'bw' or 'color'")
    options = payload.model_dump()
    options["page_range"] = (options.get("page_range") or "").strip() or None
    options_hash = hashlib.sha256(json.dumps(options, sort_keys=True).encode("utf-8")).hexdigest()
    result = get_supabase_client().rpc("set_shop_print_options", {
        "p_job_id": job_id, "p_user_id": session["user_id"],
        "p_options": options, "p_options_hash": options_hash,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=409, detail="Only an unapproved waiting job can be edited")
    return {"status": "updated", "job_id": job_id, "options": options}

@router.get("/{job_id}")
async def get_shop_job_detail(job_id: str, session: dict = Depends(get_current_session)):
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    res = client.table("print_jobs").select("*, print_artifacts(*), price_quotes(*), price_quote_items(*)").eq("id", job_id).eq("shop_id", shop_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found")

    job = res.data[0]
    artifact = job.get("print_artifacts", {})

    preview_grant = None
    if artifact and artifact.get("object_path"):
        preview_grant = generate_signed_download_url(artifact["object_path"], expires_in_seconds=900)

    return {
        "status": "success",
        "job": job,
        "preview_url": preview_grant.get("signed_url") if isinstance(preview_grant, dict) else None
    }

@router.post("/{job_id}/approve")
async def approve_job(job_id: str, session: dict = Depends(require_role(["owner", "staff"]))):
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    res = client.rpc("approve_print_job", {
        "p_job_id": job_id,
        "p_user_id": session["user_id"],
    }).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found or cannot be approved")
    return {"status": "approved", "job_id": job_id}

@router.post("/{job_id}/reject")
async def reject_job(job_id: str, reason: Optional[str] = Body(None, embed=True), session: dict = Depends(require_role(["owner", "staff"]))):
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    res = client.rpc("reject_print_job", {
        "p_job_id": job_id,
        "p_user_id": session["user_id"],
        "p_reason": (reason or "Rejected by shopkeeper").strip()[:500],
    }).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found or cannot be rejected")

    return {"status": "rejected", "job_id": job_id}


@router.post("/{job_id}/accept-unpaid-risk")
async def accept_unpaid_risk(
    job_id: str,
    payload: RiskAcceptanceRequest,
    session: dict = Depends(require_role(["owner", "staff"])),
):
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required for unpaid preprint risk")
    result = get_supabase_client().rpc("accept_unpaid_preprint_risk", {
        "p_job_id": job_id,
        "p_user_id": session["user_id"],
        "p_reason": reason[:500],
    }).execute()
    if not result.data:
        raise HTTPException(status_code=409, detail="This job is not eligible for a risk override")
    return {"status": "risk_accepted", "job_id": job_id}

@router.post("/{job_id}/resolve")
async def resolve_job(job_id: str, req: ResolveJobRequest, session: dict = Depends(require_role(["owner", "staff"]))):
    if req.outcome_status not in ["completed", "failed"]:
        raise HTTPException(status_code=400, detail="Outcome status must be completed or failed")

    if not req.reason.strip():
        raise HTTPException(status_code=400, detail="Resolution reason is required")

    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    res = client.rpc("resolve_uncertain_print_attempt", {
        "p_job_id": job_id,
        "p_user_id": session["user_id"],
        "p_outcome_status": req.outcome_status,
        "p_reason": req.reason
    }).execute()

    return {"status": "resolved", "job_id": job_id, "outcome_status": req.outcome_status}
