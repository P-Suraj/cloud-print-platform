from fastapi import APIRouter, Request

from app.customer_auth import require_customer_session
from app.db import get_supabase_client


router = APIRouter(prefix="/api/v3/customer/orders", tags=["Customer Orders"])


@router.get("")
async def list_customer_orders(request: Request):
    session = require_customer_session(request)
    result = get_supabase_client().table("orders").select(
        "id,shop_id,status,fulfillment_mode,payment_mode,submission_channel,created_at,print_jobs(id,status,print_eligibility,approved_at,current_attempt_id)"
    ).eq("customer_id", session["customer_id"]).order("created_at", desc=True).limit(50).execute()
    return {"status": "success", "orders": result.data or []}
