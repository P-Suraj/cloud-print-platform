import hashlib
import hmac
import secrets
from app.settings import settings

# 32-character unambiguous alphabet (no 0, O, 1, I)
UNAMBIGUOUS_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

def _get_key_for_version(version: int = 1) -> bytes:
    """Retrieve HMAC key for a given key version."""
    if version == 1:
        return settings.pickup_code_key_v1.encode("utf-8")
    return settings.pickup_code_key_v1.encode("utf-8")


def normalize_pickup_code(raw_code: str) -> str:
    """
    Safely normalize customer- or shopkeeper-entered pickup code.
    Strips leading/trailing whitespace, internal spaces, hyphens, and converts to uppercase.
    """
    if not raw_code:
        return ""
    # Strip whitespace, hyphens, underscores, dots
    cleaned = "".join(c for c in raw_code if c.isalnum()).upper()
    return cleaned


def derive_pickup_code(pickup_id: str, order_id: str, key_version: int = 1) -> str:
    """
    Derive an 8-character human-readable pickup code deterministically from
    pickup_id and order_id using a server-held versioned HMAC key.
    Plaintext code is NEVER stored in database or logged.
    """
    key = _get_key_for_version(key_version)
    material = f"{pickup_id}:{order_id}".encode("utf-8")
    mac = hmac.new(key, material, hashlib.sha256).digest()

    code_chars = []
    for i in range(8):
        byte_val = mac[i] ^ mac[i + 8] ^ mac[i + 16] ^ mac[i + 24]
        code_chars.append(UNAMBIGUOUS_ALPHABET[byte_val % len(UNAMBIGUOUS_ALPHABET)])

    return "".join(code_chars)


def generate_qr_bearer_token(pickup_id: str, order_id: str, key_version: int = 1) -> str:
    """
    Generate an unforgeable cryptographic QR bearer payload.
    Encodes pickup_id and a secure HMAC signature over (pickup_id + order_id).
    Merely guessing a pickup UUID is insufficient to forge the QR code.
    """
    key = _get_key_for_version(key_version)
    material = f"qr_token:{pickup_id}:{order_id}".encode("utf-8")
    sig = hmac.new(key, material, hashlib.sha256).hexdigest()[:16]
    code = derive_pickup_code(pickup_id, order_id, key_version)
    return f"autoprint:pickup:v3:{pickup_id}:{code}:{sig}"


def verify_qr_bearer_token(qr_payload: str, pickup_id: str, order_id: str, key_version: int = 1) -> bool:
    """Validate that a scanned QR payload contains a valid HMAC bearer signature."""
    if not qr_payload or not qr_payload.startswith("autoprint:pickup:v3:"):
        return False
    parts = qr_payload.split(":")
    if len(parts) < 6:
        return False
    payload_pickup_id = parts[3]
    payload_code = parts[4]
    payload_sig = parts[5]

    if not secrets.compare_digest(payload_pickup_id, str(pickup_id)):
        return False

    key = _get_key_for_version(key_version)
    material = f"qr_token:{pickup_id}:{order_id}".encode("utf-8")
    expected_sig = hmac.new(key, material, hashlib.sha256).hexdigest()[:16]

    expected_code = derive_pickup_code(pickup_id, order_id, key_version)
    sig_valid = secrets.compare_digest(payload_sig, expected_sig)
    code_valid = secrets.compare_digest(normalize_pickup_code(payload_code), expected_code)

    return sig_valid and code_valid


def hash_pickup_code(code: str, pickup_id: str) -> str:
    """Compute the SHA-256 verification hash for a normalized pickup code scoped to pickup_id."""
    normalized = normalize_pickup_code(code)
    salted = f"{normalized}:{pickup_id}"
    return hashlib.sha256(salted.encode("utf-8")).hexdigest()


def verify_code_hash_constant_time(provided_code: str, pickup_id: str, expected_hash: str) -> bool:
    """
    Verify pickup code against stored hash in constant time (Python-level protection
    against timing side-channel attacks on PostgreSQL comparisons).
    """
    if not provided_code or not expected_hash:
        return False
    computed = hash_pickup_code(provided_code, pickup_id)
    return secrets.compare_digest(computed, expected_hash)


def compute_actor_bucket_hash(session_id: str, client_ip: str) -> str:
    """Generate a privacy-safe bucket hash for rate limiting (never stores raw IP)."""
    raw = f"{session_id}:{client_ip}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
