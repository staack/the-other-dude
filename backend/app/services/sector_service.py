"""Sector service -- business logic for sector CRUD and device assignment.

All functions operate via the app_user engine (RLS enforced).
Tenant isolation is handled automatically by PostgreSQL RLS policies.
"""

import uuid

import structlog
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device
from app.models.sector import Sector
from app.schemas.sector import (
    SectorCreate,
    SectorListResponse,
    SectorResponse,
    SectorUpdate,
)

logger = structlog.get_logger("sector_service")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sector_response(sector: Sector, device_count: int = 0) -> SectorResponse:
    """Build a SectorResponse from an ORM Sector instance."""
    return SectorResponse(
        id=sector.id,
        site_id=sector.site_id,
        name=sector.name,
        azimuth=sector.azimuth,
        description=sector.description,
        device_count=device_count,
        created_at=sector.created_at,
        updated_at=sector.updated_at,
    )


async def _get_sector_or_404(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: uuid.UUID,
) -> Sector:
    """Fetch a sector by id, site, and tenant, or raise 404."""
    result = await db.execute(
        select(Sector).where(
            Sector.id == sector_id,
            Sector.site_id == site_id,
            Sector.tenant_id == tenant_id,
        )
    )
    sector = result.scalar_one_or_none()
    if not sector:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sector not found")
    return sector


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def get_sectors(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
) -> SectorListResponse:
    """List all sectors for a site with device counts."""
    # Fetch sectors
    sectors_result = await db.execute(
        select(Sector)
        .where(Sector.site_id == site_id, Sector.tenant_id == tenant_id)
        .order_by(Sector.name)
    )
    sectors = list(sectors_result.scalars().all())

    # Aggregate device counts per sector in a single query
    count_result = await db.execute(
        select(
            Device.sector_id,
            func.count(Device.id).label("device_count"),
        )
        .where(Device.sector_id.isnot(None))
        .group_by(Device.sector_id)
    )
    count_map: dict[uuid.UUID, int] = {}
    for row in count_result:
        count_map[row.sector_id] = row.device_count

    items = [_sector_response(s, device_count=count_map.get(s.id, 0)) for s in sectors]
    return SectorListResponse(items=items, total=len(items))


async def get_sector(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: uuid.UUID,
) -> SectorResponse:
    """Fetch a single sector with device count."""
    sector = await _get_sector_or_404(db, tenant_id, site_id, sector_id)
    count_result = await db.execute(
        select(func.count(Device.id)).where(Device.sector_id == sector_id)
    )
    device_count = count_result.scalar() or 0
    return _sector_response(sector, device_count=device_count)


async def create_sector(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    data: SectorCreate,
) -> SectorResponse:
    """Create a new sector for a site."""
    sector = Sector(
        tenant_id=tenant_id,
        site_id=site_id,
        name=data.name,
        azimuth=data.azimuth,
        description=data.description,
    )
    db.add(sector)
    await db.flush()
    await db.refresh(sector)
    return _sector_response(sector, device_count=0)


async def update_sector(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: uuid.UUID,
    data: SectorUpdate,
) -> SectorResponse:
    """Update an existing sector."""
    sector = await _get_sector_or_404(db, tenant_id, site_id, sector_id)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(sector, field, value)

    await db.flush()
    await db.refresh(sector)

    count_result = await db.execute(
        select(func.count(Device.id)).where(Device.sector_id == sector_id)
    )
    device_count = count_result.scalar() or 0
    return _sector_response(sector, device_count=device_count)


async def delete_sector(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: uuid.UUID,
) -> None:
    """Delete a sector. Devices will have sector_id set to NULL via ON DELETE SET NULL."""
    sector = await _get_sector_or_404(db, tenant_id, site_id, sector_id)
    await db.delete(sector)
    await db.flush()


# ---------------------------------------------------------------------------
# Device assignment
# ---------------------------------------------------------------------------


async def assign_device_to_sector(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    sector_id: uuid.UUID,
) -> None:
    """Assign a device to a sector."""
    # Verify sector exists
    result = await db.execute(
        select(Sector).where(Sector.id == sector_id, Sector.tenant_id == tenant_id)
    )
    sector = result.scalar_one_or_none()
    if not sector:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sector not found")

    # Verify device exists
    dev_result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id)
    )
    device = dev_result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    device.sector_id = sector_id
    await db.flush()


async def remove_device_from_sector(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
) -> None:
    """Remove a device from its current sector (set sector_id to NULL)."""
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    device.sector_id = None
    await db.flush()
