"""Link service -- query layer for wireless links and unknown clients.

All functions use raw SQL via the app_user engine (RLS enforced).
Tenant isolation is handled automatically by PostgreSQL RLS policies
once the tenant context is set by the middleware.
"""

import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.link import (
    LinkListResponse,
    LinkResponse,
    UnknownClientListResponse,
    UnknownClientResponse,
)


async def get_links(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    state: Optional[str] = None,
    device_id: Optional[uuid.UUID] = None,
) -> LinkListResponse:
    """List wireless links for a tenant with optional state and device filters.

    The device_id filter matches links where the device is either the AP or CPE side.
    """
    conditions = ["wl.tenant_id = :tenant_id"]
    params: dict = {"tenant_id": str(tenant_id)}

    if state:
        conditions.append("wl.state = :state")
        params["state"] = state

    if device_id:
        conditions.append("(wl.ap_device_id = :device_id OR wl.cpe_device_id = :device_id)")
        params["device_id"] = str(device_id)

    where_clause = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT wl.id, wl.ap_device_id, wl.cpe_device_id,
                   ap.hostname AS ap_hostname, cpe.hostname AS cpe_hostname,
                   wl.interface, wl.client_mac, wl.signal_strength,
                   wl.tx_ccq, wl.tx_rate, wl.rx_rate, wl.state,
                   wl.missed_polls, wl.discovered_at, wl.last_seen
            FROM wireless_links wl
            LEFT JOIN devices ap ON ap.id = wl.ap_device_id
            LEFT JOIN devices cpe ON cpe.id = wl.cpe_device_id
            WHERE {where_clause}
            ORDER BY wl.last_seen DESC
        """),
        params,
    )
    rows = result.fetchall()

    items = [
        LinkResponse(
            id=row.id,
            ap_device_id=row.ap_device_id,
            cpe_device_id=row.cpe_device_id,
            ap_hostname=row.ap_hostname,
            cpe_hostname=row.cpe_hostname,
            interface=row.interface,
            client_mac=row.client_mac,
            signal_strength=row.signal_strength,
            tx_ccq=row.tx_ccq,
            tx_rate=row.tx_rate,
            rx_rate=row.rx_rate,
            state=row.state,
            missed_polls=row.missed_polls,
            discovered_at=row.discovered_at,
            last_seen=row.last_seen,
        )
        for row in rows
    ]

    return LinkListResponse(items=items, total=len(items))


async def get_device_links(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
) -> LinkListResponse:
    """List wireless links where the given device is either the AP or CPE."""
    return await get_links(db=db, tenant_id=tenant_id, device_id=device_id)


async def get_site_links(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
) -> LinkListResponse:
    """List wireless links where either the AP or CPE device belongs to the given site."""
    result = await db.execute(
        text("""
            SELECT wl.id, wl.ap_device_id, wl.cpe_device_id,
                   ap.hostname AS ap_hostname, cpe.hostname AS cpe_hostname,
                   wl.interface, wl.client_mac, wl.signal_strength,
                   wl.tx_ccq, wl.tx_rate, wl.rx_rate, wl.state,
                   wl.missed_polls, wl.discovered_at, wl.last_seen
            FROM wireless_links wl
            LEFT JOIN devices ap ON ap.id = wl.ap_device_id
            LEFT JOIN devices cpe ON cpe.id = wl.cpe_device_id
            WHERE wl.tenant_id = :tenant_id
              AND (ap.site_id = :site_id OR cpe.site_id = :site_id)
            ORDER BY wl.last_seen DESC
        """),
        {"tenant_id": str(tenant_id), "site_id": str(site_id)},
    )
    rows = result.fetchall()

    items = [
        LinkResponse(
            id=row.id,
            ap_device_id=row.ap_device_id,
            cpe_device_id=row.cpe_device_id,
            ap_hostname=row.ap_hostname,
            cpe_hostname=row.cpe_hostname,
            interface=row.interface,
            client_mac=row.client_mac,
            signal_strength=row.signal_strength,
            tx_ccq=row.tx_ccq,
            tx_rate=row.tx_rate,
            rx_rate=row.rx_rate,
            state=row.state,
            missed_polls=row.missed_polls,
            discovered_at=row.discovered_at,
            last_seen=row.last_seen,
        )
        for row in rows
    ]

    return LinkListResponse(items=items, total=len(items))


async def get_unknown_clients(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
) -> UnknownClientListResponse:
    """List wireless clients connected to a device whose MAC does not match any known device interface.

    Uses DISTINCT ON to return the most recent registration per unique MAC address.
    """
    result = await db.execute(
        text("""
            SELECT DISTINCT ON (wr.mac_address)
                   wr.mac_address, wr.interface, wr.signal_strength,
                   wr.tx_rate, wr.rx_rate, wr.time AS last_seen
            FROM wireless_registrations wr
            WHERE wr.device_id = :device_id
              AND wr.tenant_id = :tenant_id
              AND wr.mac_address NOT IN (
                  SELECT di.mac_address FROM device_interfaces di
                  WHERE di.tenant_id = :tenant_id
              )
            ORDER BY wr.mac_address, wr.time DESC
        """),
        {"device_id": str(device_id), "tenant_id": str(tenant_id)},
    )
    rows = result.fetchall()

    items = [
        UnknownClientResponse(
            mac_address=row.mac_address,
            interface=row.interface,
            signal_strength=row.signal_strength,
            tx_rate=row.tx_rate,
            rx_rate=row.rx_rate,
            last_seen=row.last_seen,
        )
        for row in rows
    ]

    return UnknownClientListResponse(items=items, total=len(items))
