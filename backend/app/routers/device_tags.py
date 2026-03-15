"""
Device tag management API endpoints.

Routes: /api/tenants/{tenant_id}/device-tags

RBAC:
- viewer: GET (read-only)
- operator: POST, PUT (write)
- tenant_admin/admin: DELETE
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import require_operator_or_above, require_tenant_admin_or_above
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.device import DeviceTagCreate, DeviceTagResponse, DeviceTagUpdate
from app.services import device as device_service

router = APIRouter(tags=["device-tags"])


@router.get(
    "/tenants/{tenant_id}/device-tags",
    response_model=list[DeviceTagResponse],
    summary="List device tags",
)
async def list_tags(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceTagResponse]:
    """List all device tags for a tenant. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await device_service.get_tags(db=db, tenant_id=tenant_id)


@router.post(
    "/tenants/{tenant_id}/device-tags",
    response_model=DeviceTagResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a device tag",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_tag(
    tenant_id: uuid.UUID,
    data: DeviceTagCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceTagResponse:
    """Create a new device tag. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await device_service.create_tag(db=db, tenant_id=tenant_id, data=data)


@router.put(
    "/tenants/{tenant_id}/device-tags/{tag_id}",
    response_model=DeviceTagResponse,
    summary="Update a device tag",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_tag(
    tenant_id: uuid.UUID,
    tag_id: uuid.UUID,
    data: DeviceTagUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceTagResponse:
    """Update a device tag. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await device_service.update_tag(db=db, tenant_id=tenant_id, tag_id=tag_id, data=data)


@router.delete(
    "/tenants/{tenant_id}/device-tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a device tag",
    dependencies=[Depends(require_tenant_admin_or_above)],
)
async def delete_tag(
    tenant_id: uuid.UUID,
    tag_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a device tag. Requires tenant_admin or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await device_service.delete_tag(db=db, tenant_id=tenant_id, tag_id=tag_id)
