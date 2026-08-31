import secrets
import hashlib
from typing import Tuple, Optional

def generate_capability_token() -> Tuple[str, str]:
    """Generate raw 256-bit capability token and its SHA-256 hash."""
    raw_token = secrets.token_hex(32)
    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    return raw_token, token_hash

def hash_capability_token(token: str) -> str:
    """Return SHA-256 hash of capability token."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()
