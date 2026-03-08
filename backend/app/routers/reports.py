"""Report generation API endpoint.

POST /api/tenants/{tenant_id}/reports/generate
Generates PDF or CSV reports for device inventory, metrics summary,
alert history, and change log.

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: require at least operator role.
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.services.report_service import generate_report

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["reports"])


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
    """Raise 403 if user is a viewer (reports require operator+)."""
    if current_user.role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reports require at least operator role.",
        )


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------


class ReportType(str, Enum):
    device_inventory = "device_inventory"
    metrics_summary = "metrics_summary"
    alert_history = "alert_history"
    change_log = "change_log"


class ReportFormat(str, Enum):
    pdf = "pdf"
    csv = "csv"


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ReportType
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    format: ReportFormat = ReportFormat.pdf


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/reports/generate",
    summary="Generate a report (PDF or CSV)",
    response_class=StreamingResponse,
)
async def generate_report_endpoint(
    tenant_id: uuid.UUID,
    body: ReportRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Generate and download a report as PDF or CSV.

    - device_inventory: no date range required
    - metrics_summary, alert_history, change_log: date_from and date_to required
    """
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)

    # Validate date range for time-based reports
    if body.type != ReportType.device_inventory:
        if not body.date_from or not body.date_to:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"date_from and date_to are required for {body.type.value} reports.",
            )
        if body.date_from > body.date_to:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="date_from must be before date_to.",
            )

    try:
        file_bytes, content_type, filename = await generate_report(
            db=db,
            tenant_id=tenant_id,
            report_type=body.type.value,
            date_from=body.date_from,
            date_to=body.date_to,
            fmt=body.format.value,
        )
    except Exception as exc:
        logger.error("report_generation_failed", error=str(exc), report_type=body.type.value)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Report generation failed: {str(exc)}",
        )

    import io

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(file_bytes)),
        },
    )
