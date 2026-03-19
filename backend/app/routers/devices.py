"""
Device management API endpoints.

All routes are tenant-scoped under /api/tenants/{tenant_id}/devices.
RLS is enforced via PostgreSQL — the app_user engine automatically filters
cross-tenant data based on the SET LOCAL app.current_tenant context set by
get_current_user dependency.

RBAC:
- viewer: GET (read-only)
- operator: POST, PUT (write)
- admin/tenant_admin: DELETE
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.rate_limit import limiter
from app.services.audit_service import log_action
from app.middleware.rbac import (
    require_operator_or_above,
    require_scope,
    require_tenant_admin_or_above,
)
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.schemas.device import (
    BulkAddRequest,
    BulkAddResult,
    DeviceCreate,
    DeviceListResponse,
    DeviceResponse,
    DeviceUpdate,
    SubnetScanRequest,
    SubnetScanResponse,
)
from app.services import device as device_service
from app.services.scanner import scan_subnet

router = APIRouter(tags=["devices"])


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """
    Verify the current user is allowed to access the given tenant.

    - super_admin can access any tenant — re-sets DB tenant context to target tenant.
    - All other roles must match their own tenant_id.
    """
    if current_user.is_super_admin:
        # Re-set tenant context to the target tenant so RLS allows the operation
        from app.database import set_tenant_context

        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


# ---------------------------------------------------------------------------
# Device CRUD
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices",
    response_model=DeviceListResponse,
    summary="List devices with pagination and filtering",
    dependencies=[require_scope("devices:read")],
)
async def list_devices(
    tenant_id: uuid.UUID,
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(25, ge=1, le=100, description="Items per page (1-100)"),
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None, description="Text search on hostname or IP"),
    tag_id: Optional[uuid.UUID] = Query(None),
    group_id: Optional[uuid.UUID] = Query(None),
    sort_by: str = Query("created_at", description="Field to sort by"),
    sort_order: str = Query("desc", description="asc or desc"),
    site_id: Optional[uuid.UUID] = Query(None, description="Filter by site"),
    sector_id: Optional[uuid.UUID] = Query(None, description="Filter by sector"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceListResponse:
    """List devices for a tenant with optional pagination, filtering, and sorting."""
    await _check_tenant_access(current_user, tenant_id, db)

    items, total = await device_service.get_devices(
        db=db,
        tenant_id=tenant_id,
        page=page,
        page_size=page_size,
        status=status_filter,
        search=search,
        tag_id=tag_id,
        group_id=group_id,
        sort_by=sort_by,
        sort_order=sort_order,
        site_id=site_id,
        sector_id=sector_id,
    )
    return DeviceListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post(
    "/tenants/{tenant_id}/devices",
    response_model=DeviceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a device (validates TCP connectivity first)",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("20/minute")
async def create_device(
    request: Request,
    tenant_id: uuid.UUID,
    data: DeviceCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceResponse:
    """
    Create a new device. Requires operator role or above.

    The device IP/port is TCP-probed before the record is saved.
    Credentials are encrypted with AES-256-GCM before storage and never returned.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    result = await device_service.create_device(
        db=db,
        tenant_id=tenant_id,
        data=data,
        encryption_key=settings.get_encryption_key_bytes(),
    )
    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "device_create",
            resource_type="device",
            resource_id=str(result.id),
            details={"hostname": data.hostname, "ip_address": data.ip_address},
            ip_address=request.client.host if request.client else None,
        )
    except Exception:
        pass
    return result


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}",
    response_model=DeviceResponse,
    summary="Get a single device",
    dependencies=[require_scope("devices:read")],
)
async def get_device(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceResponse:
    """Get device details. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await device_service.get_device(db=db, tenant_id=tenant_id, device_id=device_id)


@router.put(
    "/tenants/{tenant_id}/devices/{device_id}",
    response_model=DeviceResponse,
    summary="Update a device",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("20/minute")
async def update_device(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    data: DeviceUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceResponse:
    """Update device fields. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    result = await device_service.update_device(
        db=db,
        tenant_id=tenant_id,
        device_id=device_id,
        data=data,
        encryption_key=settings.get_encryption_key_bytes(),
    )
    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "device_update",
            resource_type="device",
            resource_id=str(device_id),
            device_id=device_id,
            details={"changes": data.model_dump(exclude_unset=True)},
            ip_address=request.client.host if request.client else None,
        )
    except Exception:
        pass
    return result


@router.delete(
    "/tenants/{tenant_id}/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a device",
    dependencies=[Depends(require_tenant_admin_or_above), require_scope("devices:write")],
)
@limiter.limit("5/minute")
async def delete_device(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Hard-delete a device. Requires tenant_admin or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "device_delete",
            resource_type="device",
            resource_id=str(device_id),
            device_id=device_id,
            ip_address=request.client.host if request.client else None,
        )
    except Exception:
        pass
    await device_service.delete_device(db=db, tenant_id=tenant_id, device_id=device_id)


