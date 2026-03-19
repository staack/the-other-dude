"""
Wireless link API endpoints.

Routes: /api/tenants/{tenant_id}/links, /api/tenants/{tenant_id}/devices/{device_id}/links,
        /api/tenants/{tenant_id}/sites/{site_id}/links,
        /api/tenants/{tenant_id}/devices/{device_id}/unknown-clients

RBAC:
- viewer: GET (read-only) -- all endpoints are GET-only
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.link import (
    LinkListResponse,
    RegistrationListResponse,
    RFStatsListResponse,
    UnknownClientListResponse,
)
from app.services import link_service

router = APIRouter(tags=["links"])


@router.get(
    "/tenants/{tenant_id}/links",
    response_model=LinkListResponse,
    summary="List wireless links",
)
async def list_links(
    tenant_id: uuid.UUID,
    state: Optional[str] = Query(
        None, description="Filter by link state (active, degraded, down, stale)"
    ),
    device_id: Optional[uuid.UUID] = Query(None, description="Filter by device (AP or CPE side)"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LinkListResponse:
    """List all wireless links for a tenant with optional state and device filters."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await link_service.get_links(
        db=db, tenant_id=tenant_id, state=state, device_id=device_id
    )


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/links",
    response_model=LinkListResponse,
    summary="List device links",
)
async def list_device_links(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LinkListResponse:
    """List wireless links where the given device is either the AP or CPE."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await link_service.get_device_links(db=db, tenant_id=tenant_id, device_id=device_id)


@router.get(
    "/tenants/{tenant_id}/sites/{site_id}/links",
    response_model=LinkListResponse,
    summary="List site links",
)
async def list_site_links(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LinkListResponse:
    """List wireless links where either the AP or CPE device belongs to the given site."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await link_service.get_site_links(db=db, tenant_id=tenant_id, site_id=site_id)


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/registrations",
    response_model=RegistrationListResponse,
    summary="List device wireless registrations",
)
async def list_device_registrations(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RegistrationListResponse:
    """Get latest wireless registration data for a device (most recent per MAC)."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await link_service.get_device_registrations(
        db=db, tenant_id=tenant_id, device_id=device_id
    )


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/rf-stats",
    response_model=RFStatsListResponse,
    summary="List device RF monitor stats",
)
async def list_device_rf_stats(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RFStatsListResponse:
    """Get latest RF monitor stats for a device (most recent per interface)."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await link_service.get_device_rf_stats(db=db, tenant_id=tenant_id, device_id=device_id)


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/unknown-clients",
    response_model=UnknownClientListResponse,
    summary="List unknown wireless clients",
)
async def list_unknown_clients(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UnknownClientListResponse:
    """List wireless clients whose MAC does not resolve to any known device interface."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await link_service.get_unknown_clients(db=db, tenant_id=tenant_id, device_id=device_id)
