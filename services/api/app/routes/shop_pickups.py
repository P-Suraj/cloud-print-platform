from fastapi import APIRouter, HTTPException, Depends, Header, Request, Body, Query
from pydantic import BaseModel
from typing import Optional, List
import hashlib

from app.dependencies import get_current_session, require_role
from app.shop_authorization import get_session_shop_id
from app.db import get_supabase_client
from app.pickup_security import (
    normalize_pickup_code,
    hash_pickup_code,
    verify_code_hash_constant_time,
    verify_qr_bearer_token,
    compute_actor_bucket_hash,
)

router = APIRouter(prefix="/api/v3/shop", tags=["Shop Pickups"])


class CodeCollectRequest(BaseModel):
    code: str
    method: Optional[str] = "code"


class ManualCollectRequest(BaseModel):
    reason: str


class NoShowRequest(BaseModel):
    reason: str


class RestoreTrustRequest(BaseModel):
    reason: str


@router.get("/pickups")
async def list_shop_pickups(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    session: dict = Depends(get_current_session)
):
    """List pickups for the authenticated shop with optional status filter."""
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    query = client.table("pickups").select(
        "id, order_id, job_id, shop_id, status, ready_at, hold_until, hold_expired_at, collected_at, collection_method, no_show_at, no_show_reason, voided_at, created_at, updated_at"
    ).eq("shop_id", shop_id)

    if status:
        query = query.eq("status", status)

    query = query.order("created_at", desc=True).limit(limit)
    res = query.execute()

    return {
        "status": "success",
        "shop_id": shop_id,
        "pickups": res.data or []
    }


@router.get("/pickups/{pickup_id}")
async def get_shop_pickup_detail(
    pickup_id: str,
    session: dict = Depends(get_current_session)
):
    """Retrieve detail of a single pickup record. Never exposes code hash or document details."""
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    res = client.table("pickups").select(
        "id, order_id, job_id, shop_id, status, ready_at, hold_until, hold_expired_at, collected_at, collection_method, no_show_at, no_show_reason, voided_at, created_at, updated_at"
    ).eq("id", pickup_id).eq("shop_id", shop_id).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Pickup record not found")

    return {
        "status": "success",
        "pickup": res.data[0]
    }


@router.post("/pickups/{pickup_id}/collect")
async def collect_pickup_with_code(
    pickup_id: str,
    payload: CodeCollectRequest,
    request: Request,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """
    Redeem one-time pickup code or scanned QR token entered by shopkeeper.
    Enforces route-level CSRF check (via require_role/get_current_session),
    rate limiting, safe string normalization, and constant-time Python comparison.
    """
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]
    client_ip = request.client.host if request.client else "unknown"
    bucket_hash = compute_actor_bucket_hash(session.get("id", user_id), client_ip)

    client = get_supabase_client()

    # The database owns the rolling window. Do not fall back to process-local
    # memory: that would let an attacker bypass the limit by hitting another
    # API instance or after a restart.
    try:
        attempt = client.rpc("consume_pickup_attempt", {
            "p_pickup_id": pickup_id,
            "p_shop_id": shop_id,
            "p_actor_bucket_hash": bucket_hash,
        }).execute().data or {}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Pickup verification is temporarily unavailable. Please try again.") from exc
    if not attempt.get("allowed"):
        if attempt.get("reason") == "invalid_pickup":
            raise HTTPException(status_code=404, detail="Pickup record not found for this shop")
        raise HTTPException(status_code=429, detail="Too many pickup attempts. Please wait 15 minutes.")

    # 2. Check if scanned QR token or manual code
    raw_input = payload.code.strip()
    is_qr = payload.method == "qr" or raw_input.startswith("autoprint:pickup:v3:")

    pickup_res = client.table("pickups").select("id, order_id, shop_id, status, code_hash, code_key_version").eq("id", pickup_id).eq("shop_id", shop_id).execute()
    if not pickup_res.data:
        raise HTTPException(status_code=404, detail="Pickup record not found for this shop")

    pickup = pickup_res.data[0]
    if pickup["status"] == "collected":
        return {"status": "already_collected", "pickup_id": pickup_id, "message": "This order was already collected."}
    if pickup["status"] not in ("ready_for_pickup", "hold_expired"):
        raise HTTPException(status_code=400, detail=f"Order is not in collectible status ({pickup['status']})")

    code_to_verify = raw_input
    if is_qr:
        # Extract code from unforgeable QR bearer payload
        parts = raw_input.split(":")
        if len(parts) >= 5:
            code_to_verify = parts[4]
            # Verify QR bearer signature
            if not verify_qr_bearer_token(raw_input, pickup_id, pickup["order_id"], pickup.get("code_key_version", 1)):
                raise HTTPException(status_code=400, detail="Invalid or forged QR verification token")

    normalized_code = normalize_pickup_code(code_to_verify)
    if len(normalized_code) != 8:
        raise HTTPException(status_code=422, detail="Pickup code must be exactly 8 alphanumeric characters")

    # 3. Constant-time Python hash comparison
    expected_hash = pickup.get("code_hash")
    if not expected_hash or not verify_code_hash_constant_time(normalized_code, pickup_id, expected_hash):
        raise HTTPException(status_code=400, detail="Invalid pickup code")

    # 4. Atomic PostgreSQL state transition
    computed_hash = hash_pickup_code(normalized_code, pickup_id)
    res = client.rpc("redeem_pickup_code", {
        "p_pickup_id": pickup_id,
        "p_shop_id": shop_id,
        "p_code_hash": computed_hash,
        "p_user_id": user_id,
        "p_collection_method": "qr" if is_qr else "code"
    }).execute()

    data = res.data or {}
    result = data.get("result")

    if result == "collected":
        return {"status": "collected", "pickup_id": pickup_id}
    elif result == "already_collected":
        return {"status": "already_collected", "pickup_id": pickup_id, "message": "This order was already collected."}
    else:
        raise HTTPException(status_code=400, detail="Invalid pickup code or order not eligible for pickup.")


