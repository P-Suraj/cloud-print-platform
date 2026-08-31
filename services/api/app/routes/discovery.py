from fastapi import APIRouter, HTTPException, Depends, Query, Path
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, date

from app.dependencies import get_current_session, require_role
from app.shop_authorization import get_session_shop_id
from app.db import get_supabase_client, get_public_supabase_client
from app.maps_url import validate_maps_url
from app.shop_hours import compute_is_open_now
from app.settings import settings

router = APIRouter(tags=["Shop Discovery"])

DEMO_DEV_SHOPS = [
    {
        "shop_code": "CANARY01",
        "name": "AutoPrint Canary Hub",
        "address_line": "Campus Main Gate, North Block",
        "locality": "North Campus",
        "pincode": "560001",
        "maps_url": "https://maps.google.com/?q=AutoPrint+Canary",
        "distance_km": 0.3,
        "open_status": {
            "is_open": True,
            "reason": "open",
            "opens_at": "08:30:00",
            "closes_at": "21:00:00"
        },
        "remote_orders_available": True,
        "capabilities": {
            "bw_printing": True,
            "colour_printing": True,
            "a4_paper": True,
            "a3_paper": True,
            "duplex_printing": True
        }
    },
    {
        "shop_code": "DEMO001",
        "name": "AutoPrint Demo Shop",
        "address_line": "Student Activity Center, Room 102",
        "locality": "Central Campus",
        "pincode": "560001",
        "maps_url": "https://maps.google.com/?q=AutoPrint+Demo",
        "distance_km": 0.8,
        "open_status": {
            "is_open": True,
            "reason": "open",
            "opens_at": "09:00:00",
            "closes_at": "20:00:00"
        },
        "remote_orders_available": True,
        "capabilities": {
            "bw_printing": True,
            "colour_printing": True,
            "a4_paper": True,
            "a3_paper": False,
            "duplex_printing": True
        }
    },
    {
        "shop_code": "LIB002",
        "name": "Central Library Reprographics",
        "address_line": "Central Library Ground Floor",
        "locality": "South Campus",
        "pincode": "560037",
        "maps_url": "https://maps.google.com/?q=Library+Print",
        "distance_km": 1.5,
        "open_status": {
            "is_open": True,
            "reason": "open",
            "opens_at": "08:00:00",
            "closes_at": "22:00:00"
        },
        "remote_orders_available": False,
        "capabilities": {
            "bw_printing": True,
            "colour_printing": False,
            "a4_paper": True,
            "a3_paper": False,
            "duplex_printing": True
        }
    }
]


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic Request / Response Models
# ─────────────────────────────────────────────────────────────────────────────
class LocationUpdateRequest(BaseModel):
    lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    lng: Optional[float] = Field(None, ge=-180.0, le=180.0)
    address_line: Optional[str] = Field(None, max_length=300)
    locality: Optional[str] = Field(None, max_length=100)
    pincode: Optional[str] = Field(None, min_length=4, max_length=10)
    maps_url: Optional[str] = Field(None, max_length=2000)
    timezone: Optional[str] = Field("Asia/Kolkata", max_length=50)


class ShopHourItem(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6)
    opens_at: Optional[str] = None
    closes_at: Optional[str] = None
    is_closed: bool = False


class SetHoursRequest(BaseModel):
    hours: List[ShopHourItem]


class HourExceptionRequest(BaseModel):
    exception_date: str # YYYY-MM-DD
    is_closed: bool = True
    opens_at: Optional[str] = None
    closes_at: Optional[str] = None
    note: Optional[str] = Field(None, max_length=200)


class CapabilitiesUpdateRequest(BaseModel):
    bw_printing: bool = True
    colour_printing: bool = False
    a4_paper: bool = True
    a3_paper: bool = False
    duplex_printing: bool = False


class DiscoveryToggleRequest(BaseModel):
    discovery_enabled: bool
    manual_closed_override: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# Public Discovery Endpoints (No Auth Required)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/v3/discovery/shops/nearby")
