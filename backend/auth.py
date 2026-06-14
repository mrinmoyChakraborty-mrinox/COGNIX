import asyncio
import logging
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("cognix.auth")
security = HTTPBearer(auto_error=False)

USE_MOCK = os.getenv("USE_MOCK_DATA", "").lower() in ("true", "1", "yes")

_supabase = None


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


def _verify_token(token: str) -> str:
    client = _get_client()
    user = client.auth.get_user(token)
    return user.user.id


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    if USE_MOCK:
        return "mock_user"

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    try:
        user_id = await asyncio.to_thread(_verify_token, credentials.credentials)
        return user_id
    except Exception as exc:
        logger.warning("Auth failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
