"""Maintenance windows API endpoints.

Tenant-scoped routes under /api/tenants/{tenant_id}/ for:
- Maintenance window CRUD (list, create, update, delete)
- Filterable by status: upcoming, active, past

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: operator and above for all operations.
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.rate_limit import limiter
from app.middleware.tenant_context import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["maintenance-windows"])


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


def _require_operator(current_user: CurrentUser) -> None:
    """Raise 403 if user does not have at least operator role."""
    if current_user.role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires at least operator role.",
        )


# ---------------------------------------------------------------------------
# Request/response schemas
# ---------------------------------------------------------------------------


class MaintenanceWindowCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    device_ids: list[str] = []
    start_at: datetime
    end_at: datetime
    suppress_alerts: bool = True
    notes: Optional[str] = None


class MaintenanceWindowUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = None
    device_ids: Optional[list[str]] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    suppress_alerts: Optional[bool] = None
    notes: Optional[str] = None


class MaintenanceWindowResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    tenant_id: str
    name: str
    device_ids: list[str]
    start_at: str
    end_at: str
    suppress_alerts: bool
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: str


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/maintenance-windows",
    summary="List maintenance windows for tenant",
)
async def list_maintenance_windows(
    tenant_id: uuid.UUID,
    window_status: Optional[str] = Query(None, alias="status"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)

    filters = ["1=1"]
    params: dict[str, Any] = {}

    if window_status == "active":
        filters.append("mw.start_at <= NOW() AND mw.end_at >= NOW()")
    elif window_status == "upcoming":
        filters.append("mw.start_at > NOW()")
    elif window_status == "past":
        filters.append("mw.end_at < NOW()")

    where = " AND ".join(filters)

    result = await db.execute(
        text(f"""
            SELECT mw.id, mw.tenant_id, mw.name, mw.device_ids,
                   mw.start_at, mw.end_at, mw.suppress_alerts,
                   mw.notes, mw.created_by, mw.created_at
            FROM maintenance_windows mw
            WHERE {where}
            ORDER BY mw.start_at DESC
        """),
        params,
    )

    return [
        {
            "id": str(row[0]),
            "tenant_id": str(row[1]),
            "name": row[2],
            "device_ids": row[3] if isinstance(row[3], list) else [],
            "start_at": row[4].isoformat() if row[4] else None,
            "end_at": row[5].isoformat() if row[5] else None,
            "suppress_alerts": row[6],
            "notes": row[7],
            "created_by": str(row[8]) if row[8] else None,
            "created_at": row[9].isoformat() if row[9] else None,
        }
        for row in result.fetchall()
    ]


@router.post(
    "/tenants/{tenant_id}/maintenance-windows",
    summary="Create maintenance window",
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def create_maintenance_window(
    request: Request,
    tenant_id: uuid.UUID,
    body: MaintenanceWindowCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)

    if body.end_at <= body.start_at:
        raise HTTPException(422, "end_at must be after start_at")

    window_id = str(uuid.uuid4())

    await db.execute(
        text("""
            INSERT INTO maintenance_windows
                (id, tenant_id, name, device_ids, start_at, end_at,
                 suppress_alerts, notes, created_by)
            VALUES
                (CAST(:id AS uuid), CAST(:tenant_id AS uuid),
                 :name, CAST(:device_ids AS jsonb), :start_at, :end_at,
                 :suppress_alerts, :notes, CAST(:created_by AS uuid))
        """),
        {
            "id": window_id,
            "tenant_id": str(tenant_id),
            "name": body.name,
            "device_ids": json.dumps(body.device_ids),
            "start_at": body.start_at,
            "end_at": body.end_at,
            "suppress_alerts": body.suppress_alerts,
            "notes": body.notes,
            "created_by": str(current_user.user_id),
        },
    )
    await db.commit()

    return {
        "id": window_id,
        "tenant_id": str(tenant_id),
        "name": body.name,
        "device_ids": body.device_ids,
        "start_at": body.start_at.isoformat(),
        "end_at": body.end_at.isoformat(),
        "suppress_alerts": body.suppress_alerts,
        "notes": body.notes,
        "created_by": str(current_user.user_id),
        "created_at": datetime.utcnow().isoformat(),
    }


@router.put(
    "/tenants/{tenant_id}/maintenance-windows/{window_id}",
    summary="Update maintenance window",
)
@limiter.limit("20/minute")
async def update_maintenance_window(
    request: Request,
    tenant_id: uuid.UUID,
    window_id: uuid.UUID,
    body: MaintenanceWindowUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)

    # Build dynamic SET clause for partial updates
    set_parts: list[str] = ["updated_at = NOW()"]
    params: dict[str, Any] = {"window_id": str(window_id)}

    if body.name is not None:
        set_parts.append("name = :name")
        params["name"] = body.name
    if body.device_ids is not None:
        set_parts.append("device_ids = CAST(:device_ids AS jsonb)")
        params["device_ids"] = json.dumps(body.device_ids)
    if body.start_at is not None:
        set_parts.append("start_at = :start_at")
        params["start_at"] = body.start_at
    if body.end_at is not None:
        set_parts.append("end_at = :end_at")
        params["end_at"] = body.end_at
    if body.suppress_alerts is not None:
        set_parts.append("suppress_alerts = :suppress_alerts")
        params["suppress_alerts"] = body.suppress_alerts
    if body.notes is not None:
        set_parts.append("notes = :notes")
        params["notes"] = body.notes

    set_clause = ", ".join(set_parts)

    result = await db.execute(
        text(f"""
            UPDATE maintenance_windows
            SET {set_clause}
            WHERE id = CAST(:window_id AS uuid)
            RETURNING id, tenant_id, name, device_ids, start_at, end_at,
                      suppress_alerts, notes, created_by, created_at
        """),
        params,
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Maintenance window not found")
    await db.commit()

    return {
        "id": str(row[0]),
        "tenant_id": str(row[1]),
        "name": row[2],
        "device_ids": row[3] if isinstance(row[3], list) else [],
        "start_at": row[4].isoformat() if row[4] else None,
        "end_at": row[5].isoformat() if row[5] else None,
        "suppress_alerts": row[6],
        "notes": row[7],
        "created_by": str(row[8]) if row[8] else None,
        "created_at": row[9].isoformat() if row[9] else None,
    }


@router.delete(
    "/tenants/{tenant_id}/maintenance-windows/{window_id}",
    summary="Delete maintenance window",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("5/minute")
async def delete_maintenance_window(
    request: Request,
    tenant_id: uuid.UUID,
    window_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)

    result = await db.execute(
        text(
            "DELETE FROM maintenance_windows WHERE id = CAST(:id AS uuid) RETURNING id"
        ),
        {"id": str(window_id)},
    )
    if not result.fetchone():
        raise HTTPException(404, "Maintenance window not found")
    await db.commit()
