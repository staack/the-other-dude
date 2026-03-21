"""
Credential profile management API endpoints.

Routes: /api/tenants/{tenant_id}/credential-profiles

RBAC:
- viewer: GET (read-only, via require_scope)
- operator: POST, PUT (write)
- tenant_admin/admin: DELETE
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import (
    require_operator_or_above,
    require_scope,
    require_tenant_admin_or_above,
)
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.credential_profile import (
    CredentialProfileCreate,
    CredentialProfileListResponse,
    CredentialProfileResponse,
    CredentialProfileUpdate,
)
from app.services import credential_profile_service

router = APIRouter(tags=["credential-profiles"])


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/credential-profiles",
    response_model=CredentialProfileListResponse,
    summary="List credential profiles",
    dependencies=[require_scope("devices:read")],
)
async def list_profiles(
    tenant_id: uuid.UUID,
    credential_type: Optional[str] = Query(None, description="Filter by credential type"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CredentialProfileListResponse:
    """List all credential profiles for a tenant. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await credential_profile_service.get_profiles(
        db=db, tenant_id=tenant_id, credential_type=credential_type
    )


@router.post(
    "/tenants/{tenant_id}/credential-profiles",
    response_model=CredentialProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a credential profile",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_profile(
    tenant_id: uuid.UUID,
    data: CredentialProfileCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CredentialProfileResponse:
    """Create a new credential profile. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await credential_profile_service.create_profile(
        db=db, tenant_id=tenant_id, data=data, user_id=current_user.user_id
    )


@router.get(
    "/tenants/{tenant_id}/credential-profiles/{profile_id}",
    response_model=CredentialProfileResponse,
    summary="Get credential profile details",
    dependencies=[require_scope("devices:read")],
)
async def get_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CredentialProfileResponse:
    """Get a single credential profile. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await credential_profile_service.get_profile(
        db=db, tenant_id=tenant_id, profile_id=profile_id
    )


@router.put(
    "/tenants/{tenant_id}/credential-profiles/{profile_id}",
    response_model=CredentialProfileResponse,
    summary="Update a credential profile",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    data: CredentialProfileUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CredentialProfileResponse:
    """Update a credential profile. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await credential_profile_service.update_profile(
        db=db, tenant_id=tenant_id, profile_id=profile_id, data=data,
        user_id=current_user.user_id,
    )


@router.delete(
    "/tenants/{tenant_id}/credential-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a credential profile",
    dependencies=[Depends(require_tenant_admin_or_above)],
)
async def delete_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a credential profile. Requires tenant_admin or above.

    Returns HTTP 409 if devices still reference this profile.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    await credential_profile_service.delete_profile(
        db=db, tenant_id=tenant_id, profile_id=profile_id,
        user_id=current_user.user_id,
    )


@router.get(
    "/tenants/{tenant_id}/credential-profiles/{profile_id}/devices",
    summary="List devices using this credential profile",
    dependencies=[require_scope("devices:read")],
)
async def list_profile_devices(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List devices assigned to a credential profile. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await credential_profile_service.get_profile_devices(
        db=db, tenant_id=tenant_id, profile_id=profile_id
    )