# ---------------------------------------------------------------------------
# Subnet scan and bulk add
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/devices/scan",
    response_model=SubnetScanResponse,
    summary="Scan a subnet for MikroTik devices",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("5/minute")
async def scan_devices(
    request: Request,
    tenant_id: uuid.UUID,
    data: SubnetScanRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubnetScanResponse:
    """
    Scan a CIDR subnet for hosts with open RouterOS API ports (8728/8729).

    Returns a list of discovered IPs for the user to review and selectively
    import — does NOT automatically add devices.

    Requires operator role or above.
    """
    if not current_user.is_super_admin and current_user.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    discovered = await scan_subnet(data.cidr)
    import ipaddress

    network = ipaddress.ip_network(data.cidr, strict=False)
    total_scanned = (
        network.num_addresses - 2 if network.num_addresses > 2 else network.num_addresses
    )

    # Audit log the scan (fire-and-forget — never breaks the response)
    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "subnet_scan",
            resource_type="network",
            resource_id=data.cidr,
            details={
                "cidr": data.cidr,
                "devices_found": len(discovered),
                "ip": request.client.host if request.client else None,
            },
            ip_address=request.client.host if request.client else None,
        )
    except Exception:
        pass

    return SubnetScanResponse(
        cidr=data.cidr,
        discovered=discovered,
        total_scanned=total_scanned,
        total_discovered=len(discovered),
    )


@router.post(
    "/tenants/{tenant_id}/devices/bulk-add",
    response_model=BulkAddResult,
    status_code=status.HTTP_201_CREATED,
    summary="Bulk-add devices from scan results",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("5/minute")
async def bulk_add_devices(
    request: Request,
    tenant_id: uuid.UUID,
    data: BulkAddRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BulkAddResult:
    """
    Add multiple devices at once from scan results.

    Per-device credentials take precedence over shared credentials.
    Devices that fail connectivity checks or validation are reported in `failed`.
    Requires operator role or above.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    added = []
    failed = []
    encryption_key = settings.get_encryption_key_bytes()

    for dev_data in data.devices:
        # Resolve credentials: per-device first, then shared
        username = dev_data.username or data.shared_username
        password = dev_data.password or data.shared_password

        if not username or not password:
            failed.append(
                {
                    "ip_address": dev_data.ip_address,
                    "error": "No credentials provided (set per-device or shared credentials)",
                }
            )
            continue

        create_data = DeviceCreate(
            hostname=dev_data.hostname or dev_data.ip_address,
            ip_address=dev_data.ip_address,
            api_port=dev_data.api_port,
            api_ssl_port=dev_data.api_ssl_port,
            username=username,
            password=password,
        )

        try:
            device = await device_service.create_device(
                db=db,
                tenant_id=tenant_id,
                data=create_data,
                encryption_key=encryption_key,
            )
            added.append(device)
            try:
                await log_action(
                    db,
                    tenant_id,
                    current_user.user_id,
                    "device_adopt",
                    resource_type="device",
                    resource_id=str(device.id),
                    details={
                        "hostname": create_data.hostname,
                        "ip_address": create_data.ip_address,
                    },
                    ip_address=request.client.host if request.client else None,
                )
            except Exception:
                pass
        except HTTPException as exc:
            failed.append({"ip_address": dev_data.ip_address, "error": exc.detail})
        except Exception as exc:
            failed.append({"ip_address": dev_data.ip_address, "error": str(exc)})

    return BulkAddResult(added=added, failed=failed)


# ---------------------------------------------------------------------------
# Group assignment
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Add device to a group",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("20/minute")
async def add_device_to_group(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Assign a device to a group. Requires operator or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await device_service.assign_device_to_group(db, tenant_id, device_id, group_id)


@router.delete(
    "/tenants/{tenant_id}/devices/{device_id}/groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove device from a group",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("5/minute")
async def remove_device_from_group(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a device from a group. Requires operator or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await device_service.remove_device_from_group(db, tenant_id, device_id, group_id)


# ---------------------------------------------------------------------------
# Tag assignment
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Add tag to a device",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("20/minute")
async def add_tag_to_device(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tag_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Assign a tag to a device. Requires operator or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await device_service.assign_tag_to_device(db, tenant_id, device_id, tag_id)


@router.delete(
    "/tenants/{tenant_id}/devices/{device_id}/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove tag from a device",
    dependencies=[Depends(require_operator_or_above), require_scope("devices:write")],
)
@limiter.limit("5/minute")
async def remove_tag_from_device(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tag_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a tag from a device. Requires operator or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    await device_service.remove_tag_from_device(db, tenant_id, device_id, tag_id)
