from fastapi import APIRouter, HTTPException, Header, Body
from typing import Optional
import time

from app.device_auth import verify_device_credentials
from app.db import get_supabase_client, get_public_supabase_client
from app.storage import generate_signed_download_url
from app.agent_contract import (
    AgentHeartbeatRequest, AgentClaimRequest, AgentRenewRequest, 
    AgentAdvanceRequest, AgentOutcomeRequest
)

router = APIRouter(prefix="/api/v3/agent", tags=["Agent Operations"])

def get_authenticated_device(x_autoprint_device_id: Optional[str], x_autoprint_device_secret: Optional[str]) -> dict:
    """Verify device credentials from headers."""
    if not x_autoprint_device_id or not x_autoprint_device_secret:
        raise HTTPException(status_code=401, detail="Device authentication headers missing")

    device = verify_device_credentials(x_autoprint_device_id, x_autoprint_device_secret)
    if not device:
        raise HTTPException(status_code=401, detail="Device authentication failed or device revoked")
    return device

@router.post("/heartbeat")
async def agent_heartbeat(
    req: AgentHeartbeatRequest,
    x_autoprint_device_id: Optional[str] = Header(None),
    x_autoprint_device_secret: Optional[str] = Header(None)
):
    device = get_authenticated_device(x_autoprint_device_id, x_autoprint_device_secret)
    client = get_supabase_client()
    
    now_str = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())
    client.table("devices").update({
        "agent_version": req.agent_version,
        "last_seen_at": now_str
    }).eq("id", device["id"]).execute()

    get_public_supabase_client().table("shops").update({
        "last_seen_at": now_str
    }).eq("id", device["shop_id"]).execute()

    client.rpc("mark_expired_attempts_uncertain", {
        "p_device_id": device["id"],
    }).execute()

    return {"status": "heartbeat_ack", "device_id": device["id"]}

@router.post("/jobs/claim")
async def agent_claim_job(
    req: AgentClaimRequest,
    x_autoprint_device_id: Optional[str] = Header(None),
    x_autoprint_device_secret: Optional[str] = Header(None)
):
    device = get_authenticated_device(x_autoprint_device_id, x_autoprint_device_secret)
    client = get_supabase_client()

    res = client.rpc("claim_next_print_job", {
        "p_device_id": device["id"],
        "p_lease_seconds": req.lease_seconds or 300
    }).execute()

    if not res.data or len(res.data) == 0:
        return {"status": "no_job"}

    claim_data = res.data[0]
    
    # Generate signed download URL for artifact
    download_grant = generate_signed_download_url(claim_data["artifact_object_path"], expires_in_seconds=600)

    return {
        "status": "claimed",
        "job_id": claim_data["job_id"],
        "attempt_id": claim_data["attempt_id"],
        "fencing_token": claim_data["fencing_token"],
        "artifact_sha256": claim_data["artifact_sha256"],
        "options": claim_data["options_json"],
        "lease_expires_at": claim_data["lease_expires_at"],
        "artifact_download_url": download_grant.get("signed_url") if isinstance(download_grant, dict) else None
    }

@router.post("/attempts/{attempt_id}/renew")
async def agent_renew_lease(
    attempt_id: str,
    req: AgentRenewRequest,
    x_autoprint_device_id: Optional[str] = Header(None),
    x_autoprint_device_secret: Optional[str] = Header(None)
):
    device = get_authenticated_device(x_autoprint_device_id, x_autoprint_device_secret)
    client = get_supabase_client()

    res = client.rpc("renew_print_attempt_lease", {
        "p_job_id": req.job_id,
        "p_attempt_id": attempt_id,
        "p_fencing_token": req.fencing_token,
        "p_device_id": device["id"],
        "p_lease_seconds": req.lease_seconds or 300
    }).execute()

    if not res.data:
        raise HTTPException(status_code=409, detail="Lease renewal failed or fencing token stale")

    return {"status": "renewed", "attempt_id": attempt_id}

@router.post("/attempts/{attempt_id}/advance")
async def agent_advance_attempt(
    attempt_id: str,
    req: AgentAdvanceRequest,
    x_autoprint_device_id: Optional[str] = Header(None),
    x_autoprint_device_secret: Optional[str] = Header(None)
):
    device = get_authenticated_device(x_autoprint_device_id, x_autoprint_device_secret)
    client = get_supabase_client()

    res = client.rpc("advance_print_attempt", {
        "p_job_id": req.job_id,
        "p_attempt_id": attempt_id,
        "p_fencing_token": req.fencing_token,
        "p_device_id": device["id"],
        "p_expected_status": req.expected_status,
        "p_new_status": req.new_status,
        "p_evidence_json": req.evidence_json or {}
    }).execute()

    if not res.data:
        raise HTTPException(status_code=409, detail="Attempt advance failed or fencing token stale")

    return {"status": "advanced", "attempt_id": attempt_id, "new_status": req.new_status}

@router.post("/attempts/{attempt_id}/outcome")
async def agent_report_outcome(
    attempt_id: str,
    req: AgentOutcomeRequest,
    x_autoprint_device_id: Optional[str] = Header(None),
    x_autoprint_device_secret: Optional[str] = Header(None)
):
    device = get_authenticated_device(x_autoprint_device_id, x_autoprint_device_secret)
    client = get_supabase_client()

    res = client.rpc("report_print_outcome", {
        "p_job_id": req.job_id,
        "p_attempt_id": attempt_id,
        "p_fencing_token": req.fencing_token,
        "p_device_id": device["id"],
        "p_outcome_status": req.outcome_status,
        "p_completion_source": req.completion_source,
        "p_evidence_json": req.evidence_json or {}
    }).execute()

    if not res.data:
        raise HTTPException(status_code=409, detail="Outcome rejected or fencing token stale")

    # Migration 0019 installs a database trigger that synchronizes pickup
    # lifecycle changes in the same transaction as the authoritative job state.

    return {"status": "outcome_recorded", "job_id": req.job_id, "outcome_status": req.outcome_status}
