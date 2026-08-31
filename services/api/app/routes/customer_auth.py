from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth import is_rate_limited, record_login_attempt
from app.customer_auth import (
    CUSTOMER_COOKIE,
    create_customer_session,
    hash_customer_token,
    require_customer_session,
)
import secrets
from app.db import create_auth_client, get_supabase_client
from app.settings import settings
import time
import uuid


router = APIRouter(prefix="/api/v3/customer-auth", tags=["Customer Authentication"])


def _now_utc() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime())


class EmailCodeRequest(BaseModel):
    email: str


class VerifyEmailCodeRequest(BaseModel):
    email: str
    code: str


def _set_customer_cookie(response: Response, raw_session: str) -> None:
    """Keep production API cookies usable from the separately hosted frontend."""
    is_production = settings.environment == "production"
    response.set_cookie(
        CUSTOMER_COOKIE,
        raw_session,
        httponly=True,
        secure=is_production,
        samesite="none" if is_production else "lax",
        path="/",
        max_age=30 * 24 * 60 * 60,
    )


def _normalized_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 254 or "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    return email


@router.post("/request-code")
async def request_customer_code(payload: EmailCodeRequest, request: Request):
    email = _normalized_email(payload.email)
    rate_key = f"customer-otp:{request.client.host if request.client else 'unknown'}:{email}"
    if is_rate_limited(rate_key, limit=5, window_seconds=900):
        raise HTTPException(status_code=429, detail="Too many verification requests. Try again later.")
    try:
        create_auth_client().auth.sign_in_with_otp({
            "email": email,
            "options": {"should_create_user": True},
        })
    except Exception as exc:
        record_login_attempt(rate_key)
        raise HTTPException(status_code=503, detail="Verification email could not be sent") from exc
    return {"status": "code_sent", "delivery": "email"}


@router.post("/verify-code")
async def verify_customer_code(payload: VerifyEmailCodeRequest, response: Response):
    email = _normalized_email(payload.email)
    code = payload.code.strip()
    if not code or len(code) > 12:
        raise HTTPException(status_code=422, detail="Enter the verification code")
    try:
        auth_result = create_auth_client().auth.verify_otp({
            "email": email,
            "token": code,
            "type": "email",
        })
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired verification code") from exc
    if not auth_result or not auth_result.user:
        raise HTTPException(status_code=401, detail="Invalid or expired verification code")

    identity_subject = str(auth_result.user.id)
    client = get_supabase_client()
    existing = client.table("customers").select("id, email, verified_at").eq(
        "identity_provider", "supabase_email"
    ).eq("identity_subject", identity_subject).execute()
    if existing.data:
        customer = existing.data[0]
        client.table("customers").update({"email": email, "verified_at": _now_utc()}).eq(
            "id", customer["id"]
        ).execute()
    else:
        created = client.table("customers").insert({
            "identity_provider": "supabase_email",
            "identity_subject": identity_subject,
            "email": email,
            "verified_at": _now_utc(),
        }).execute()
        customer = created.data[0]

    raw_session, raw_csrf = create_customer_session(customer["id"])
    _set_customer_cookie(response, raw_session)
    return {
        "status": "verified",
        "csrf_token": raw_csrf,
        "customer": {"id": customer["id"], "email": email},
    }


@router.post("/guest-session")
async def create_guest_customer_session(response: Response):
    """Create an anonymous, auditable session only while test bypass is enabled."""
    if settings.customer_verification_required:
        raise HTTPException(status_code=403, detail="Customer verification is required")

    client = get_supabase_client()
    guest_subject = f"guest-test:{uuid.uuid4()}"
    created = client.table("customers").insert({
        "identity_provider": "temporary_test",
        "identity_subject": guest_subject,
        "verified_at": _now_utc(),
    }).execute()
    customer = created.data[0]
    raw_session, raw_csrf = create_customer_session(customer["id"])
    _set_customer_cookie(response, raw_session)
    return {
        "status": "guest_testing_session",
        "csrf_token": raw_csrf,
        "customer": {"id": customer["id"], "email": None},
    }


@router.get("/session")
async def customer_session(request: Request):
    session = require_customer_session(request)
    customer = session.get("customers") or {}
    return {
        "status": "verified",
        "customer": {"id": session["customer_id"], "email": customer.get("email")},
    }


@router.post("/csrf")
async def refresh_customer_csrf(request: Request):
    # Bootstrap/rotation endpoint: the HttpOnly SameSite cookie authenticates
    # the session; the newly returned raw token is never stored server-side.
    session = require_customer_session(request)
    raw_csrf = secrets.token_hex(32)
    get_supabase_client().table("customer_sessions").update({
        "csrf_hash": hash_customer_token(raw_csrf)
    }).eq("id", session["id"]).execute()
    return {"csrf_token": raw_csrf}


@router.post("/logout")
async def customer_logout(request: Request, response: Response):
    session = require_customer_session(request, require_csrf=True)
    get_supabase_client().table("customer_sessions").update({"revoked_at": _now_utc()}).eq(
        "id", session["id"]
    ).execute()
    is_production = settings.environment == "production"
    response.delete_cookie(
        CUSTOMER_COOKIE,
        path="/",
        secure=is_production,
        samesite="none" if is_production else "lax",
    )
    return {"status": "logged_out"}