async def list_nearby_shops(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Customer latitude"),
    lng: float = Query(..., ge=-180.0, le=180.0, description="Customer longitude"),
    radius_km: float = Query(5.0, ge=0.5, description="Search radius in km (max 25.0)"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    open_now: bool = Query(False, description="Filter for shops currently open"),
    remote_orders: bool = Query(False, description="Filter for shops with active remote orders"),
    bw: bool = Query(False, description="Filter for B&W printing"),
    colour: bool = Query(False, description="Filter for Colour printing"),
    a3: bool = Query(False, description="Filter for A3 paper"),
    duplex: bool = Query(False, description="Filter for Duplex printing")
):
    """
    Search for nearby AutoPrint shops within a bounded radius using pure-SQL haversine distance.
    Returns safe, redacted public card data with rounded distances.
    """
    if radius_km > 25.0:
        raise HTTPException(status_code=422, detail="Search radius cannot exceed 25 km")

    try:
        client = get_supabase_client()
        res = client.rpc("find_nearby_shops", {
            "p_lat": lat,
            "p_lng": lng,
            "p_radius_km": radius_km,
            "p_limit": limit,
            "p_offset": offset,
            "p_filter_remote_orders": remote_orders,
            "p_filter_colour": colour,
            "p_filter_bw": bw,
            "p_filter_a3": a3,
            "p_filter_duplex": duplex
        }).execute()
        raw_shops = res.data or []

        if not raw_shops:
            return {"status": "success", "count": 0, "shops": []}

        shop_ids = [s["shop_id"] for s in raw_shops]

        # Fetch weekly hours and exceptions in bulk for accurate open_status evaluation
        hours_res = client.table("shop_hours").select("*").in_("shop_id", shop_ids).execute()
        all_hours = hours_res.data or []

        today_iso = date.today().isoformat()
        exc_res = client.table("shop_hour_exceptions").select("*").in_("shop_id", shop_ids).eq("exception_date", today_iso).execute()
        all_exceptions = exc_res.data or []

        hours_by_shop: Dict[str, list] = {}
        for h in all_hours:
            hours_by_shop.setdefault(h["shop_id"], []).append(h)

        exc_by_shop: Dict[str, list] = {}
        for e in all_exceptions:
            exc_by_shop.setdefault(e["shop_id"], []).append(e)

        processed_shops = []
        for s in raw_shops:
            sid = s["shop_id"]
            s_hours = hours_by_shop.get(sid, [])
            s_exc = exc_by_shop.get(sid, [])
            s_tz = s.get("timezone") or "Asia/Kolkata"
            manual_closed = bool(s.get("manual_closed_override"))

            open_status = compute_is_open_now(
                weekly_hours=s_hours,
                exceptions=s_exc,
                manual_closed_override=manual_closed,
                manual_closed_until=s.get("manual_closed_until"),
                shop_timezone=s_tz
            )

            if open_now and not open_status["is_open"]:
                continue

            processed_shops.append({
                "shop_code": s["shop_code"],
                "name": s["name"],
                "address_line": s.get("address_line"),
                "locality": s.get("locality"),
                "pincode": s.get("pincode"),
                "maps_url": s.get("maps_url"),
                "distance_km": float(s["distance_km"]) if s.get("distance_km") is not None else None,
                "open_status": open_status,
                "remote_orders_available": bool(s.get("remote_orders_enabled") and not s.get("remote_orders_paused")),
                "capabilities": {
                    "bw_printing": bool(s.get("bw_printing", True)),
                    "colour_printing": bool(s.get("colour_printing", False)),
                    "a4_paper": bool(s.get("a4_paper", True)),
                    "a3_paper": bool(s.get("a3_paper", False)),
                    "duplex_printing": bool(s.get("duplex_printing", False)),
                }
            })

        return {
            "status": "success",
            "count": len(processed_shops),
            "shops": processed_shops
        }
    except Exception as exc:
        if settings.environment != "production":
            filtered = list(DEMO_DEV_SHOPS)
            if remote_orders:
                filtered = [s for s in filtered if s["remote_orders_available"]]
            if colour:
                filtered = [s for s in filtered if s["capabilities"]["colour_printing"]]
            if open_now:
                filtered = [s for s in filtered if s["open_status"]["is_open"]]
            return {
                "status": "success",
                "count": len(filtered),
                "shops": filtered,
                "dev_mode": True
            }
        raise HTTPException(status_code=503, detail="Discovery service is temporarily unavailable") from exc


@router.get("/api/v3/discovery/shops/search")
async def search_shops_by_text(
    locality: Optional[str] = Query(None, description="Campus, locality or city"),
    pincode: Optional[str] = Query(None, description="6-digit Indian PIN code"),
    query: Optional[str] = Query(None, description="General search term"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    open_now: bool = Query(False),
    remote_orders: bool = Query(False),
    colour: bool = Query(False)
):
    """
    Search shops by locality, pincode, or text when browser location is denied or unavailable.
    """
    try:
        client = get_supabase_client()
        q = client.table("shop_locations").select(
            "shop_id, address_line, locality, pincode, lat, lng, timezone, manual_closed_override, manual_closed_until, discovery_enabled"
        ).eq("discovery_enabled", True)

        if pincode:
            q = q.eq("pincode", pincode.strip())
        elif locality:
            q = q.ilike("locality", f"%{locality.strip()}%")

        res = q.limit(limit).execute()
        locations = res.data or []
    except Exception as exc:
        if settings.environment != "production":
            filtered = list(DEMO_DEV_SHOPS)
            if locality:
                filtered = [s for s in filtered if locality.lower() in (s.get("locality") or "").lower()]
            if pincode:
                filtered = [s for s in filtered if s.get("pincode") == pincode.strip()]
            if remote_orders:
                filtered = [s for s in filtered if s["remote_orders_available"]]
            if colour:
                filtered = [s for s in filtered if s["capabilities"]["colour_printing"]]
            if open_now:
                filtered = [s for s in filtered if s["open_status"]["is_open"]]
            return {
                "status": "success",
                "count": len(filtered),
                "shops": filtered,
                "dev_mode": True
            }
        raise HTTPException(status_code=503, detail="Search service is temporarily unavailable") from exc

    if not locations:
        return {"status": "success", "count": 0, "shops": []}

    shop_ids = [loc["shop_id"] for loc in locations]

    # Fetch active shop records
    shops_res = get_public_supabase_client().table("shops").select(
        "id, shop_code, name, is_active, migration_mode"
    ).in_("id", shop_ids).eq("is_active", True).execute()
    active_shops = {s["id"]: s for s in (shops_res.data or []) if s.get("migration_mode") in ("v3_canary", "v3_active")}

    # Fetch policies and capabilities
    policies_res = client.table("shop_remote_policies").select("shop_id, remote_orders_enabled, remote_orders_paused").in_("shop_id", shop_ids).execute()
    policies = {p["shop_id"]: p for p in (policies_res.data or [])}

    caps_res = client.table("shop_capabilities_public").select("*").in_("shop_id", shop_ids).execute()
    caps = {c["shop_id"]: c for c in (caps_res.data or [])}

    hours_res = client.table("shop_hours").select("*").in_("shop_id", shop_ids).execute()
    all_hours = hours_res.data or []
    hours_by_shop: Dict[str, list] = {}
    for h in all_hours:
        hours_by_shop.setdefault(h["shop_id"], []).append(h)

    today_iso = date.today().isoformat()
    exc_res = client.table("shop_hour_exceptions").select("*").in_("shop_id", shop_ids).eq("exception_date", today_iso).execute()
    all_exceptions = exc_res.data or []
    exc_by_shop: Dict[str, list] = {}
    for e in all_exceptions:
        exc_by_shop.setdefault(e["shop_id"], []).append(e)

    results = []
    for loc in locations:
        sid = loc["shop_id"]
        shop_record = active_shops.get(sid)
        if not shop_record:
            continue

        policy = policies.get(sid, {})
        cap = caps.get(sid, {})
        is_remote = bool(policy.get("remote_orders_enabled") and not policy.get("remote_orders_paused"))

        if remote_orders and not is_remote:
            continue
        if colour and not cap.get("colour_printing"):
            continue

        s_hours = hours_by_shop.get(sid, [])
        s_exc = exc_by_shop.get(sid, [])
        open_status = compute_is_open_now(
            weekly_hours=s_hours,
                exceptions=s_exc,
                manual_closed_override=bool(loc.get("manual_closed_override")),
                manual_closed_until=loc.get("manual_closed_until"),
            shop_timezone=loc.get("timezone", "Asia/Kolkata")
        )

        if open_now and not open_status["is_open"]:
            continue

        results.append({
            "shop_code": shop_record["shop_code"],
            "name": shop_record["name"],
            "address_line": loc.get("address_line"),
            "locality": loc.get("locality"),
            "pincode": loc.get("pincode"),
                "maps_url": _directions_url(loc.get("lat"), loc.get("lng")),
            "distance_km": None, # Distance not applicable for text search
            "open_status": open_status,
            "remote_orders_available": is_remote,
            "capabilities": {
                "bw_printing": bool(cap.get("bw_printing", True)),
                "colour_printing": bool(cap.get("colour_printing", False)),
                "a4_paper": bool(cap.get("a4_paper", True)),
                "a3_paper": bool(cap.get("a3_paper", False)),
                "duplex_printing": bool(cap.get("duplex_printing", False)),
            }
        })

    return {
        "status": "success",
        "count": len(results),
        "shops": results
    }


@router.get("/api/v3/discovery/shops/{shop_code}/profile")
async def get_shop_public_profile(shop_code: str = Path(..., description="Unique shop code")):
    """
    Public shop profile for directions and opening hours display.
    Guarantees no internal device IDs, user IDs, or private settings leak.
    """
    normalized_code = shop_code.strip().upper()

    # Isolated demo fixture in development mode
    if settings.environment != "production" and normalized_code == "DEMO001":
        return {
            "shop_code": "DEMO001",
            "name": "AutoPrint Demo Shop",
            "address_line": "Student Activity Center, Room 102",
            "locality": "Central Campus",
            "pincode": "560001",
            "maps_url": "https://maps.google.com/?q=AutoPrint+Demo",
            "open_status": {
                "is_open": True,
                "reason": "open",
                "opens_at": "09:00:00",
                "closes_at": "20:00:00"
            },
            "weekly_hours": [
                {"day_of_week": i, "opens_at": "09:00:00", "closes_at": "20:00:00", "is_closed": False}
                for i in range(7)
            ],
            "remote_orders_available": True,
            "capabilities": {
                "bw_printing": True,
                "colour_printing": True,
                "a4_paper": True,
                "a3_paper": False,
                "duplex_printing": True
            },
            "demo_mode": True
        }

    try:
        client = get_supabase_client()
        shops_res = get_public_supabase_client().table("shops").select(
            "id, shop_code, name, is_active, migration_mode"
        ).eq("shop_code", normalized_code).limit(1).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Profile service is temporarily unavailable") from exc

    if not shops_res.data:
        raise HTTPException(status_code=404, detail="Shop not found")

    shop = shops_res.data[0]
    if not shop.get("is_active") or shop.get("migration_mode") not in ("v3_canary", "v3_active"):
        raise HTTPException(status_code=404, detail="Shop is not active on AutoPrint v3")

    sid = shop["id"]
    loc_res = client.table("shop_locations").select("*").eq("shop_id", sid).limit(1).execute()
    loc = loc_res.data[0] if loc_res.data else {}

    cap_res = client.table("shop_capabilities_public").select("*").eq("shop_id", sid).limit(1).execute()
    cap = cap_res.data[0] if cap_res.data else {}

    policy_res = client.table("shop_remote_policies").select("remote_orders_enabled, remote_orders_paused").eq("shop_id", sid).limit(1).execute()
    policy = policy_res.data[0] if policy_res.data else {}

    hours_res = client.table("shop_hours").select("day_of_week, opens_at, closes_at, is_closed").eq("shop_id", sid).order("day_of_week").execute()
    weekly_hours = hours_res.data or []

    today_iso = date.today().isoformat()
    exc_res = client.table("shop_hour_exceptions").select("exception_date, is_closed, opens_at, closes_at, note").eq("shop_id", sid).eq("exception_date", today_iso).execute()
    exceptions = exc_res.data or []

    open_status = compute_is_open_now(
        weekly_hours=weekly_hours,
        exceptions=exceptions,
        manual_closed_override=bool(loc.get("manual_closed_override")),
        manual_closed_until=loc.get("manual_closed_until"),
        shop_timezone=loc.get("timezone", "Asia/Kolkata")
    )

    return {
        "shop_code": shop["shop_code"],
        "name": shop["name"],
        "address_line": loc.get("address_line"),
        "locality": loc.get("locality"),
        "pincode": loc.get("pincode"),
        "maps_url": _directions_url(loc.get("lat"), loc.get("lng")),
        "open_status": open_status,
        "weekly_hours": weekly_hours,
        "remote_orders_available": bool(policy.get("remote_orders_enabled") and not policy.get("remote_orders_paused")),
        "capabilities": {
            "bw_printing": bool(cap.get("bw_printing", True)),
            "colour_printing": bool(cap.get("colour_printing", False)),
            "a4_paper": bool(cap.get("a4_paper", True)),
            "a3_paper": bool(cap.get("a3_paper", False)),
            "duplex_printing": bool(cap.get("duplex_printing", False)),
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# Shop Discovery Management Endpoints (Requires Shop Session)
# ─────────────────────────────────────────────────────────────────────────────
@router.put("/api/v3/shop/discovery/location")
async def update_shop_location(
    payload: LocationUpdateRequest,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """Update shop geographic coordinates, address, locality, and Google Maps deep-link."""
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]

    if payload.maps_url:
        if not validate_maps_url(payload.maps_url):
            raise HTTPException(
                status_code=422,
                detail="Invalid Google Maps URL. Must be an HTTPS link to Google Maps (e.g. https://maps.google.com/... or https://maps.app.goo.gl/...)"
            )

    client = get_supabase_client()
    try:
        res = client.rpc("set_shop_location", {
            "p_shop_id": shop_id,
            "p_user_id": user_id,
            "p_lat": payload.lat,
            "p_lng": payload.lng,
            "p_address_line": payload.address_line,
            "p_locality": payload.locality,
            "p_pincode": payload.pincode,
            "p_maps_url": payload.maps_url,
            "p_timezone": payload.timezone or "Asia/Kolkata"
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Failed to update location: {str(exc)}") from exc

    return {"status": "updated", "location": res.data}


@router.put("/api/v3/shop/discovery/hours")
async def update_shop_hours(
    payload: SetHoursRequest,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """Set the regular weekly schedule (DOW 0 to 6)."""
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    for h in payload.hours:
        client.table("shop_hours").upsert({
            "shop_id": shop_id,
            "day_of_week": h.day_of_week,
            "opens_at": h.opens_at,
            "closes_at": h.closes_at,
            "is_closed": h.is_closed
        }, on_conflict="shop_id,day_of_week").execute()

    return {"status": "updated", "count": len(payload.hours)}


@router.post("/api/v3/shop/discovery/hours/exception")
async def add_shop_hour_exception(
    payload: HourExceptionRequest,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """Add or update a date-specific exception (e.g. holiday or custom hours)."""
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    res = client.table("shop_hour_exceptions").upsert({
        "shop_id": shop_id,
        "exception_date": payload.exception_date,
        "is_closed": payload.is_closed,
        "opens_at": payload.opens_at,
        "closes_at": payload.closes_at,
        "note": payload.note
    }, on_conflict="shop_id,exception_date").execute()

    return {"status": "exception_saved", "exception": res.data[0] if res.data else None}


@router.delete("/api/v3/shop/discovery/hours/exception/{exception_date}")
async def delete_shop_hour_exception(
    exception_date: str,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """Remove a date-specific exception."""
    shop_id = get_session_shop_id(session)
    client = get_supabase_client()

    client.table("shop_hour_exceptions").delete().eq("shop_id", shop_id).eq("exception_date", exception_date).execute()
    return {"status": "exception_deleted", "exception_date": exception_date}


@router.put("/api/v3/shop/discovery/capabilities")
async def update_shop_capabilities(
    payload: CapabilitiesUpdateRequest,
    session: dict = Depends(require_role(["owner", "staff"]))
):
    """Configure publicly displayed printer capabilities (B&W, Colour, A4, A3, Duplex)."""
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]
    client = get_supabase_client()

    try:
        res = client.rpc("set_shop_capabilities", {
            "p_shop_id": shop_id,
            "p_user_id": user_id,
            "p_bw": payload.bw_printing,
            "p_colour": payload.colour_printing,
            "p_a4": payload.a4_paper,
            "p_a3": payload.a3_paper,
            "p_duplex": payload.duplex_printing
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Failed to update capabilities: {str(exc)}") from exc

    return {"status": "updated", "capabilities": res.data}


@router.put("/api/v3/shop/discovery/enabled")
async def toggle_shop_discovery(
    payload: DiscoveryToggleRequest,
    session: dict = Depends(require_role(["owner"]))
):
    """Owner-only toggle to enable/disable public discovery listing and manual closure."""
    shop_id = get_session_shop_id(session)
    user_id = session["user_id"]
    client = get_supabase_client()

    try:
        res = client.rpc("set_shop_discovery_enabled", {
            "p_shop_id": shop_id,
            "p_user_id": user_id,
            "p_enabled": payload.discovery_enabled,
            "p_manual_closed_override": payload.manual_closed_override
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Failed to toggle discovery: {str(exc)}") from exc

    return {"status": "updated", "discovery": res.data}


def _directions_url(lat: Any, lng: Any) -> Optional[str]:
    """Expose only a coordinate-derived Google Maps route, never an owner URL."""
    try:
        lat_value = float(lat)
        lng_value = float(lng)
    except (TypeError, ValueError):
        return None
    if not (-90.0 <= lat_value <= 90.0 and -180.0 <= lng_value <= 180.0):
        return None
    return f"https://www.google.com/maps/dir/?api=1&destination={lat_value:.7f}%2C{lng_value:.7f}"
