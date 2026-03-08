"""
Device group management API endpoints.

Routes: /api/tenants/{tenant_id}/device-groups

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
from app.schemas.device import DeviceGroupCreate, DeviceGroupResponse, DeviceGroupUpdate
from app.services import device as device_service

router = APIRouter(tags=["device-groups"])


@router.get(
    "/tenants/{tenant_id}/device-groups",
    response_model=list[DeviceGroupResponse],
    summary="List device groups",
)
async def list_groups(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceGroupResponse]:
    """List all device groups for a tenant. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await device_service.get_groups(db=db, tenant_id=tenant_id)


@router.post(
    "/tenants/{tenant_id}/device-groups",
    response_model=DeviceGroupResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a device group",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_group(
    tenant_id: uuid.UUID,
    data: DeviceGroupCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceGroupResponse:
    """Create a new device group. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await device_service.create_group(db=db, tenant_id=tenant_id, data=data)


@router.put(
    "/tenants/{tenant_id}/device-groups/{group_id}",
    response_model=DeviceGroupResponse,
    summary="Update a device group",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_group(
    tenant_id: uuid.UUID,
    group_id: uuid.UUID,
    data: DeviceGroupUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceGroupResponse:
    """Update a device group. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await device_service.update_group(
        db=db, tenant_id=tenant_id, group_id=group_id, data=data
    )


@router.delete(
    "/tenants/{tenant_id}/device-groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a device group",
    dependencies=[Depends(require_tenant_admin_or_above)],
)
async def delete_group(
    tenant_id: uuid.UUID,
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a device group. Requires tenant_admin or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await device_service.delete_group(db=db, tenant_id=tenant_id, group_id=group_id)
