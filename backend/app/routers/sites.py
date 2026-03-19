"""
Site management API endpoints.

Routes: /api/tenants/{tenant_id}/sites

RBAC:
- viewer: GET (read-only)
- operator: POST, PUT, device assignment (write)
- tenant_admin/admin: DELETE
"""

import uuid

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import require_operator_or_above, require_tenant_admin_or_above
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.site import SiteCreate, SiteListResponse, SiteResponse, SiteUpdate
from app.services import site_service

router = APIRouter(tags=["sites"])


class BulkAssignRequest(BaseModel):
    """Request body for bulk device assignment."""

    device_ids: list[uuid.UUID]


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/sites",
    response_model=SiteListResponse,
    summary="List sites",
)
async def list_sites(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteListResponse:
    """List all sites for a tenant with health rollup. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await site_service.get_sites(db=db, tenant_id=tenant_id)


@router.get(
    "/tenants/{tenant_id}/sites/{site_id}",
    response_model=SiteResponse,
    summary="Get site details",
)
async def get_site(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteResponse:
    """Get a single site with health rollup. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await site_service.get_site(db=db, tenant_id=tenant_id, site_id=site_id)


@router.post(
    "/tenants/{tenant_id}/sites",
    response_model=SiteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a site",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_site(
    tenant_id: uuid.UUID,
    data: SiteCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteResponse:
    """Create a new site. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await site_service.create_site(
        db=db, tenant_id=tenant_id, data=data, user_id=current_user.id
    )


@router.put(
    "/tenants/{tenant_id}/sites/{site_id}",
    response_model=SiteResponse,
    summary="Update a site",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_site(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    data: SiteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteResponse:
    """Update a site. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await site_service.update_site(
        db=db, tenant_id=tenant_id, site_id=site_id, data=data, user_id=current_user.id
    )


@router.delete(
    "/tenants/{tenant_id}/sites/{site_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a site",
    dependencies=[Depends(require_tenant_admin_or_above)],
)
async def delete_site(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a site. Requires tenant_admin or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await site_service.delete_site(
        db=db, tenant_id=tenant_id, site_id=site_id, user_id=current_user.id
    )


# ---------------------------------------------------------------------------
# Device assignment
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/sites/{site_id}/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Assign device to site",
    dependencies=[Depends(require_operator_or_above)],
)
async def assign_device(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Assign a single device to a site. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await site_service.assign_device_to_site(
        db=db, tenant_id=tenant_id, site_id=site_id, device_id=device_id
    )


@router.delete(
    "/tenants/{tenant_id}/sites/{site_id}/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove device from site",
    dependencies=[Depends(require_operator_or_above)],
)
async def unassign_device(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a device from a site. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await site_service.remove_device_from_site(db=db, tenant_id=tenant_id, device_id=device_id)


@router.post(
    "/tenants/{tenant_id}/sites/{site_id}/devices/bulk-assign",
    summary="Bulk assign devices to site",
    dependencies=[Depends(require_operator_or_above)],
)
async def bulk_assign_devices(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    body: BulkAssignRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Bulk-assign multiple devices to a site. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    count = await site_service.bulk_assign_devices_to_site(
        db=db, tenant_id=tenant_id, site_id=site_id, device_ids=body.device_ids
    )
    return {"assigned": count}
