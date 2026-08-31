from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
import json

from app.dependencies import get_current_session, require_role
from app.shop_authorization import get_session_shop_id
from app.db import get_supabase_client

router = APIRouter(prefix="/api/v3/shop", tags=["Shop Pickup Policy"])


class PickupPolicyUpdateRequest(BaseModel):
    pickup_workflow_enabled: bool = False
    hold_period_minutes: int = Field(default=4320, ge=720, le=20160)
    reminder_offsets_minutes: List[int] = []
    no_show_disables_unpaid_preprint: bool = True


@router.get("/pickup-policy")
async def get_shop_pickup_policy(session: dict = Depends(get_current_session)):
    """Fetch current pickup policy for the shop."""
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    res = client.table("shop_pickup_policies").select("*").eq("shop_id", shop_id).execute()

    if not res.data:
        # Return default policy state if not yet configured in DB
        return {
            "status": "success",
            "policy": {
                "shop_id": shop_id,
                "pickup_workflow_enabled": False,
                "hold_period_minutes": 4320,
                "reminder_offsets_minutes": [],
                "no_show_disables_unpaid_preprint": True,
                "policy_version": 0
            }
        }

    return {
        "status": "success",
        "policy": res.data[0]
    }


@router.put("/pickup-policy")
async def update_shop_pickup_policy(
    payload: PickupPolicyUpdateRequest,
    session: dict = Depends(require_role(["owner"]))
):
    """Owner-only endpoint to configure shop pickup policy."""
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]
    client = get_supabase_client()

    try:
        res = client.rpc("set_pickup_policy", {
            "p_shop_id": shop_id,
            "p_user_id": user_id,
            "p_enabled": payload.pickup_workflow_enabled,
            "p_hold_period_minutes": payload.hold_period_minutes,
            "p_reminder_offsets_minutes": json.dumps(payload.reminder_offsets_minutes),
            "p_no_show_disables_unpaid_preprint": payload.no_show_disables_unpaid_preprint
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Failed to update pickup policy: {str(exc)}") from exc

    return {
        "status": "updated",
        "policy": res.data
    }
