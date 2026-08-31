from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import get_public_supabase_client, get_supabase_client
from app.settings import settings


router = APIRouter(prefix="/api/v3/shops", tags=["Public Shops"])


class PublicShopResponse(BaseModel):
    shop_code: str
    name: str
    accepting_orders: bool
    agent_online: bool
    last_seen_at: str | None = None
    demo_mode: bool = False


class PublicRateCardResponse(BaseModel):
    version: int
    currency: str = "INR"
    rules: dict


def _agent_is_online(last_seen_at: str | None, *, stale_seconds: int = 90) -> bool:
    if not last_seen_at:
        return False
    try:
        normalized = last_seen_at[:-1] + "+00:00" if last_seen_at.endswith("Z") else last_seen_at
        observed = datetime.fromisoformat(normalized)
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - observed.astimezone(timezone.utc)).total_seconds()
        return 0 <= age < stale_seconds
    except (TypeError, ValueError):
        return False


@router.get("/{shop_code}", response_model=PublicShopResponse)
async def get_public_shop(shop_code: str):
    normalized_code = shop_code.strip().upper()
    if not normalized_code:
        raise HTTPException(status_code=404, detail="Shop not found")

    # A deliberately isolated local fixture for founder/UI review. It never
    # exists in production and cannot create orders or reach a printer.
    if settings.environment != "production" and normalized_code == "DEMO001":
        return PublicShopResponse(
            shop_code="DEMO001",
            name="AutoPrint Demo Shop",
            accepting_orders=True,
            agent_online=False,
            demo_mode=True,
        )

    result = (
        get_public_supabase_client()
        .table("shops")
        .select("name, shop_code, is_active, migration_mode, last_seen_at")
        .eq("shop_code", normalized_code)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Shop code not found")

    shop = result.data[0]
    accepting_orders = bool(shop.get("is_active")) and shop.get("migration_mode") in {
        "v3_canary",
        "v3_active",
    }
    if not accepting_orders:
        raise HTTPException(status_code=404, detail="Shop is not accepting AutoPrint orders")

    return PublicShopResponse(
        shop_code=shop["shop_code"],
        name=shop.get("name") or "Print Shop",
        accepting_orders=True,
        agent_online=_agent_is_online(shop.get("last_seen_at")),
        last_seen_at=shop.get("last_seen_at"),
        demo_mode=False,
    )


@router.get("/{shop_code}/rates", response_model=PublicRateCardResponse)
async def get_public_shop_rates(shop_code: str):
    """Return the active public print rates for deterministic UI estimates.

    The final quote is still calculated and persisted by the quote API.
    """
    normalized_code = shop_code.strip().upper()
    if settings.environment != "production" and normalized_code == "DEMO001":
        return PublicRateCardResponse(version=1, rules={
            "bw_simplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 2}],
            "bw_duplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 1.5}],
            "color_simplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 10}],
            "color_duplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 8}],
        })
    shop_res = get_public_supabase_client().table("shops").select(
        "id, is_active, migration_mode"
    ).eq("shop_code", normalized_code).limit(1).execute()
    if not shop_res.data:
        raise HTTPException(status_code=404, detail="Shop not found")
    shop = shop_res.data[0]
    if not shop.get("is_active") or shop.get("migration_mode") not in {"v3_canary", "v3_active"}:
        raise HTTPException(status_code=404, detail="Shop is not accepting AutoPrint orders")
    rates = get_supabase_client().table("rate_cards").select(
        "version, rules_json"
    ).eq("shop_id", shop["id"]).is_("retired_at", "null").order("version", desc=True).limit(1).execute()
    if not rates.data:
        raise HTTPException(status_code=422, detail="No active rate card configured for this shop")
    return PublicRateCardResponse(version=rates.data[0]["version"], rules=rates.data[0]["rules_json"])
