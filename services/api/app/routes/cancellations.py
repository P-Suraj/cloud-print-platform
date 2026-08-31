import hashlib
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from app.capabilities import hash_capability_token
from app.customer_auth import optional_customer_session
from app.db import get_supabase_client


router = APIRouter(prefix="/api/v3/orders", tags=["Customer Cancellation"])


@router.post("/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    request: Request,
    x_autoprint_capability: Optional[str] = Header(None),
    idempotency_key: Optional[str] = Header(None),
):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")
    if not idempotency_key or len(idempotency_key) > 200:
        raise HTTPException(status_code=400, detail="Idempotency-Key is required")

    # The unguessable order capability and mandatory custom idempotency header
    # are the cancellation authorization. A customer cookie, when present,
    # additionally binds remote orders to their verified customer.
    customer_session = optional_customer_session(request)
    customer_id = customer_session.get("customer_id") if customer_session else None
    key_hash = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()
    request_hash = hashlib.sha256(f"cancel:{order_id}".encode("utf-8")).hexdigest()

    result = get_supabase_client().rpc("cancel_print_job_if_unclaimed", {
        "p_order_id": order_id,
        "p_capability_hash": hash_capability_token(x_autoprint_capability),
        "p_customer_id": customer_id,
        "p_idempotency_key_hash": key_hash,
        "p_request_hash": request_hash,
    }).execute()
    payload = result.data or {"result": "not_found"}
    if payload.get("result") == "not_found":
        raise HTTPException(status_code=404, detail="Order not found")
    if payload.get("result") in {"execution_started", "not_cancellable"}:
        raise HTTPException(
            status_code=409,
            detail="Printing has already started; cancellation is no longer available.",
        )
    return payload
