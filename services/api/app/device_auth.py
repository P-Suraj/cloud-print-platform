import secrets
import hashlib
import hmac
from typing import Optional, Tuple
from app.db import get_supabase_client

def hash_secret(secret: str) -> str:
    """Return SHA-256 hash of secret string."""
    return hashlib.sha256(secret.encode('utf-8')).hexdigest()

def generate_enrollment_code() -> Tuple[str, str]:
    """Generate a 96-bit, human-transcribable one-time enrollment code."""
    code = secrets.token_urlsafe(12).upper()
    return code, hash_secret(code)

def generate_device_secret() -> Tuple[str, str]:
    """Generate raw device secret and its SHA-256 hash."""
    secret = secrets.token_hex(32)
    return secret, hash_secret(secret)

def verify_device_credentials(device_id: str, device_secret: str) -> Optional[dict]:
    """Verify device ID and device secret against DB."""
    if not device_id or not device_secret:
        return None
    
    cred_h = hash_secret(device_secret)
    client = get_supabase_client()
    res = client.table("devices").select("*").eq("id", device_id).eq("status", "active").execute()
    
    if not res.data:
        return None
    
    device = res.data[0]
    if not hmac.compare_digest(cred_h, device.get("credential_hash", "")):
        return None
    return device
