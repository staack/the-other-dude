"""
Device syslog fetch endpoint via NATS RouterOS proxy.

Provides:
    - GET /tenants/{tenant_id}/devices/{device_id}/logs  -- fetch device log entries

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: viewer and above can read logs.
"""

import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import require_min_role
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.services import routeros_proxy

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["device-logs"])


# ---------------------------------------------------------------------------
# Helpers (same pattern as config_editor.py)
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    if current_user.is_super_admin:
        from app.database import set_tenant_context

        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


async def _check_device_exists(db: AsyncSession, device_id: uuid.UUID) -> None:
    """Verify the device exists (does not require online status for logs)."""
    from sqlalchemy import select
    from app.models.device import Device

    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found",
        )


# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------


class LogEntry(BaseModel):
    time: str
    topics: str
    message: str


class LogsResponse(BaseModel):
    logs: list[LogEntry]
    device_id: str
    count: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/logs",
    response_model=LogsResponse,
    summary="Fetch device syslog entries via RouterOS API",
    dependencies=[Depends(require_min_role("viewer"))],
)
async def get_device_logs(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    topic: str | None = Query(default=None, description="Filter by log topic"),
    search: str | None = Query(default=None, description="Search in message/topics"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LogsResponse:
    """Fetch device log entries via the RouterOS /log/print command."""
    await _check_tenant_access(current_user, tenant_id, db)
    await _check_device_exists(db, device_id)

    # Build RouterOS command args
    args = [f"=count={limit}"]
    if topic:
        args.append(f"?topics={topic}")

    result = await routeros_proxy.execute_command(
        str(device_id), "/log/print", args=args, timeout=15.0
    )

    if not result.get("success"):
        error_msg = result.get("error", "Unknown error fetching logs")
        logger.warning(
            "failed to fetch device logs",
            device_id=str(device_id),
            error=error_msg,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch device logs: {error_msg}",
        )

    # Parse log entries from RouterOS response
    raw_entries = result.get("data", [])
    logs: list[LogEntry] = []
    for entry in raw_entries:
        log_entry = LogEntry(
            time=entry.get("time", ""),
            topics=entry.get("topics", ""),
            message=entry.get("message", ""),
        )

        # Apply search filter (case-insensitive) if provided
        if search:
            search_lower = search.lower()
            if (
                search_lower not in log_entry.message.lower()
                and search_lower not in log_entry.topics.lower()
            ):
                continue

        logs.append(log_entry)

    return LogsResponse(
        logs=logs,
        device_id=str(device_id),
        count=len(logs),
    )
