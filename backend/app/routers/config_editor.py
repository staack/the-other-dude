"""
Dynamic RouterOS config editor API endpoints.

All routes are tenant-scoped under:
    /api/tenants/{tenant_id}/devices/{device_id}/config-editor/

Proxies commands to the Go poller's CmdResponder via the RouterOS proxy service.

Provides:
    - GET  /browse   -- browse a RouterOS menu path
    - POST /add      -- add a new entry
    - POST /set      -- edit an existing entry
    - POST /remove   -- delete an entry
    - POST /execute  -- execute an arbitrary CLI command

RLS is enforced via get_db() (app_user engine with tenant context).
RBAC: viewer = read-only (GET browse); operator and above = write (POST).
"""

import uuid

import structlog

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rate_limit import limiter
from app.middleware.rbac import require_min_role, require_scope
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.device import Device
from app.security.command_blocklist import check_command_safety, check_path_safety
from app.services import routeros_proxy
from app.services.audit_service import log_action

logger = structlog.get_logger(__name__)
audit_logger = structlog.get_logger("audit")

router = APIRouter(tags=["config-editor"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    from app.database import set_tenant_context

    if current_user.is_super_admin:
        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )
    # Set RLS context for regular users too
    await set_tenant_context(db, str(tenant_id))


async def _check_device_online(
    db: AsyncSession, device_id: uuid.UUID
) -> Device:
    """Verify the device exists and is online. Returns the Device object."""
    result = await db.execute(
        select(Device).where(Device.id == device_id)  # type: ignore[arg-type]
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found",
        )
    if device.status != "online":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device is offline \u2014 config editor requires a live connection.",
        )
    return device


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class AddEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    properties: dict[str, str]


class SetEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    entry_id: str | None = None  # Optional for singleton paths (e.g. /ip/dns)
    properties: dict[str, str]


class RemoveEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    entry_id: str


class ExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/config-editor/browse",
    summary="Browse a RouterOS menu path",
    dependencies=[require_scope("config:read")],
)
async def browse_menu(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    path: str = Query("/interface", description="RouterOS menu path to browse"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Browse a RouterOS menu path and return all entries at that path."""
    await _check_tenant_access(current_user, tenant_id, db)
    await _check_device_online(db, device_id)
    check_path_safety(path)

    result = await routeros_proxy.browse_menu(str(device_id), path)

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=result.get("error", "Failed to browse menu path"),
        )

    audit_logger.info(
        "routeros_config_browsed",
        device_id=str(device_id),
        tenant_id=str(tenant_id),
        user_id=str(current_user.user_id),
        path=path,
    )

    return {
        "success": True,
        "entries": result.get("data", []),
        "error": None,
        "path": path,
    }


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config-editor/add",
    summary="Add a new entry to a RouterOS menu path",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("20/minute")
async def add_entry(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: AddEntryRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Add a new entry to a RouterOS menu path with the given properties."""
    await _check_tenant_access(current_user, tenant_id, db)
    await _check_device_online(db, device_id)
    check_path_safety(body.path, write=True)

    result = await routeros_proxy.add_entry(str(device_id), body.path, body.properties)

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=result.get("error", "Failed to add entry"),
        )

    audit_logger.info(
        "routeros_config_added",
        device_id=str(device_id),
        tenant_id=str(tenant_id),
        user_id=str(current_user.user_id),
        user_role=current_user.role,
        path=body.path,
        success=result.get("success", False),
    )

    try:
        await log_action(
            db, tenant_id, current_user.user_id, "config_add",
            resource_type="config", resource_id=str(device_id),
            device_id=device_id,
            details={"path": body.path, "properties": body.properties},
        )
    except Exception:
        pass

    return result


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config-editor/set",
    summary="Edit an existing entry in a RouterOS menu path",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("20/minute")
async def set_entry(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: SetEntryRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update an existing entry's properties on the device."""
    await _check_tenant_access(current_user, tenant_id, db)
    await _check_device_online(db, device_id)
    check_path_safety(body.path, write=True)

    result = await routeros_proxy.update_entry(
        str(device_id), body.path, body.entry_id, body.properties
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=result.get("error", "Failed to update entry"),
        )

    audit_logger.info(
        "routeros_config_modified",
        device_id=str(device_id),
        tenant_id=str(tenant_id),
        user_id=str(current_user.user_id),
        user_role=current_user.role,
        path=body.path,
        entry_id=body.entry_id,
        success=result.get("success", False),
    )

    try:
        await log_action(
            db, tenant_id, current_user.user_id, "config_set",
            resource_type="config", resource_id=str(device_id),
            device_id=device_id,
            details={"path": body.path, "entry_id": body.entry_id, "properties": body.properties},
        )
    except Exception:
        pass

    return result


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config-editor/remove",
    summary="Delete an entry from a RouterOS menu path",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("5/minute")
async def remove_entry(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: RemoveEntryRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Remove an entry from a RouterOS menu path."""
    await _check_tenant_access(current_user, tenant_id, db)
    await _check_device_online(db, device_id)
    check_path_safety(body.path, write=True)

    result = await routeros_proxy.remove_entry(
        str(device_id), body.path, body.entry_id
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=result.get("error", "Failed to remove entry"),
        )

    audit_logger.info(
        "routeros_config_removed",
        device_id=str(device_id),
        tenant_id=str(tenant_id),
        user_id=str(current_user.user_id),
        user_role=current_user.role,
        path=body.path,
        entry_id=body.entry_id,
        success=result.get("success", False),
    )

    try:
        await log_action(
            db, tenant_id, current_user.user_id, "config_remove",
            resource_type="config", resource_id=str(device_id),
            device_id=device_id,
            details={"path": body.path, "entry_id": body.entry_id},
        )
    except Exception:
        pass

    return result


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config-editor/execute",
    summary="Execute an arbitrary RouterOS CLI command",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("20/minute")
async def execute_command(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: ExecuteRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Execute an arbitrary RouterOS CLI command on the device."""
    await _check_tenant_access(current_user, tenant_id, db)
    await _check_device_online(db, device_id)
    check_command_safety(body.command)

    result = await routeros_proxy.execute_cli(str(device_id), body.command)

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=result.get("error", "Failed to execute command"),
        )

    audit_logger.info(
        "routeros_command_executed",
        device_id=str(device_id),
        tenant_id=str(tenant_id),
        user_id=str(current_user.user_id),
        user_role=current_user.role,
        command=body.command,
        success=result.get("success", False),
    )

    try:
        await log_action(
            db, tenant_id, current_user.user_id, "config_execute",
            resource_type="config", resource_id=str(device_id),
            device_id=device_id,
            details={"command": body.command},
        )
    except Exception:
        pass

    return result
