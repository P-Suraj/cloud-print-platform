from fastapi import APIRouter, HTTPException, Header, Request
from typing import Optional
import time

from app.capabilities import hash_capability_token
from app.customer_auth import require_customer_session
from app.db import get_supabase_client, get_public_supabase_client
from app.pickup_security import (
    derive_pickup_code,
    hash_pickup_code,
    generate_qr_bearer_token,
    normalize_pickup_code
)

router = APIRouter(prefix="/api/v3/orders", tags=["Customer Pickups"])


def _validate_order_access(order_id: str, capability_token: Optional[str]) -> dict:
    """Validate capability token and return order."""
    if not capability_token:
        raise HTTPException(status_code=404, detail="Order not found")

    cap_h = hash_capability_token(capability_token)
    client = get_supabase_client()
    now_str = time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime())

    res = client.table("orders").select(
        "id, shop_id, customer_id, fulfillment_mode, status, expires_at"
    ).eq("id", order_id).eq("capability_hash", cap_h).gt("expires_at", now_str).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    return res.data[0]


@router.get("/{order_id}/pickup")
async def get_order_pickup_status(
    order_id: str,
    request: Request,
    x_autoprint_capability: Optional[str] = Header(None)
):
    """
    Customer pickup status endpoint.
    Requires valid capability token AND verified matching customer session for remote orders.
    Returns status and ready times, but NEVER returns plaintext code.
    """
    order = _validate_order_access(order_id, x_autoprint_capability)

    # Remote orders require verified customer session matching order's customer_id
    if order.get("fulfillment_mode") == "remote" and order.get("customer_id"):
        session = require_customer_session(request)
        if session["customer_id"] != order["customer_id"]:
            raise HTTPException(status_code=403, detail="Customer session does not match order")

    client = get_supabase_client()
    pickup_res = client.table("pickups").select(
        "id, order_id, job_id, shop_id, status, ready_at, hold_until, hold_expired_at, collected_at, no_show_at, voided_at"
    ).eq("order_id", order_id).execute()

    if not pickup_res.data:
        return {
            "pickup_id": None,
            "order_id": order_id,
            "status": "not_applicable" if order["fulfillment_mode"] != "remote" else "awaiting_readiness",
            "code_available": False,
            "customer_wording": "Preparing pickup information..."
        }

    pickup = pickup_res.data[0]
    shop_res = get_public_supabase_client().table("shops").select("id, name, code").eq("id", order["shop_id"]).execute()
    shop = shop_res.data[0] if shop_res.data else {"name": "Print Shop", "code": ""}

    wording_map = {
        "awaiting_print": "Printing in progress",
        "ready_for_pickup": "Printed and ready for collection",
        "collected": "Order collected",
        "hold_expired": "Hold period expired. Please contact counter staff.",
        "no_show": "Order marked as uncollected",
        "voided": "Order voided"
    }

    status = pickup["status"]
    is_active = status in ("ready_for_pickup", "hold_expired")

    return {
        "pickup_id": pickup["id"],
        "order_id": order_id,
        "status": status,
        "ready_at": pickup["ready_at"],
        "hold_until": pickup["hold_until"],
        "hold_expired_at": pickup["hold_expired_at"],
        "collected_at": pickup["collected_at"],
        "shop": {
            "name": shop.get("name"),
            "code": shop.get("code")
        },
        "code_available": is_active,
        "customer_wording": wording_map.get(status, status)
    }


@router.get("/{order_id}/pickup-code")
async def get_order_pickup_code(
    order_id: str,
    request: Request,
    x_autoprint_capability: Optional[str] = Header(None)
):
    """
    Capability + customer session protected pickup code derivation.
    Plaintext code is derived server-side on request and never persisted in database.
    """
    order = _validate_order_access(order_id, x_autoprint_capability)

    # Remote orders require customer session validation matching the order
    if order.get("fulfillment_mode") == "remote" and order.get("customer_id"):
        session = require_customer_session(request)
        if session["customer_id"] != order["customer_id"]:
            raise HTTPException(status_code=403, detail="Customer session does not match order")

    client = get_supabase_client()
    pickup_res = client.table("pickups").select(
        "id, order_id, shop_id, status, ready_at, hold_until, code_key_version, code_hash"
    ).eq("order_id", order_id).execute()

    if not pickup_res.data:
        raise HTTPException(status_code=404, detail="Pickup record not found for this order")

    pickup = pickup_res.data[0]
    status = pickup["status"]

    if status not in ("ready_for_pickup", "hold_expired"):
        return {
            "pickup_id": pickup["id"],
            "order_id": order_id,
            "pickup_code": None,
            "qr_payload": None,
            "status": status,
            "message": f"Pickup code is no longer active (status: {status})"
        }

    key_version = pickup.get("code_key_version") or 1
    code = derive_pickup_code(pickup["id"], order_id, key_version)
    computed_hash = hash_pickup_code(code, pickup["id"])

    # Ensure code_hash is set on the pickup row so shop can verify it
    if not pickup.get("code_hash") or pickup["code_hash"] != computed_hash:
        client.table("pickups").update({
            "code_hash": computed_hash,
            "code_key_version": key_version
        }).eq("id", pickup["id"]).execute()

    # Unforgeable cryptographic QR bearer payload
    qr_payload = generate_qr_bearer_token(pickup["id"], order_id, key_version)

    return {
        "pickup_id": pickup["id"],
        "order_id": order_id,
        "pickup_code": code,
        "qr_payload": qr_payload,
        "status": status,
        "ready_at": pickup["ready_at"],
        "hold_until": pickup["hold_until"]
    }
