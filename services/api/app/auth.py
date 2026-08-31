import secrets
import hashlib
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Tuple
from app.db import get_supabase_client

# Rate Limiter Memory Store: ip_or_user -> list of timestamps
_login_attempts: Dict[str, list] = {}

# Idle-timeout window: 2 hours (7200 s)
_IDLE_TIMEOUT_SECONDS = 7200


def hash_token(token: str) -> str:
    """Return SHA-256 hash of token."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def generate_secure_token() -> str:
    """Generate cryptographically secure random token string."""
    return secrets.token_hex(32)


def is_rate_limited(identifier: str, limit: int = 5, window_seconds: int = 900) -> bool:
    """Check if IP/user has exceeded login attempts within the sliding window."""
    now = time.time()
    attempts = _login_attempts.get(identifier, [])
    attempts = [t for t in attempts if now - t < window_seconds]
    _login_attempts[identifier] = attempts
    return len(attempts) >= limit


def record_login_attempt(identifier: str):
    """Record a failed login attempt timestamp."""
    attempts = _login_attempts.get(identifier, [])
    attempts.append(time.time())
    _login_attempts[identifier] = attempts


def _now_utc_str() -> str:
    """Return current UTC time as ISO-8601 string for Supabase."""
    return time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())


def _parse_utc_timestamp(value: str) -> datetime:
    """Parse PostgreSQL/PostgREST ISO timestamps without corrupting +00:00 offsets."""
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def create_session(user_id: str, shop_id: str, role: str) -> Tuple[str, str, dict]:
    """
    Create a new user session row in DB.
    Returns (raw_session_token, raw_csrf_token, session_row).
    Both tokens are stored only as SHA-256 hashes; raw values are returned once.
    Session lifetime: 2 h (idle timeout enforced in verify_session_and_csrf).
    """
    token = generate_secure_token()
    csrf_token = generate_secure_token()

    token_h = hash_token(token)
    csrf_h = hash_token(csrf_token)

    # Absolute hard expiry: 24 h
    expires_at = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime(time.time() + 86400))
    # last_active_at is used to enforce the 2-hour idle timeout
    last_active_at = _now_utc_str()

    client = get_supabase_client()
    session_data = {
        "user_id": user_id,
        "shop_id": shop_id,
        "role": role,
        "token_hash": token_h,
        "csrf_hash": csrf_h,
        "expires_at": expires_at,
        "last_active_at": last_active_at,
    }
    res = client.table("user_sessions").insert(session_data).execute()

    return token, csrf_token, res.data[0] if res.data else {}


def verify_session_and_csrf(
    token: str,
    csrf_header: Optional[str] = None
) -> Optional[dict]:
    """
    Verify session token against DB and enforce:
      1. Session not revoked.
      2. Absolute expires_at has not passed.
      3. Idle timeout (last_active_at < now - 2 h) has not triggered.
      4. If csrf_header provided, hash must match stored csrf_hash.

    Returns the session row on success, None on any failure.
    Bumps last_active_at on each valid call.
    """
    if not token:
        return None

    token_h = hash_token(token)
    client = get_supabase_client()

    res = client.table("user_sessions").select(
        "*, users(*)"
    ).eq("token_hash", token_h).is_("revoked_at", "null").execute()

    if not res.data:
        return None

    session = res.data[0]
    user = session.get("users") or {}
    if user.get("disabled_at"):
        return None

    membership_res = client.table("shop_memberships").select("shop_id, user_id, role, active").eq(
        "user_id", session.get("user_id")
    ).eq("shop_id", session.get("shop_id")).eq("role", session.get("role")).eq("active", True).execute()
    if not membership_res.data:
        return None
    session["shop_memberships"] = membership_res.data
    now = time.time()

    # --- 1. Absolute expiry check ---
    expires_at_str = session.get("expires_at")
    if expires_at_str:
        try:
            # Parse ISO-8601 with offset
            expires_dt = _parse_utc_timestamp(expires_at_str)
            if datetime.now(timezone.utc) > expires_dt:
                return None
        except ValueError:
            return None

    # --- 2. Idle timeout check ---
    last_active_str = session.get("last_active_at")
    if last_active_str:
        try:
            last_active_dt = _parse_utc_timestamp(last_active_str)
            idle_seconds = (datetime.now(timezone.utc) - last_active_dt).total_seconds()
            if idle_seconds > _IDLE_TIMEOUT_SECONDS:
                return None
        except ValueError:
            return None

    # --- 3. CSRF check ---
    if csrf_header:
        if not secrets.compare_digest(hash_token(csrf_header), session.get("csrf_hash", "")):
            return None

    # --- 4. Bump last_active_at ---
    try:
        client.table("user_sessions").update({
            "last_active_at": _now_utc_str()
        }).eq("id", session["id"]).execute()
    except Exception:
        pass  # Non-fatal — session is still valid

    return session


def revoke_session(token: str):
    """Revoke an active session by setting revoked_at."""
    if not token:
        return
    token_h = hash_token(token)
    client = get_supabase_client()
    client.table("user_sessions").update({
        "revoked_at": _now_utc_str()
    }).eq("token_hash", token_h).execute()
