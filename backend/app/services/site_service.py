"""Site service -- business logic for site CRUD, device assignment, and health rollup.

All functions operate via the app_user engine (RLS enforced).
Tenant isolation is handled automatically by PostgreSQL RLS policies.
"""

import uuid

import structlog
from fastapi import HTTPException, status
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device
from app.models.site import Site
from app.schemas.site import (
    SiteCreate,
    SiteListResponse,
    SiteResponse,
    SiteUpdate,
)
from app.services import audit_service

logger = structlog.get_logger("site_service")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _site_response(site: Site, device_count: int = 0, online_count: int = 0, alert_count: int = 0) -> SiteResponse:
    """Build a SiteResponse from an ORM Site instance with health stats."""
    online_percent = (online_count / device_count * 100) if device_count > 0 else 0.0
    return SiteResponse(
        id=site.id,
        name=site.name,
        latitude=site.latitude,
        longitude=site.longitude,
        address=site.address,
        elevation=site.elevation,
        notes=site.notes,
        device_count=device_count,
        online_count=online_count,
        online_percent=round(online_percent, 1),
        alert_count=alert_count,
        created_at=site.created_at,
        updated_at=site.updated_at,
    )


async def _get_site_or_404(db: AsyncSession, tenant_id: uuid.UUID, site_id: uuid.UUID) -> Site:
    """Fetch a site by id and tenant, or raise 404."""
    result = await db.execute(
        select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)
    )
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return site


async def _get_health_for_site(db: AsyncSession, site_id: uuid.UUID) -> tuple[int, int]:
    """Return (device_count, online_count) for a single site."""
    result = await db.execute(
        select(
            func.count(Device.id).label("device_count"),
            func.count(Device.id).filter(Device.status == "online").label("online_count"),
        ).where(Device.site_id == site_id)
    )
    row = result.one()
    return row.device_count, row.online_count


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def get_sites(db: AsyncSession, tenant_id: uuid.UUID) -> SiteListResponse:
    """List all sites for a tenant with health rollup stats."""
    # Fetch all sites
    sites_result = await db.execute(
        select(Site).where(Site.tenant_id == tenant_id).order_by(Site.name)
    )
    sites = list(sites_result.scalars().all())

    # Aggregate health stats per site in a single query
    health_result = await db.execute(
        select(
            Device.site_id,
            func.count(Device.id).label("device_count"),
            func.count(Device.id).filter(Device.status == "online").label("online_count"),
        )
        .where(Device.site_id.isnot(None))
        .group_by(Device.site_id)
    )
    health_map: dict[uuid.UUID, tuple[int, int]] = {}
    for row in health_result:
        health_map[row.site_id] = (row.device_count, row.online_count)

    # Unassigned device count
    unassigned_result = await db.execute(
        select(func.count(Device.id)).where(
            Device.tenant_id == tenant_id,
            Device.site_id.is_(None),
        )
    )
    unassigned_count = unassigned_result.scalar() or 0

    # Build responses
    site_responses = []
    for site in sites:
        dc, oc = health_map.get(site.id, (0, 0))
        # TODO: alert_count from alert_events table -- set to 0 until alert system integration
        site_responses.append(_site_response(site, device_count=dc, online_count=oc, alert_count=0))

    return SiteListResponse(sites=site_responses, unassigned_count=unassigned_count)


async def get_site(db: AsyncSession, tenant_id: uuid.UUID, site_id: uuid.UUID) -> SiteResponse:
    """Fetch a single site with health rollup stats."""
    site = await _get_site_or_404(db, tenant_id, site_id)
    dc, oc = await _get_health_for_site(db, site_id)
    # TODO: alert_count from alert_events table -- set to 0 until alert system integration
    return _site_response(site, device_count=dc, online_count=oc, alert_count=0)


async def create_site(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    data: SiteCreate,
    user_id: uuid.UUID | None = None,
) -> SiteResponse:
    """Create a new site for a tenant."""
    site = Site(
        tenant_id=tenant_id,
        name=data.name,
        latitude=data.latitude,
        longitude=data.longitude,
        address=data.address,
        elevation=data.elevation,
        notes=data.notes,
    )
    db.add(site)
    await db.flush()
    await db.refresh(site)

    if user_id:
        await audit_service.log_action(
            db=db,
            tenant_id=tenant_id,
            user_id=user_id,
            action="site.created",
            resource_type="site",
            resource_id=str(site.id),
            details={"name": site.name},
        )

    return _site_response(site, device_count=0, online_count=0, alert_count=0)


async def update_site(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    data: SiteUpdate,
    user_id: uuid.UUID | None = None,
) -> SiteResponse:
    """Update an existing site."""
    site = await _get_site_or_404(db, tenant_id, site_id)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(site, field, value)

    await db.flush()
    await db.refresh(site)

    dc, oc = await _get_health_for_site(db, site_id)

    if user_id:
        await audit_service.log_action(
            db=db,
            tenant_id=tenant_id,
            user_id=user_id,
            action="site.updated",
            resource_type="site",
            resource_id=str(site.id),
            details={"updated_fields": list(update_data.keys())},
        )

    return _site_response(site, device_count=dc, online_count=oc, alert_count=0)


async def delete_site(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
) -> None:
    """Delete a site. Devices will have site_id set to NULL via ON DELETE SET NULL."""
    site = await _get_site_or_404(db, tenant_id, site_id)
    site_name = site.name

    await db.delete(site)
    await db.flush()

    if user_id:
        await audit_service.log_action(
            db=db,
            tenant_id=tenant_id,
            user_id=user_id,
            action="site.deleted",
            resource_type="site",
            resource_id=str(site_id),
            details={"name": site_name},
        )


# ---------------------------------------------------------------------------
# Device assignment
# ---------------------------------------------------------------------------


async def assign_device_to_site(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    device_id: uuid.UUID,
) -> None:
    """Assign a single device to a site."""
    await _get_site_or_404(db, tenant_id, site_id)

    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    device.site_id = site_id
    await db.flush()


async def remove_device_from_site(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
) -> None:
    """Remove a device from its current site (set site_id to NULL)."""
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    device.site_id = None
    await db.flush()


async def bulk_assign_devices_to_site(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    device_ids: list[uuid.UUID],
) -> int:
    """Bulk-assign multiple devices to a site. Returns count of updated rows."""
    await _get_site_or_404(db, tenant_id, site_id)

    result = await db.execute(
        update(Device)
        .where(Device.id.in_(device_ids), Device.tenant_id == tenant_id)
        .values(site_id=site_id)
    )
    await db.flush()
    return result.rowcount
