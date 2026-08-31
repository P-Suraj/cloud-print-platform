from fastapi import HTTPException
from typing import Dict, Any

def get_session_shop_id(session: Dict[str, Any]) -> str:
    """Extract authenticated shop_id from user session memberships."""
    if session.get("shop_id"):
        return session["shop_id"]
    memberships = session.get("shop_memberships", [])
    if isinstance(memberships, dict):
        memberships = [memberships]

    active_memberships = [m for m in memberships if m.get("active")]
    if not active_memberships:
        raise HTTPException(status_code=403, detail="User has no active shop membership")

    return active_memberships[0]["shop_id"]
