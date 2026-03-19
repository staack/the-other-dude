"""
Sector management API endpoints.

Routes: /api/tenants/{tenant_id}/sites/{site_id}/sectors
        /api/tenants/{tenant_id}/devices/{device_id}/sector

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
from app.schemas.sector import SectorCreate, SectorListResponse, SectorResponse, SectorUpdate
from app.services import sector_service

router = APIRouter(tags=["sectors"])


class SectorAssignRequest(BaseModel):
    """Request body for setting or clearing a device sector assignment."""

    sector_id: uuid.UUID | None = None


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/sites/{site_id}/sectors",
    response_model=SectorListResponse,
    summary="List sectors for a site",
)
async def list_sectors(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SectorListResponse:
    """List all sectors for a site with device counts. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await sector_service.get_sectors(db=db, tenant_id=tenant_id, site_id=site_id)


@router.post(
    "/tenants/{tenant_id}/sites/{site_id}/sectors",
    response_model=SectorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a sector",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_sector(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    data: SectorCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SectorResponse:
    """Create a new sector within a site. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await sector_service.create_sector(
        db=db, tenant_id=tenant_id, site_id=site_id, data=data
    )


@router.put(
    "/tenants/{tenant_id}/sites/{site_id}/sectors/{sector_id}",
    response_model=SectorResponse,
    summary="Update a sector",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_sector(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: uuid.UUID,
    data: SectorUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SectorResponse:
    """Update a sector. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await sector_service.update_sector(
        db=db, tenant_id=tenant_id, site_id=site_id, sector_id=sector_id, data=data
    )


@router.delete(
    "/tenants/{tenant_id}/sites/{site_id}/sectors/{sector_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a sector",
    dependencies=[Depends(require_tenant_admin_or_above)],
)
async def delete_sector(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a sector. Requires tenant_admin or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await sector_service.delete_sector(
        db=db, tenant_id=tenant_id, site_id=site_id, sector_id=sector_id
    )


# ---------------------------------------------------------------------------
# Device sector assignment
# ---------------------------------------------------------------------------


@router.put(
    "/tenants/{tenant_id}/devices/{device_id}/sector",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set or clear device sector assignment",
    dependencies=[Depends(require_operator_or_above)],
)
async def set_device_sector(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: SectorAssignRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Set or clear a device's sector assignment. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    if body.sector_id is not None:
        await sector_service.assign_device_to_sector(
            db=db, tenant_id=tenant_id, device_id=device_id, sector_id=body.sector_id
        )
    else:
        await sector_service.remove_device_from_sector(
            db=db, tenant_id=tenant_id, device_id=device_id
        )
