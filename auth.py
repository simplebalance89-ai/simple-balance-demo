import os
from fastapi import Request, HTTPException
from jose import jwt, JWTError


async def get_current_user(request: Request) -> dict | None:
    """Extract and validate JWT from Authorization header. Returns None if no/invalid token."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        return None
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
        return {
            "id": payload.get("sub"),
            "email": payload.get("email"),
            "role": payload.get("role", "authenticated"),
        }
    except JWTError:
        return None


async def require_auth(request: Request) -> dict:
    """Same as get_current_user but raises 401 if not authenticated."""
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
