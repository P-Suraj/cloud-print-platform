from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel
import time
from typing import Literal, Optional

from app.capabilities import generate_capability_token, hash_capability_token
from app.db import get_supabase_client, get_public_supabase_client
from app.customer_auth import require_customer_session

router = APIRouter(prefix="/api/v3", tags=["Orders"])

class CreateOrderResponse(BaseModel):
    order_id: str
    capability_token: str
    expires_at: str


class CreateOrderRequest(BaseModel):
    submission_channel: Literal["qr", "shop_code", "saved_shop"] = "qr"
    fulfillment_mode: Literal["counter", "remote"] = "counter"
    customer_job_name: Optional[str] = None

@router.post("/shops/{shop_code}/orders", response_model=CreateOrderResponse)
async def create_customer_order(shop_code: str, http_request: Request, request: Optional[CreateOrderRequest] = None):
    client = get_supabase_client()
    payload = request or CreateOrderRequest()
    customer_job_name = (payload.customer_job_name or "").strip()
    if len(customer_job_name) > 80:
        raise HTTPException(status_code=422, detail="Job name must be 80 characters or fewer")
    normalized_code = shop_code.strip().upper()
    if normalized_code == "DEMO001":
        raise HTTPException(status_code=409, detail="Demo shop does not accept real orders")
    
    # Resolve shop_code
    shop_res = get_public_supabase_client().table("shops").select("id, is_active, migration_mode").eq("shop_code", normalized_code).execute()
    if not shop_res.data:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    shop = shop_res.data[0]
    if not shop.get("is_active"):
        raise HTTPException(status_code=400, detail="Shop is currently inactive")
    if shop.get("migration_mode") not in ("v3_canary", "v3_active"):
        raise HTTPException(status_code=404, detail="Shop not found")

    customer_id = None
    if payload.fulfillment_mode == "remote":
        if payload.submission_channel == "qr":
            raise HTTPException(status_code=422, detail="Counter QR orders cannot be marked remote")
        customer_session = require_customer_session(http_request, require_csrf=True)
        customer_id = customer_session["customer_id"]
        policy_res = client.table("shop_remote_policies").select("*").eq(
            "shop_id", shop["id"]
        ).limit(1).execute()
        if not policy_res.data:
            raise HTTPException(status_code=409, detail="This shop has not enabled remote orders")
        policy = policy_res.data[0]
        if not policy.get("remote_orders_enabled") or policy.get("remote_orders_paused"):
            raise HTTPException(status_code=409, detail="This shop has paused remote orders")
    elif payload.submission_channel != "qr":
        raise HTTPException(status_code=422, detail="Shop-code and saved-shop orders must use remote fulfillment")

    raw_capability, capability_h = generate_capability_token()
    expires_at = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime(time.time() + 3600)) # 1h

    res = client.rpc("create_customer_order_v3", {
        "p_shop_id": shop["id"],
        "p_capability_hash": capability_h,
        "p_permissions": {"read": True, "upload": True, "cancel": True},
        "p_expires_at": expires_at,
        "p_submission_channel": payload.submission_channel,
        "p_fulfillment_mode": payload.fulfillment_mode,
        "p_customer_id": customer_id,
    }).execute()
    order_row = res.data[0] if isinstance(res.data, list) else res.data
    if not order_row:
        raise HTTPException(status_code=409, detail="Order could not be created")
    if customer_job_name:
        updated = client.table("orders").update({"customer_job_name": customer_job_name}).eq(
            "id", order_row["id"]
        ).execute()
        if updated.data:
            order_row = updated.data[0]

    return CreateOrderResponse(
        order_id=order_row["id"],
        capability_token=raw_capability,
        expires_at=expires_at
    )

@router.get("/orders/{order_id}")
async def get_order_status(order_id: str, x_autoprint_capability: Optional[str] = Header(None)):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")

    cap_h = hash_capability_token(x_autoprint_capability)
    client = get_supabase_client()

    now_str = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())
    res = client.table("orders").select("*, source_documents(*), print_jobs(*)").eq("id", order_id).eq("capability_hash", cap_h).gt("expires_at", now_str).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    return {"status": "success", "order": res.data[0]}
