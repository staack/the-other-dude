"""
Signal history API endpoint.

Routes: /api/tenants/{tenant_id}/devices/{device_id}/signal-history

RBAC:
- viewer: GET (read-only)
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.site_alert import SignalHistoryResponse
from app.services import signal_history_service

router = APIRouter(tags=["signal-history"])


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/signal-history",
    response_model=SignalHistoryResponse,
    summary="Get signal strength history for a wireless client",
)
async def get_signal_history(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    mac_address: str = Query(..., description="Client MAC address to query history for"),
    range: str = Query("7d", description="Time range: 24h, 7d, or 30d"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SignalHistoryResponse:
    """Get time-bucketed signal strength history for a wireless client on a device."""
    await _check_tenant_access(current_user, tenant_id, db)

    if range not in ("24h", "7d", "30d"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="range must be one of: 24h, 7d, 30d",
        )

    return await signal_history_service.get_signal_history(
        db=db,
        tenant_id=tenant_id,
        device_id=device_id,
        mac_address=mac_address,
        range=range,
    )
