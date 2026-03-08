"""API key management endpoints.

Tenant-scoped routes under /api/tenants/{tenant_id}/api-keys:
- List all keys (active + revoked)
- Create new key (returns plaintext once)
- Revoke key (soft delete)

RBAC: tenant_admin or above for all operations.
RLS enforced via get_db() (app_user engine with tenant context).
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.rbac import require_min_role
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.services.api_key_service import (
    ALLOWED_SCOPES,
    create_api_key,
    list_api_keys,
    revoke_api_key,
)

router = APIRouter(tags=["api-keys"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    if current_user.is_super_admin:
        await set_tenant_context(db, str(tenant_id))
    elif current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant",
        )


# ---------------------------------------------------------------------------
# Request/response schemas
# ---------------------------------------------------------------------------


class ApiKeyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    scopes: list[str]
    expires_at: Optional[datetime] = None


class ApiKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    key_prefix: str
    scopes: list[str]
    expires_at: Optional[str] = None
    last_used_at: Optional[str] = None
    created_at: str
    revoked_at: Optional[str] = None


class ApiKeyCreateResponse(ApiKeyResponse):
    """Extended response that includes the plaintext key (shown once)."""

    key: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/tenants/{tenant_id}/api-keys", response_model=list[ApiKeyResponse])
async def list_keys(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
) -> list[dict]:
    """List all API keys for a tenant."""
    await _check_tenant_access(current_user, tenant_id, db)
    keys = await list_api_keys(db, tenant_id)
    # Convert UUID ids to strings for response
    for k in keys:
        k["id"] = str(k["id"])
    return keys


@router.post(
    "/tenants/{tenant_id}/api-keys",
    response_model=ApiKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_key(
    tenant_id: uuid.UUID,
    body: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
) -> dict:
    """Create a new API key. The plaintext key is returned only once."""
    await _check_tenant_access(current_user, tenant_id, db)

    # Validate scopes against allowed list
    invalid_scopes = set(body.scopes) - ALLOWED_SCOPES
    if invalid_scopes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scopes: {', '.join(sorted(invalid_scopes))}. "
            f"Allowed: {', '.join(sorted(ALLOWED_SCOPES))}",
        )

    if not body.scopes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one scope is required.",
        )

    result = await create_api_key(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.user_id,
        name=body.name,
        scopes=body.scopes,
        expires_at=body.expires_at,
    )

    return {
        "id": str(result["id"]),
        "name": result["name"],
        "key_prefix": result["key_prefix"],
        "key": result["key"],
        "scopes": result["scopes"],
        "expires_at": result["expires_at"].isoformat() if result["expires_at"] else None,
        "last_used_at": None,
        "created_at": result["created_at"].isoformat() if result["created_at"] else None,
        "revoked_at": None,
    }


@router.delete("/tenants/{tenant_id}/api-keys/{key_id}", status_code=status.HTTP_200_OK)
async def revoke_key(
    tenant_id: uuid.UUID,
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
) -> dict:
    """Revoke an API key (soft delete -- sets revoked_at timestamp)."""
    await _check_tenant_access(current_user, tenant_id, db)

    success = await revoke_api_key(db, tenant_id, key_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found or already revoked.",
        )

    return {"status": "revoked", "key_id": str(key_id)}
