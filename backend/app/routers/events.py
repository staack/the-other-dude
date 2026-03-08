"""Unified events timeline API endpoint.

Provides a single GET endpoint that unions alert events, device status changes,
and config backup runs into a unified timeline for the dashboard.

RLS enforced via get_db() (app_user engine with tenant context).
"""

import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.tenant_context import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["events"])


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
# Unified events endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/events",
    summary="List unified events (alerts, status changes, config backups)",
)
async def list_events(
    tenant_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
    event_type: Optional[str] = Query(
        None,
        description="Filter by event type: alert, status_change, config_backup",
    ),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return a unified list of recent events across alerts, device status, and config backups.

    Events are ordered by timestamp descending, limited to `limit` (default 50).
    RLS automatically filters to the tenant's data via the app_user session.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    if event_type and event_type not in ("alert", "status_change", "config_backup"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="event_type must be one of: alert, status_change, config_backup",
        )

    events: list[dict[str, Any]] = []

    # 1. Alert events
    if not event_type or event_type == "alert":
        alert_result = await db.execute(
            text("""
                SELECT ae.id, ae.status, ae.severity, ae.metric, ae.message,
                       ae.fired_at, ae.device_id, d.hostname
                FROM alert_events ae
                LEFT JOIN devices d ON d.id = ae.device_id
                ORDER BY ae.fired_at DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
        for row in alert_result.fetchall():
            alert_status = row[1] or "firing"
            metric = row[3] or "unknown"
            events.append({
                "id": str(row[0]),
                "event_type": "alert",
                "severity": row[2],
                "title": f"{alert_status}: {metric}",
                "description": row[4] or f"Alert {alert_status} for {metric}",
                "device_hostname": row[7],
                "device_id": str(row[6]) if row[6] else None,
                "timestamp": row[5].isoformat() if row[5] else None,
            })

    # 2. Device status changes (inferred from current status + last_seen)
    if not event_type or event_type == "status_change":
        status_result = await db.execute(
            text("""
                SELECT d.id, d.hostname, d.status, d.last_seen
                FROM devices d
                WHERE d.last_seen IS NOT NULL
                ORDER BY d.last_seen DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
        for row in status_result.fetchall():
            device_status = row[2] or "unknown"
            hostname = row[1] or "Unknown device"
            severity = "info" if device_status == "online" else "warning"
            events.append({
                "id": f"status-{row[0]}",
                "event_type": "status_change",
                "severity": severity,
                "title": f"Device {device_status}",
                "description": f"{hostname} is now {device_status}",
                "device_hostname": hostname,
                "device_id": str(row[0]),
                "timestamp": row[3].isoformat() if row[3] else None,
            })

    # 3. Config backup runs
    if not event_type or event_type == "config_backup":
        backup_result = await db.execute(
            text("""
                SELECT cbr.id, cbr.trigger_type, cbr.created_at,
                       cbr.device_id, d.hostname
                FROM config_backup_runs cbr
                LEFT JOIN devices d ON d.id = cbr.device_id
                ORDER BY cbr.created_at DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
        for row in backup_result.fetchall():
            trigger_type = row[1] or "manual"
            hostname = row[4] or "Unknown device"
            events.append({
                "id": str(row[0]),
                "event_type": "config_backup",
                "severity": "info",
                "title": "Config backup",
                "description": f"{trigger_type} backup completed for {hostname}",
                "device_hostname": hostname,
                "device_id": str(row[3]) if row[3] else None,
                "timestamp": row[2].isoformat() if row[2] else None,
            })

    # Sort all events by timestamp descending, then apply final limit
    events.sort(
        key=lambda e: e["timestamp"] or "",
        reverse=True,
    )

    return events[:limit]
