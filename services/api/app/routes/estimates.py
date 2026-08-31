from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from pydantic import BaseModel, Field
from datetime import timedelta, datetime, timezone

from app.db import get_supabase_client
from app.dependencies import require_role
from app.shop_authorization import get_session_shop_id
from app.queue_estimates import QueueEstimateResult, format_queue_estimate
from app.settings import settings
from app.pricing import _selected_page_count

router = APIRouter(tags=["Estimates"])


def _require_queue_estimates_enabled() -> None:
    if not settings.queue_estimates_enabled:
        # Do not reveal dark-launched operational data through a public route.
        raise HTTPException(status_code=404, detail="Queue estimates are not available for this shop")

@router.get("/api/v3/shops/{shop_code}/estimate", response_model=QueueEstimateResult)
def get_shop_estimate(
    shop_code: str,
    pages: int = Query(0, ge=0),
    copies: int = Query(1, ge=1),
    colour: bool = Query(False),
    duplex: bool = Query(False),
    page_range: Optional[str] = Query(None, max_length=500),
):
    """
    Get workload-based estimate for a specific shop and job configuration.
    """
    _require_queue_estimates_enabled()
    sb = get_supabase_client()
    
    # Resolve shop_code to shop_id
    res = sb.table("shops").select("id").eq("shop_code", shop_code.strip().upper()).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Shop not found")
    shop_id = res.data[0]["id"]
    
    lane_type = "colour" if colour else "bw"
    
    # Call the RPC
    try:
        selected_pages = _selected_page_count(page_range, pages) if pages else 0
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    rpc_res = sb.rpc("calculate_queue_estimate", {
        "p_shop_id": shop_id,
        "p_lane_type": lane_type,
        "p_job_pages": selected_pages,
        "p_job_copies": copies,
        "p_job_is_duplex": duplex
    }).execute()
    
    if rpc_res.data is None:
         # Fallback on RPC failure
         return format_queue_estimate({"error": "rpc_failed"})
         
    return format_queue_estimate(rpc_res.data)


# Shop Console Endpoints

class WalkinBacklogUpdate(BaseModel):
    lane_type: str = Field(..., pattern="^(bw|colour)$")
    backlog_minutes: int = Field(..., ge=0, le=120)
    duration_minutes: int = Field(60, ge=5, le=480)
    reason: Optional[str] = Field(None, max_length=300)

class PrinterLaneUpdate(BaseModel):
    lane_type: str = Field(..., pattern="^(bw|colour)$")
    ppm_simplex: float = Field(..., gt=0.0)
    ppm_duplex: float = Field(..., gt=0.0)
    job_setup_overhead_sec: int = Field(..., ge=0)
    physical_device_key: str = Field("shared-default", min_length=1, max_length=80)
    device_id: Optional[str] = None
    enabled: bool = True

@router.get("/api/v3/shop/queue-settings")
def get_queue_settings(req: Request, session: dict = Depends(require_role(["owner", "staff"]))):
    """
    Returns printer lanes and all currently active, lane-specific backlogs.
    """
    _require_queue_estimates_enabled()
    sb = get_supabase_client()
    shop_id = get_session_shop_id(session)
    
    lanes_res = sb.table("shop_printer_lanes").select("*").eq("shop_id", shop_id).order("lane_type").execute()
    
    # Active backlog
    # Supabase Python client currently doesn't do great gt/lt filtering on now(), 
    # but we can filter in Python for simplicity since it's 1 row max.
    backlog_res = sb.table("shop_walkin_backlogs").select("*").eq("shop_id", shop_id).execute()
    active_backlogs = []
    for backlog in backlog_res.data or []:
        try:
             expires = datetime.fromisoformat(backlog["expires_at"].replace("Z", "+00:00"))
             if expires > datetime.now(timezone.utc):
                 active_backlogs.append(backlog)
        except ValueError:
             pass
             
    return {
        "lanes": lanes_res.data,
        "active_backlogs": active_backlogs
    }

@router.put("/api/v3/shop/walkin-backlog")
def update_walkin_backlog(
    update: WalkinBacklogUpdate, 
    req: Request, 
    session: dict = Depends(require_role(["owner", "staff"]))
):
    _require_queue_estimates_enabled()
    sb = get_supabase_client()
    shop_id = get_session_shop_id(session)
    
    if update.backlog_minutes == 0:
        # Clear it by setting expiry to now
        expires_at = datetime.now(timezone.utc).isoformat()
    else:
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=update.duration_minutes)).isoformat()
        
    sb.table("shop_walkin_backlogs").upsert({
        "shop_id": shop_id,
        "lane_type": update.lane_type,
        "backlog_minutes": update.backlog_minutes,
        "expires_at": expires_at,
        "set_by_user_id": session["user_id"],
        "reason": update.reason.strip() if update.reason else None,
    }, on_conflict="shop_id,lane_type").execute()
    
    return {"status": "success", "expires_at": expires_at}

@router.put("/api/v3/shop/printer-lanes")
def update_printer_lane(
    update: PrinterLaneUpdate,
    req: Request,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    _require_queue_estimates_enabled()
    sb = get_supabase_client()
    shop_id = get_session_shop_id(session)
    if update.device_id:
        device_res = sb.table("devices").select("id").eq("id", update.device_id).eq("shop_id", shop_id).execute()
        if not device_res.data:
            raise HTTPException(status_code=422, detail="Printer device does not belong to this shop")
    
    sb.table("shop_printer_lanes").upsert({
        "shop_id": shop_id,
        "lane_type": update.lane_type,
        "ppm_simplex": update.ppm_simplex,
        "ppm_duplex": update.ppm_duplex,
        "job_setup_overhead_sec": update.job_setup_overhead_sec,
        "physical_device_key": update.physical_device_key.strip(),
        "device_id": update.device_id,
        "enabled": update.enabled,
        "updated_by_user_id": session["user_id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="shop_id,lane_type").execute()
    
    return {"status": "success"}
