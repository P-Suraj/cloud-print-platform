from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_supabase_client
from app.dependencies import get_current_session, require_role
from app.shop_authorization import get_session_shop_id


router = APIRouter(prefix="/api/v3/shop/remote-policy", tags=["Remote Order Policy"])


class RemotePolicyUpdate(BaseModel):
    remote_orders_enabled: bool
    remote_orders_paused: bool = False
    unpaid_policy: Literal["print_on_arrival"] = "print_on_arrival"


def _default_policy(shop_id: str) -> dict:
    return {
        "shop_id": shop_id,
        "remote_orders_enabled": False,
        "remote_orders_paused": False,
        "unpaid_policy": "print_on_arrival",
        "version": 1,
    }


@router.get("")
async def get_remote_policy(session: dict = Depends(get_current_session)):
    shop_id = get_session_shop_id(session)
    result = get_supabase_client().table("shop_remote_policies").select("*").eq(
        "shop_id", shop_id
    ).limit(1).execute()
    return {"status": "success", "policy": result.data[0] if result.data else _default_policy(shop_id)}


@router.put("")
async def update_remote_policy(
    payload: RemotePolicyUpdate,
    session: dict = Depends(require_role(["owner", "staff"])),
):
    shop_id = get_session_shop_id(session)
    result = get_supabase_client().rpc("set_shop_remote_policy", {
        "p_shop_id": shop_id,
        "p_user_id": session["user_id"],
        "p_enabled": payload.remote_orders_enabled,
        "p_paused": payload.remote_orders_paused,
        "p_unpaid_policy": payload.unpaid_policy,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=409, detail="Remote-order policy was not updated")
    return {"status": "updated", "policy": result.data}
