from typing import Optional, Dict, Any
from app.db import get_supabase_client

PROHIBITED_FIELDS = {"session_token", "csrf_token", "device_secret", "capability_token", "password", "signed_url"}

def sanitize_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitize metadata json by removing sensitive credential fields."""
    if not metadata:
        return {}
    
    sanitized = {}
    for k, v in metadata.items():
        if k.lower() in PROHIBITED_FIELDS or "secret" in k.lower() or "token" in k.lower():
            sanitized[k] = "[REDACTED]"
        else:
            sanitized[k] = v
    return sanitized

def record_audit_event(
    actor_type: str,
    event_type: str,
    shop_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    request_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
):
    """Write an immutable audit event to autoprint_v3.audit_events."""
    client = get_supabase_client()
    clean_meta = sanitize_metadata(metadata or {})
    
    audit_data = {
        "shop_id": shop_id,
        "actor_type": actor_type,
        "actor_id": actor_id,
        "event_type": event_type,
        "target_type": target_type,
        "target_id": target_id,
        "request_id": request_id,
        "metadata_json": clean_meta
    }
    
    client.table("audit_events").insert(audit_data).execute()
