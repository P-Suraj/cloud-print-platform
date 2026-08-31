from fastapi import Request, HTTPException, Depends
from typing import Optional, Dict, Any

from app.auth import verify_session_and_csrf

async def get_current_session(request: Request) -> Dict[str, Any]:
    """Retrieve and verify session cookie and CSRF token."""
    session_cookie = request.cookies.get("autoprint_session")
    if not session_cookie:
        # Fallback to Authorization Bearer header if cookie is missing
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_cookie = auth_header.split(" ")[1]

    if not session_cookie:
        raise HTTPException(status_code=401, detail="Unauthenticated session")

    csrf_header = request.headers.get("X-AutoPrint-CSRF")
    
    # Require CSRF check for mutating requests
    if request.method in ["POST", "PUT", "DELETE", "PATCH"]:
        if not csrf_header:
            raise HTTPException(status_code=403, detail="CSRF token missing")

    session = verify_session_and_csrf(session_cookie, csrf_header if request.method in ["POST", "PUT", "DELETE", "PATCH"] else None)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return session

def require_role(allowed_roles: list):
    async def role_dependency(session: dict = Depends(get_current_session)):
        if session.get("role") in allowed_roles:
            return session
        # Check shop membership and role
        memberships = session.get("shop_memberships", [])
        if isinstance(memberships, dict):
            memberships = [memberships]
            
        has_role = any(m.get("role") in allowed_roles for m in memberships if m.get("active"))
        if not has_role:
            raise HTTPException(status_code=403, detail="Insufficient role privileges")
        return session
    return role_dependency