@router.post("/pickups/{pickup_id}/manual-collect")
async def manual_collect_pickup(
    pickup_id: str,
    payload: ManualCollectRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """
    Manual override for collection requiring explicit reason and idempotency.
    CSRF is verified at route boundary by require_role / get_current_session.
    """
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]
    reason = payload.reason.strip()

    if len(reason) < 10 or len(reason) > 500:
        raise HTTPException(status_code=422, detail="A reason of 10–500 characters is required for manual collection override.")

    if not idempotency_key or len(idempotency_key) > 200:
        raise HTTPException(status_code=400, detail="Idempotency-Key is required for manual collection")

    idem_key = idempotency_key
    key_hash = hashlib.sha256(idem_key.encode("utf-8")).hexdigest()
    req_hash = hashlib.sha256(f"{pickup_id}:{reason}:{user_id}".encode("utf-8")).hexdigest()

    client = get_supabase_client()
    try:
        res = client.rpc("manual_collect_pickup", {
            "p_pickup_id": pickup_id,
            "p_shop_id": shop_id,
            "p_user_id": user_id,
            "p_reason": reason,
            "p_idempotency_key_hash": key_hash,
            "p_request_hash": req_hash
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Manual collection failed: {str(exc)}") from exc

    return res.data or {"status": "collected", "pickup_id": pickup_id}


@router.post("/pickups/{pickup_id}/no-show")
async def record_pickup_no_show(
    pickup_id: str,
    payload: NoShowRequest,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """
    Record customer no-show after hold period has expired.
    CSRF is verified at route boundary by require_role / get_current_session.
    """
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]
    reason = payload.reason.strip()

    if len(reason) < 10 or len(reason) > 500:
        raise HTTPException(status_code=422, detail="A reason of 10–500 characters is required to record a no-show.")

    client = get_supabase_client()
    try:
        res = client.rpc("mark_pickup_no_show", {
            "p_pickup_id": pickup_id,
            "p_shop_id": shop_id,
            "p_user_id": user_id,
            "p_reason": reason
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Cannot record no-show: {str(exc)}") from exc

    return res.data or {"status": "no_show", "pickup_id": pickup_id}


@router.post("/trust/{customer_id}/restore")
async def restore_customer_trust_endpoint(
    customer_id: str,
    payload: RestoreTrustRequest,
    session: dict = Depends(require_role(["owner"]))
):
    """
    Owner-only endpoint to restore a customer's trust status with an audited reason.
    CSRF is verified at route boundary.
    """
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]
    reason = payload.reason.strip()

    if len(reason) < 10:
        raise HTTPException(status_code=422, detail="Restoration reason of at least 10 characters is required.")

    client = get_supabase_client()
    try:
        res = client.rpc("restore_customer_trust", {
            "p_shop_id": shop_id,
            "p_user_id": user_id,
            "p_customer_id": customer_id,
            "p_reason": reason
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Could not restore trust: {str(exc)}") from exc

    return {"status": "trust_restored", "customer_id": customer_id}
