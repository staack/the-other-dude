"""Transparency log API endpoints.

Tenant-scoped routes under /api/tenants/{tenant_id}/ for:
- Paginated, filterable key access transparency log listing
- Transparency log statistics (total events, last 24h, unique devices, justification breakdown)
- CSV export of transparency logs

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: admin and above can view transparency logs (tenant_admin or super_admin).

Phase 31: Data Access Transparency Dashboard - TRUST-01, TRUST-02
Shows tenant admins every KMS credential access event for their tenant.
"""

import csv
import io
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.tenant_context import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["transparency"])


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


def _require_admin(current_user: CurrentUser) -> None:
    """Raise 403 if user does not have at least admin role.

    Transparency data is sensitive operational intelligence --
    only tenant_admin and super_admin can view it.
    """
    allowed = {"super_admin", "admin", "tenant_admin"}
    if current_user.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="At least admin role required to view transparency logs.",
        )


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class TransparencyLogItem(BaseModel):
    id: str
    action: str
    device_name: Optional[str] = None
    device_id: Optional[str] = None
    justification: Optional[str] = None
    operator_email: Optional[str] = None
    correlation_id: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: str


class TransparencyLogResponse(BaseModel):
    items: list[TransparencyLogItem]
    total: int
    page: int
    per_page: int


