import asyncio
import logging
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("cognix.auth")
security = HTTPBearer(auto_error=False)

USE_MOCK = os.getenv("USE_MOCK_DATA", "").lower() in ("true", "1", "yes")

_supabase = None


def get_supabase_client():
    global _supabase
    if _supabase is None:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
        _supabase = create_client(url, key)
    return _supabase


def _get_client():
    global _supabase
    if _supabase is None:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
        _supabase = create_client(url, key)
    return _supabase


def _verify_token(token: str) -> dict:
    client = _get_client()
    user = client.auth.get_user(token)
    user_id = user.user.id
    email = user.user.email or ""

    role = _get_user_role(user_id, client)
    return {"user_id": user_id, "email": email, "role": role}


def _get_user_role(user_id: str, client=None) -> str:
    if client is None:
        client = _get_client()
    try:
        rows = (
            client.table("user_roles")
            .select("role")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if rows.data and len(rows.data) > 0:
            return rows.data[0]["role"]
    except Exception:
        logger.warning(
            "Could not query user_roles for %s, defaulting to customer", user_id
        )
    return "customer"


async def verify_ws_token(token: str | None) -> dict | None:
    if USE_MOCK:
        return {"user_id": "mock_user", "role": "admin"}
    if not token:
        return None
    try:
        result = await asyncio.to_thread(_verify_token, token)
        if result["role"] != "admin":
            return None
        return result
    except Exception:
        return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if USE_MOCK:
        return {"user_id": "mock_user", "role": "admin"}

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    try:
        return await asyncio.to_thread(_verify_token, credentials.credentials)
    except Exception as exc:
        logger.warning("Auth failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
