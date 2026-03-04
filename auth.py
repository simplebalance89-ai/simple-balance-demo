import os
import time
import httpx
from fastapi import Request, HTTPException
from jose import jwt, JWTError

# Cache the JWKS with a 1-hour TTL so key rotations are picked up
_jwks_cache = None
_jwks_cache_time = 0.0
_JWKS_TTL = 3600  # seconds


async def _get_jwks() -> dict | None:
    """Fetch JWKS from Supabase for ES256 token validation (cached with TTL)."""
    global _jwks_cache, _jwks_cache_time
    if _jwks_cache and (time.time() - _jwks_cache_time) < _JWKS_TTL:
        return _jwks_cache
    supabase_url = os.environ.get("SUPABASE_URL")
    if not supabase_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{supabase_url}/auth/v1/.well-known/jwks.json")
            if resp.status_code == 200:
                _jwks_cache = resp.json()
                _jwks_cache_time = time.time()
                return _jwks_cache
    except Exception:
        pass
    return None


async def get_current_user(request: Request) -> dict | None:
    """Extract and validate JWT from Authorization header. Returns None if no/invalid token."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]

    # Try ES256 via JWKS first (newer Supabase projects)
    jwks = await _get_jwks()
    if jwks:
        try:
            payload = jwt.decode(token, jwks, algorithms=["ES256"], audience="authenticated")
            return {
                "id": payload.get("sub"),
                "email": payload.get("email"),
                "role": payload.get("role", "authenticated"),
            }
        except JWTError:
            pass

    # Fall back to HS256 with shared secret (older Supabase projects)
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if secret:
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
            return {
                "id": payload.get("sub"),
                "email": payload.get("email"),
                "role": payload.get("role", "authenticated"),
            }
        except JWTError:
            pass

    return None


async def require_auth(request: Request) -> dict:
    """Same as get_current_user but raises 401 if not authenticated."""
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
