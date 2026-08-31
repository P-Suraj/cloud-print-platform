import hashlib
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, Request

from app.db import get_supabase_client


CUSTOMER_COOKIE = "autoprint_customer_session"
CUSTOMER_SESSION_SECONDS = 30 * 24 * 60 * 60


def hash_customer_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _parse_timestamp(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def create_customer_session(customer_id: str) -> tuple[str, str]:
    raw_token = secrets.token_hex(32)
    raw_csrf = secrets.token_hex(32)
    expires_at = time.strftime(
        "%Y-%m-%d %H:%M:%S+00",
        time.gmtime(time.time() + CUSTOMER_SESSION_SECONDS),
    )
    get_supabase_client().table("customer_sessions").insert({
        "customer_id": customer_id,
        "token_hash": hash_customer_token(raw_token),
        "csrf_hash": hash_customer_token(raw_csrf),
        "expires_at": expires_at,
    }).execute()
    return raw_token, raw_csrf


def verify_customer_session(raw_token: str, csrf_token: Optional[str] = None) -> Optional[dict]:
    if not raw_token:
        return None
    result = get_supabase_client().table("customer_sessions").select(
        "*, customers(*)"
    ).eq("token_hash", hash_customer_token(raw_token)).is_(
        "revoked_at", "null"
    ).execute()
    if not result.data:
        return None
    session = result.data[0]
    try:
        if _parse_timestamp(session["expires_at"]) <= datetime.now(timezone.utc):
            return None
    except (KeyError, TypeError, ValueError):
        return None
    customer = session.get("customers") or {}
    if customer.get("disabled_at") or not customer.get("verified_at"):
        return None
    if csrf_token and not secrets.compare_digest(
        hash_customer_token(csrf_token), session.get("csrf_hash", "")
    ):
        return None
    try:
        get_supabase_client().table("customer_sessions").update({
            "last_active_at": time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime())
        }).eq("id", session["id"]).execute()
    except Exception:
        pass
    return session


def optional_customer_session(request: Request, *, require_csrf: bool = False) -> Optional[dict]:
    raw_token = request.cookies.get(CUSTOMER_COOKIE)
    if not raw_token:
        return None
    csrf_token = request.headers.get("X-AutoPrint-Customer-CSRF") if require_csrf else None
    if require_csrf and not csrf_token:
        raise HTTPException(status_code=403, detail="Customer CSRF token missing")
    session = verify_customer_session(raw_token, csrf_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired customer session")
    return session


def require_customer_session(request: Request, *, require_csrf: bool = False) -> dict:
    session = optional_customer_session(request, require_csrf=require_csrf)
    if not session:
        raise HTTPException(status_code=401, detail="Verified customer session required")
    return session
