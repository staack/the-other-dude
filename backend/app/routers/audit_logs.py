"""Audit log API endpoints.

Tenant-scoped routes under /api/tenants/{tenant_id}/ for:
- Paginated, filterable audit log listing
- CSV export of audit logs

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: operator and above can view audit logs.

Phase 30: Audit log details are encrypted at rest via Transit (Tier 2).
When encrypted_details is set, the router decrypts via Transit on-demand
and returns the plaintext details in the response. Structural fields
(action, resource_type, timestamp, ip_address) are always plaintext.
"""

import asyncio
import csv
import io
import json
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

router = APIRouter(tags=["audit-logs"])


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
    allowed = {"super_admin", "admin", "operator"}
    if current_user.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="At least operator role required to view audit logs.",
        )


async def _decrypt_audit_details(
    encrypted_details: str | None,
    plaintext_details: dict[str, Any] | None,
    tenant_id: str,
) -> dict[str, Any]:
    """Decrypt encrypted audit log details via Transit, falling back to plaintext.

    Priority:
    1. If encrypted_details is set, decrypt via Transit and parse as JSON.
    2. If decryption fails, return plaintext details as fallback.
    3. If neither available, return empty dict.
    """
    if encrypted_details:
        try:
            from app.services.crypto import decrypt_data_transit

            decrypted_json = await decrypt_data_transit(encrypted_details, tenant_id)
            return json.loads(decrypted_json)
        except Exception:
            logger.warning(
                "Failed to decrypt audit details for tenant %s, using plaintext fallback",
                tenant_id,
                exc_info=True,
            )
            # Fall through to plaintext
    return plaintext_details if plaintext_details else {}


async def _decrypt_details_batch(
    rows: list[Any],
    tenant_id: str,
) -> list[dict[str, Any]]:
    """Decrypt encrypted_details for a batch of audit log rows concurrently.

    Uses asyncio.gather with limited concurrency to avoid overwhelming OpenBao.
    Rows without encrypted_details return their plaintext details directly.
    """
    semaphore = asyncio.Semaphore(10)  # Limit concurrent Transit calls

    async def _decrypt_one(row: Any) -> dict[str, Any]:
        async with semaphore:
            return await _decrypt_audit_details(
                row.get("encrypted_details"),
                row.get("details"),
                tenant_id,
            )

    return list(await asyncio.gather(*[_decrypt_one(row) for row in rows]))


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class AuditLogItem(BaseModel):
    id: str
    user_email: Optional[str] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    device_name: Optional[str] = None
    details: dict[str, Any] = {}
    ip_address: Optional[str] = None
    created_at: str


class AuditLogResponse(BaseModel):
    items: list[AuditLogItem]
    total: int
    page: int
    per_page: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/audit-logs",
    response_model=AuditLogResponse,
    summary="List audit logs with pagination and filters",
)
async def list_audit_logs(
    tenant_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=100),
    action: Optional[str] = Query(default=None),
    user_id: Optional[uuid.UUID] = Query(default=None),
    device_id: Optional[uuid.UUID] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    format: Optional[str] = Query(default=None, description="Set to 'csv' for CSV export"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Any:
    _require_operator(current_user)
    await _check_tenant_access(current_user, tenant_id, db)

    # Build filter conditions using parameterized text fragments
    conditions = [text("a.tenant_id = :tenant_id")]
    params: dict[str, Any] = {"tenant_id": str(tenant_id)}

    if action:
        conditions.append(text("a.action = :action"))
        params["action"] = action

    if user_id:
        conditions.append(text("a.user_id = :user_id"))
        params["user_id"] = str(user_id)

    if device_id:
        conditions.append(text("a.device_id = :device_id"))
        params["device_id"] = str(device_id)

    if date_from:
        conditions.append(text("a.created_at >= :date_from"))
        params["date_from"] = date_from.isoformat()

    if date_to:
        conditions.append(text("a.created_at <= :date_to"))
        params["date_to"] = date_to.isoformat()

    where_clause = and_(*conditions)

    # Shared SELECT columns for data queries
    _data_columns = text(
        "a.id, u.email AS user_email, a.action, a.resource_type, "
        "a.resource_id, d.hostname AS device_name, a.details, "
        "a.encrypted_details, a.ip_address, a.created_at"
    )
    _data_from = text(
        "audit_logs a "
        "LEFT JOIN users u ON a.user_id = u.id "
        "LEFT JOIN devices d ON a.device_id = d.id"
    )

    # Count total
    count_result = await db.execute(
        select(func.count()).select_from(text("audit_logs a")).where(where_clause),
        params,
    )
    total = count_result.scalar() or 0

    # CSV export -- no pagination limit
    if format == "csv":
        result = await db.execute(
            select(_data_columns)
            .select_from(_data_from)
            .where(where_clause)
            .order_by(text("a.created_at DESC")),
            params,
        )
        all_rows = result.mappings().all()

        # Decrypt encrypted details concurrently
        decrypted_details = await _decrypt_details_batch(
            all_rows, str(tenant_id)
        )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "User Email", "Action", "Resource Type",
            "Resource ID", "Device", "Details", "IP Address", "Timestamp",
        ])
        for row, details in zip(all_rows, decrypted_details):
            details_str = json.dumps(details) if details else "{}"
            writer.writerow([
                str(row["id"]),
                row["user_email"] or "",
                row["action"],
                row["resource_type"] or "",
                row["resource_id"] or "",
                row["device_name"] or "",
                details_str,
                row["ip_address"] or "",
                str(row["created_at"]),
            ])

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit-logs.csv"},
        )

    # Paginated query
    offset = (page - 1) * per_page
    params["limit"] = per_page
    params["offset"] = offset

    result = await db.execute(
        select(_data_columns)
        .select_from(_data_from)
        .where(where_clause)
        .order_by(text("a.created_at DESC"))
        .limit(per_page)
        .offset(offset),
        params,
    )
    rows = result.mappings().all()

    # Decrypt encrypted details concurrently (skips rows without encrypted_details)
    decrypted_details = await _decrypt_details_batch(rows, str(tenant_id))

    items = [
        AuditLogItem(
            id=str(row["id"]),
            user_email=row["user_email"],
            action=row["action"],
            resource_type=row["resource_type"],
            resource_id=row["resource_id"],
            device_name=row["device_name"],
            details=details,
            ip_address=row["ip_address"],
            created_at=row["created_at"].isoformat() if row["created_at"] else "",
        )
        for row, details in zip(rows, decrypted_details)
    ]

    return AuditLogResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
    )
