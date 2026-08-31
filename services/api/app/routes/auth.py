from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import secrets
import time

from app.auth import (
    is_rate_limited, record_login_attempt, create_session,
    revoke_session, verify_session_and_csrf, hash_token, generate_secure_token
)
from app.dependencies import get_current_session
from app.db import create_auth_client, get_supabase_client
from app.settings import settings

router = APIRouter(prefix="/api/v3/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    status: str
    csrf_token: str
    user: dict


def _set_session_cookie(response: Response, session_token: str) -> None:
    is_production = settings.environment == "production"
    response.set_cookie(
        key="autoprint_session",
        value=session_token,
        httponly=True,
        secure=is_production,
        samesite="none" if is_production else "lax",
        path="/",
        max_age=7200,
    )


def _login_payload(user: dict, membership: dict, response: Response) -> dict:
    session_token, csrf_token, _session_row = create_session(user["id"], membership["shop_id"], membership["role"])
    _set_session_cookie(response, session_token)
    return {
        "status": "success",
        "csrf_token": csrf_token,
        "user": {
            "id": user["id"], "email": user.get("email"), "display_name": user.get("display_name"),
            "shop_id": membership["shop_id"], "role": membership["role"],
        },
    }


@router.post("/login")
async def login(req: LoginRequest, request: Request, response: Response):
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{req.email.strip().lower()}"

    if is_rate_limited(rate_key):
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please try again later."
        )

    # --- Step 1: Authenticate via Supabase Auth ---
    # This verifies the password against Supabase Auth's hashed credential store.
    # Any email not registered in Supabase Auth will fail here.
    auth_client = create_auth_client()
    try:
        auth_res = auth_client.auth.sign_in_with_password({
            "email": req.email.strip().lower(),
            "password": req.password
        })
    except Exception as exc:
        # Supabase Auth raises on invalid credentials or unconfirmed account
        record_login_attempt(rate_key)
        raise HTTPException(status_code=401, detail="Invalid credentials") from exc

    if not auth_res or not auth_res.user:
        record_login_attempt(rate_key)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    supabase_uid = auth_res.user.id  # UUID from Supabase Auth

    # --- Step 2: Look up the matching user + membership in autoprint_v3 ---
    try:
        client = get_supabase_client()
        user_res = client.table("users").select(
            "id, email, display_name, shop_memberships(*)"
        ).eq("identity_subject", supabase_uid).is_("disabled_at", "null").execute()
    except Exception as exc:
        record_login_attempt(rate_key)
        raise HTTPException(status_code=500, detail="User lookup failed") from exc

    if not user_res.data:
        record_login_attempt(rate_key)
        raise HTTPException(
            status_code=401,
            detail="Authenticated user has no autoprint_v3 profile"
        )

    user = user_res.data[0]
    memberships = user.get("shop_memberships", [])
    if isinstance(memberships, dict):
        memberships = [memberships]

    active_memberships = [m for m in memberships if m.get("active")]
    if not active_memberships:
        record_login_attempt(rate_key)
        raise HTTPException(status_code=401, detail="No active shop membership")

    shop_id = active_memberships[0]["shop_id"]
    role = active_memberships[0]["role"]

    # --- Step 3: Create our own session row (HttpOnly cookie approach) ---
    return _login_payload(user, {"shop_id": shop_id, "role": role}, response)


@router.post("/pilot-login", response_model=LoginResponse)
async def pilot_login(response: Response):
    """Fast, passwordless entry for the founder-approved pilot environment only."""
    if not settings.pilot_fast_mode or not settings.canary_owner_email:
        raise HTTPException(status_code=403, detail="Pilot access is not enabled")
    client = get_supabase_client()
    result = client.table("users").select("id, email, display_name, shop_memberships(*)").eq(
        "email", settings.canary_owner_email
    ).is_("disabled_at", "null").execute()
    if not result.data:
        raise HTTPException(status_code=503, detail="Pilot shop profile is unavailable")
    user = result.data[0]
    memberships = user.get("shop_memberships") or []
    if isinstance(memberships, dict):
        memberships = [memberships]
    membership = next((item for item in memberships if item.get("active")), None)
    if not membership:
        raise HTTPException(status_code=503, detail="Pilot shop membership is unavailable")
    return _login_payload(user, membership, response)


@router.get("/session")
async def get_session(session: dict = Depends(get_current_session)):
    return {
        "status": "active",
        "session": {
            "id": session.get("id"),
            "user_id": session.get("user_id"),
            "expires_at": session.get("expires_at"),
            "user": session.get("users"),
            "memberships": session.get("shop_memberships")
        }
    }


@router.post("/csrf")
async def get_csrf(session: dict = Depends(get_current_session), response: Response = None):
    """
    Return a fresh raw CSRF token.  We generate a new token, hash it, update
    the session row's csrf_hash, and return the raw token.  The client must
    send this raw token in X-AutoPrint-CSRF on every state-mutating request.
    """
    new_csrf_raw = generate_secure_token()
    new_csrf_hash = hash_token(new_csrf_raw)

    client = get_supabase_client()
    client.table("user_sessions").update({
        "csrf_hash": new_csrf_hash
    }).eq("id", session["id"]).execute()

    return {"csrf_token": new_csrf_raw}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    session: dict = Depends(get_current_session)
):
    session_cookie = request.cookies.get("autoprint_session")
    if session_cookie:
        revoke_session(session_cookie)

    is_production = settings.environment == "production"
    response.delete_cookie(key="autoprint_session", path="/", secure=is_production, samesite="none" if is_production else "lax")
    return {"status": "logged_out"}
