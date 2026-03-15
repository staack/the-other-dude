"""
Tenant context middleware and current user dependency.

Extracts JWT from Authorization header (Bearer token) or httpOnly cookie,
validates it, and provides current user context for request handlers.

For tenant-scoped users: sets SET LOCAL app.current_tenant on the DB session.
For super_admin: uses special 'super_admin' context that grants cross-tenant access.
"""

import uuid
from typing import Annotated, Optional

from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.services.auth import verify_token

# Optional HTTP Bearer scheme (won't raise 403 automatically — we handle auth ourselves)
bearer_scheme = HTTPBearer(auto_error=False)


class CurrentUser:
    """Represents the currently authenticated user extracted from JWT or API key."""

    def __init__(
        self,
        user_id: uuid.UUID,
        tenant_id: Optional[uuid.UUID],
        role: str,
        scopes: Optional[list[str]] = None,
    ) -> None:
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.role = role
        self.scopes = scopes

    @property
    def is_super_admin(self) -> bool:
        return self.role == "super_admin"

    @property
    def is_api_key(self) -> bool:
        return self.role == "api_key"

    def __repr__(self) -> str:
        return f"<CurrentUser user_id={self.user_id} role={self.role} tenant_id={self.tenant_id}>"


def _extract_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials],
    access_token: Optional[str],
) -> Optional[str]:
    """
    Extract JWT token from Authorization header or httpOnly cookie.

    Priority: Authorization header > cookie.
    """
    if credentials and credentials.scheme.lower() == "bearer":
        return credentials.credentials

    if access_token:
        return access_token

    return None


async def get_current_user(
    request: Request,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)] = None,
    access_token: Annotated[Optional[str], Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """
    FastAPI dependency that extracts and validates the current user from JWT.

    Supports both Bearer token (Authorization header) and httpOnly cookie.
    Sets the tenant context on the database session for RLS enforcement.

    Raises:
        HTTPException 401: If no token provided or token is invalid
    """
    token = _extract_token(request, credentials, access_token)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # API key authentication: detect mktp_ prefix and validate via api_key_service
    if token.startswith("mktp_"):
        from app.services.api_key_service import validate_api_key

        key_data = await validate_api_key(token)
        if not key_data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid, expired, or revoked API key",
                headers={"WWW-Authenticate": "Bearer"},
            )

        tenant_id = key_data["tenant_id"]
        # Set tenant context on the request-scoped DB session for RLS
        await set_tenant_context(db, str(tenant_id))

        return CurrentUser(
            user_id=key_data["user_id"],
            tenant_id=tenant_id,
            role="api_key",
            scopes=key_data["scopes"],
        )

    # Decode and validate the JWT
    payload = verify_token(token, expected_type="access")

    user_id_str = payload.get("sub")
    tenant_id_str = payload.get("tenant_id")
    role = payload.get("role")

    if not user_id_str or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    tenant_id: Optional[uuid.UUID] = None
    if tenant_id_str:
        try:
            tenant_id = uuid.UUID(tenant_id_str)
        except ValueError:
            pass

    # Set the tenant context on the database session for RLS enforcement
    if role == "super_admin":
        # super_admin uses special context that grants cross-tenant access
        await set_tenant_context(db, "super_admin")
    elif tenant_id:
        await set_tenant_context(db, str(tenant_id))
    else:
        # Non-super_admin without tenant — deny access
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: no tenant context",
        )

    return CurrentUser(
        user_id=user_id,
        tenant_id=tenant_id,
        role=role,
    )


async def get_current_user_ws(
    websocket: "WebSocket",
) -> CurrentUser:
    """
    WebSocket authentication helper.

    Extracts JWT from the ``access_token`` cookie or ``token`` query parameter,
    decodes it, and returns a :class:`CurrentUser`.  Unlike :func:`get_current_user`
    this does **not** touch the database (no RLS tenant context) because WebSocket
    handlers typically manage their own DB sessions.

    Raises:
        WebSocketException 1008: If no token is provided or the token is invalid.
    """
    from fastapi import WebSocketException

    # 1. Try cookie
    token: Optional[str] = websocket.cookies.get("access_token")

    # 2. Fall back to query param
    if not token:
        token = websocket.query_params.get("token")

    if not token:
        raise WebSocketException(code=1008, reason="Not authenticated")

    try:
        payload = verify_token(token, expected_type="access")
    except HTTPException:
        raise WebSocketException(code=1008, reason="Invalid or expired token")

    user_id_str = payload.get("sub")
    tenant_id_str = payload.get("tenant_id")
    role = payload.get("role")

    if not user_id_str or not role:
        raise WebSocketException(code=1008, reason="Invalid token payload")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise WebSocketException(code=1008, reason="Invalid token payload")

    tenant_id: Optional[uuid.UUID] = None
    if tenant_id_str:
        try:
            tenant_id = uuid.UUID(tenant_id_str)
        except ValueError:
            pass

    if role != "super_admin" and tenant_id is None:
        raise WebSocketException(code=1008, reason="Invalid token: no tenant context")

    return CurrentUser(
        user_id=user_id,
        tenant_id=tenant_id,
        role=role,
    )


async def get_optional_current_user(
    request: Request,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)] = None,
    access_token: Annotated[Optional[str], Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> Optional[CurrentUser]:
    """Same as get_current_user but returns None instead of raising 401."""
    try:
        return await get_current_user(request, credentials, access_token, db)
    except HTTPException:
        return None
