"""
JWT authentication service.

Handles password hashing, JWT token creation, token verification,
and token revocation via Redis.
"""

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import HTTPException, status
from jose import JWTError, jwt
from redis.asyncio import Redis

from app.config import settings

TOKEN_REVOCATION_PREFIX = "token_revoked:"


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt.

    DEPRECATED: Used only by password reset (temporary bcrypt hash for
    upgrade flow) and bootstrap_first_admin. Remove post-v6.0.
    """
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash.

    DEPRECATED: Used only by the one-time SRP upgrade flow (login with
    must_upgrade_auth=True) and anti-enumeration dummy calls. Remove post-v6.0.
    """
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def create_access_token(
    user_id: uuid.UUID,
    tenant_id: Optional[uuid.UUID],
    role: str,
) -> str:
    """
    Create a short-lived JWT access token.

    Claims:
        sub: user UUID (subject)
        tenant_id: tenant UUID or None for super_admin
        role: user's role string
        type: "access" (to distinguish from refresh tokens)
        exp: expiry timestamp
    """
    now = datetime.now(UTC)
    expire = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id) if tenant_id else None,
        "role": role,
        "type": "access",
        "iat": now,
        "exp": expire,
    }

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: uuid.UUID) -> str:
    """
    Create a long-lived JWT refresh token.

    Claims:
        sub: user UUID (subject)
        type: "refresh" (to distinguish from access tokens)
        exp: expiry timestamp (7 days)
    """
    now = datetime.now(UTC)
    expire = now + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)

    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "iat": now,
        "exp": expire,
    }

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def verify_token(token: str, expected_type: str = "access") -> dict:
    """
    Decode and validate a JWT token.

    Args:
        token: JWT string to validate
        expected_type: "access" or "refresh"

    Returns:
        dict: Decoded payload (sub, tenant_id, role, type, exp, iat)

    Raises:
        HTTPException 401: If token is invalid, expired, or wrong type
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise credentials_exception

    # Validate token type
    token_type = payload.get("type")
    if token_type != expected_type:
        raise credentials_exception

    # Validate subject exists
    sub = payload.get("sub")
    if not sub:
        raise credentials_exception

    return payload


async def revoke_user_tokens(redis: Redis, user_id: str) -> None:
    """Mark all tokens for a user as revoked by storing current timestamp.

    Any refresh token issued before this timestamp will be rejected.
    TTL matches maximum refresh token lifetime (7 days).
    """
    key = f"{TOKEN_REVOCATION_PREFIX}{user_id}"
    await redis.set(key, str(time.time()), ex=7 * 24 * 3600)


async def is_token_revoked(redis: Redis, user_id: str, issued_at: float) -> bool:
    """Check if a token was issued before the user's revocation timestamp.

    Returns True if the token should be rejected.
    """
    key = f"{TOKEN_REVOCATION_PREFIX}{user_id}"
    revoked_at = await redis.get(key)
    if revoked_at is None:
        return False
    return issued_at < float(revoked_at)