class TransparencyStats(BaseModel):
    total_events: int
    events_last_24h: int
    unique_devices: int
    justification_breakdown: dict[str, int]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/transparency-logs",
    response_model=TransparencyLogResponse,
    summary="List KMS credential access events for tenant",
)
async def list_transparency_logs(
    tenant_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=100),
    device_id: Optional[uuid.UUID] = Query(default=None),
    justification: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Any:
    _require_admin(current_user)
    await _check_tenant_access(current_user, tenant_id, db)

    # Build filter conditions using parameterized text fragments
    conditions = [text("k.tenant_id = :tenant_id")]
    params: dict[str, Any] = {"tenant_id": str(tenant_id)}

    if device_id:
        conditions.append(text("k.device_id = :device_id"))
        params["device_id"] = str(device_id)

    if justification:
        conditions.append(text("k.justification = :justification"))
        params["justification"] = justification

    if action:
        conditions.append(text("k.action = :action"))
        params["action"] = action

    if date_from:
        conditions.append(text("k.created_at >= :date_from"))
        params["date_from"] = date_from.isoformat()

    if date_to:
        conditions.append(text("k.created_at <= :date_to"))
        params["date_to"] = date_to.isoformat()

    where_clause = and_(*conditions)

    # Shared SELECT columns for data queries
    _data_columns = text(
        "k.id, k.action, d.hostname AS device_name, "
        "k.device_id, k.justification, u.email AS operator_email, "
        "k.correlation_id, k.resource_type, k.resource_id, "
        "k.ip_address, k.created_at"
    )
    _data_from = text(
        "key_access_log k "
        "LEFT JOIN users u ON k.user_id = u.id "
        "LEFT JOIN devices d ON k.device_id = d.id"
    )

    # Count total
    count_result = await db.execute(
        select(func.count()).select_from(text("key_access_log k")).where(where_clause),
        params,
    )
    total = count_result.scalar() or 0

    # Paginated query
    offset = (page - 1) * per_page
    params["limit"] = per_page
    params["offset"] = offset

    result = await db.execute(
        select(_data_columns)
        .select_from(_data_from)
        .where(where_clause)
        .order_by(text("k.created_at DESC"))
        .limit(per_page)
        .offset(offset),
        params,
    )
    rows = result.mappings().all()

    items = [
        TransparencyLogItem(
            id=str(row["id"]),
            action=row["action"],
            device_name=row["device_name"],
            device_id=str(row["device_id"]) if row["device_id"] else None,
            justification=row["justification"],
            operator_email=row["operator_email"],
            correlation_id=row["correlation_id"],
            resource_type=row["resource_type"],
            resource_id=row["resource_id"],
            ip_address=row["ip_address"],
            created_at=row["created_at"].isoformat() if row["created_at"] else "",
        )
        for row in rows
    ]

    return TransparencyLogResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get(
    "/tenants/{tenant_id}/transparency-logs/stats",
    response_model=TransparencyStats,
    summary="Get transparency log statistics",
)
async def get_transparency_stats(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TransparencyStats:
    _require_admin(current_user)
    await _check_tenant_access(current_user, tenant_id, db)

    params: dict[str, Any] = {"tenant_id": str(tenant_id)}

    # Total events
    total_result = await db.execute(
        select(func.count())
        .select_from(text("key_access_log"))
        .where(text("tenant_id = :tenant_id")),
        params,
    )
    total_events = total_result.scalar() or 0

    # Events in last 24 hours
    last_24h_result = await db.execute(
        select(func.count())
        .select_from(text("key_access_log"))
        .where(
            and_(
                text("tenant_id = :tenant_id"),
                text("created_at >= NOW() - INTERVAL '24 hours'"),
            )
        ),
        params,
    )
    events_last_24h = last_24h_result.scalar() or 0

    # Unique devices
    unique_devices_result = await db.execute(
        select(func.count(text("DISTINCT device_id")))
        .select_from(text("key_access_log"))
        .where(
            and_(
                text("tenant_id = :tenant_id"),
                text("device_id IS NOT NULL"),
            )
        ),
        params,
    )
    unique_devices = unique_devices_result.scalar() or 0

    # Justification breakdown
    breakdown_result = await db.execute(
        select(
            text("COALESCE(justification, 'system') AS justification_label"),
            func.count().label("count"),
        )
        .select_from(text("key_access_log"))
        .where(text("tenant_id = :tenant_id"))
        .group_by(text("justification_label")),
        params,
    )
    justification_breakdown: dict[str, int] = {}
    for row in breakdown_result.mappings().all():
        justification_breakdown[row["justification_label"]] = row["count"]

    return TransparencyStats(
        total_events=total_events,
        events_last_24h=events_last_24h,
        unique_devices=unique_devices,
        justification_breakdown=justification_breakdown,
    )


@router.get(
    "/tenants/{tenant_id}/transparency-logs/export",
    summary="Export transparency logs as CSV",
)
async def export_transparency_logs(
    tenant_id: uuid.UUID,
    device_id: Optional[uuid.UUID] = Query(default=None),
    justification: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    _require_admin(current_user)
    await _check_tenant_access(current_user, tenant_id, db)

    # Build filter conditions
    conditions = [text("k.tenant_id = :tenant_id")]
    params: dict[str, Any] = {"tenant_id": str(tenant_id)}

    if device_id:
        conditions.append(text("k.device_id = :device_id"))
        params["device_id"] = str(device_id)

    if justification:
        conditions.append(text("k.justification = :justification"))
        params["justification"] = justification

    if action:
        conditions.append(text("k.action = :action"))
        params["action"] = action

    if date_from:
        conditions.append(text("k.created_at >= :date_from"))
        params["date_from"] = date_from.isoformat()

    if date_to:
        conditions.append(text("k.created_at <= :date_to"))
        params["date_to"] = date_to.isoformat()

    where_clause = and_(*conditions)

    _data_columns = text(
        "k.id, k.action, d.hostname AS device_name, "
        "k.device_id, k.justification, u.email AS operator_email, "
        "k.correlation_id, k.resource_type, k.resource_id, "
        "k.ip_address, k.created_at"
    )
    _data_from = text(
        "key_access_log k "
        "LEFT JOIN users u ON k.user_id = u.id "
        "LEFT JOIN devices d ON k.device_id = d.id"
    )

    result = await db.execute(
        select(_data_columns)
        .select_from(_data_from)
        .where(where_clause)
        .order_by(text("k.created_at DESC")),
        params,
    )
    all_rows = result.mappings().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "ID",
            "Action",
            "Device Name",
            "Device ID",
            "Justification",
            "Operator Email",
            "Correlation ID",
            "Resource Type",
            "Resource ID",
            "IP Address",
            "Timestamp",
        ]
    )
    for row in all_rows:
        writer.writerow(
            [
                str(row["id"]),
                row["action"],
                row["device_name"] or "",
                str(row["device_id"]) if row["device_id"] else "",
                row["justification"] or "",
                row["operator_email"] or "",
                row["correlation_id"] or "",
                row["resource_type"] or "",
                row["resource_id"] or "",
                row["ip_address"] or "",
                str(row["created_at"]),
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transparency-logs.csv"},
    )
