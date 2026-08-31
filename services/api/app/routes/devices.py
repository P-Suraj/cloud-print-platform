from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
import time
from typing import Optional

from app.dependencies import get_current_session, require_role
from app.device_auth import generate_enrollment_code, generate_device_secret, hash_secret, verify_device_credentials
from app.db import get_supabase_client

router = APIRouter(prefix="/api/v3", tags=["Devices"])


class EnrollDeviceRequest(BaseModel):
    enrollment_code: str
    display_name: str
    expected_shop_id: Optional[str] = None


class EnrollDeviceResponse(BaseModel):
    device_id: str
    device_secret: str
    shop_id: str


def _now_utc_str() -> str:
    return time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())


@router.post("/shops/{shop_id}/device-enrollment-codes")
async def create_enrollment_code(
    shop_id: str,
    session: dict = Depends(require_role(["owner", "founder_admin"]))
):
    # P1 fix: verify the requested shop_id matches the session's shop
    if session["shop_id"] != shop_id:
        raise HTTPException(
            status_code=403,
            detail="Cannot create enrollment codes for a shop you do not belong to"
        )

    raw_code, code_h = generate_enrollment_code()
    expires_at = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime(time.time() + 900))  # 15 min

    client = get_supabase_client()
    data = {
        "shop_id": shop_id,
        "created_by_user_id": session["user_id"],
        "code_hash": code_h,
        "expires_at": expires_at,
    }
    client.table("device_enrollment_codes").insert(data).execute()

    return {
        "status": "created",
        "enrollment_code": raw_code,
        "expires_at": expires_at,
    }


@router.post("/devices/enroll", response_model=EnrollDeviceResponse)
async def enroll_device(req: EnrollDeviceRequest):
    code_h = hash_secret(req.enrollment_code.strip().upper())
    client = get_supabase_client()

    raw_secret, secret_h = generate_device_secret()
    result = client.rpc("consume_device_enrollment", {
        "p_code_hash": code_h,
        "p_display_name": req.display_name.strip(),
        "p_credential_hash": secret_h,
        "p_expected_shop_id": req.expected_shop_id,
    }).execute()
    if not result.data:
        raise HTTPException(
            status_code=400,
            detail="Invalid, expired, or already consumed enrollment code",
        )
    device_row = result.data[0]

    return EnrollDeviceResponse(
        device_id=device_row["device_id"],
        device_secret=raw_secret,
        shop_id=device_row["shop_id"],
    )


@router.post("/devices/{device_id}/revoke")
async def revoke_device(
    device_id: str,
    session: dict = Depends(require_role(["owner", "founder_admin"]))
):
    client = get_supabase_client()

    # P1 fix: verify the device belongs to the session's shop before revoking
    dev_res = client.table("devices").select("shop_id").eq("id", device_id).execute()
    if not dev_res.data:
        raise HTTPException(status_code=404, detail="Device not found")

    device_shop_id = dev_res.data[0]["shop_id"]
    if device_shop_id != session["shop_id"]:
        raise HTTPException(
            status_code=403,
            detail="Cannot revoke a device belonging to a different shop"
        )

    client.table("devices").update({
        "status": "revoked",
        "revoked_at": _now_utc_str(),
    }).eq("id", device_id).execute()

    return {"status": "revoked", "device_id": device_id}
