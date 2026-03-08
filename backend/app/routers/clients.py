"""
Client device discovery API endpoint.

Fetches ARP, DHCP lease, and wireless registration data from a RouterOS device
via the NATS command proxy, merges by MAC address, and returns a unified client list.

All routes are tenant-scoped under:
    /api/tenants/{tenant_id}/devices/{device_id}/clients

RLS is enforced via get_db() (app_user engine with tenant context).
RBAC: viewer and above (read-only operation).
"""

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import require_min_role
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.device import Device
from app.services import routeros_proxy

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["clients"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    if current_user.is_super_admin:
        from app.database import set_tenant_context
        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


async def _check_device_online(
    db: AsyncSession, device_id: uuid.UUID
) -> Device:
    """Verify the device exists and is online. Returns the Device object."""
    result = await db.execute(
        select(Device).where(Device.id == device_id)  # type: ignore[arg-type]
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found",
        )
    if device.status != "online":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device is offline -- client discovery requires a live connection.",
        )
    return device


# ---------------------------------------------------------------------------
# MAC-address merge logic
# ---------------------------------------------------------------------------


def _normalize_mac(mac: str) -> str:
    """Normalize a MAC address to uppercase colon-separated format."""
    return mac.strip().upper().replace("-", ":")


def _merge_client_data(
    arp_data: list[dict[str, Any]],
    dhcp_data: list[dict[str, Any]],
    wireless_data: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge ARP, DHCP lease, and wireless registration data by MAC address.

    ARP entries are the base. DHCP enriches with hostname. Wireless enriches
    with signal/tx/rx/uptime and marks the client as wireless.
    """
    # Index DHCP leases by MAC
    dhcp_by_mac: dict[str, dict[str, Any]] = {}
    for lease in dhcp_data:
        mac_raw = lease.get("mac-address") or lease.get("active-mac-address", "")
        if mac_raw:
            dhcp_by_mac[_normalize_mac(mac_raw)] = lease

    # Index wireless registrations by MAC
    wireless_by_mac: dict[str, dict[str, Any]] = {}
    for reg in wireless_data:
        mac_raw = reg.get("mac-address", "")
        if mac_raw:
            wireless_by_mac[_normalize_mac(mac_raw)] = reg

    # Track which MACs we've already processed (from ARP)
    seen_macs: set[str] = set()
    clients: list[dict[str, Any]] = []

    # Start with ARP entries as base
    for entry in arp_data:
        mac_raw = entry.get("mac-address", "")
        if not mac_raw:
            continue
        mac = _normalize_mac(mac_raw)
        if mac in seen_macs:
            continue
        seen_macs.add(mac)

        # Determine status: ARP complete flag or dynamic flag
        is_complete = entry.get("complete", "true").lower() == "true"
        arp_status = "reachable" if is_complete else "stale"

        client: dict[str, Any] = {
            "mac": mac,
            "ip": entry.get("address", ""),
            "interface": entry.get("interface", ""),
            "hostname": None,
            "status": arp_status,
            "signal_strength": None,
            "tx_rate": None,
            "rx_rate": None,
            "uptime": None,
            "is_wireless": False,
        }

        # Enrich with DHCP data
        dhcp = dhcp_by_mac.get(mac)
        if dhcp:
            client["hostname"] = dhcp.get("host-name") or None
            dhcp_status = dhcp.get("status", "")
            if dhcp_status:
                client["dhcp_status"] = dhcp_status

        # Enrich with wireless data
        wireless = wireless_by_mac.get(mac)
        if wireless:
            client["is_wireless"] = True
            client["signal_strength"] = wireless.get("signal-strength") or None
            client["tx_rate"] = wireless.get("tx-rate") or None
            client["rx_rate"] = wireless.get("rx-rate") or None
            client["uptime"] = wireless.get("uptime") or None

        clients.append(client)

    # Also include DHCP-only entries (no ARP match -- e.g. expired leases)
    for mac, lease in dhcp_by_mac.items():
        if mac in seen_macs:
            continue
        seen_macs.add(mac)

        client = {
            "mac": mac,
            "ip": lease.get("active-address") or lease.get("address", ""),
            "interface": lease.get("active-server") or "",
            "hostname": lease.get("host-name") or None,
            "status": "stale",  # No ARP entry = not actively reachable
            "signal_strength": None,
            "tx_rate": None,
            "rx_rate": None,
            "uptime": None,
            "is_wireless": mac in wireless_by_mac,
        }

        wireless = wireless_by_mac.get(mac)
        if wireless:
            client["signal_strength"] = wireless.get("signal-strength") or None
            client["tx_rate"] = wireless.get("tx-rate") or None
            client["rx_rate"] = wireless.get("rx-rate") or None
            client["uptime"] = wireless.get("uptime") or None

        clients.append(client)

    return clients


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/clients",
    summary="List connected client devices (ARP + DHCP + wireless)",
)
async def list_clients(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Discover all client devices connected to a MikroTik device.

    Fetches ARP table, DHCP server leases, and wireless registration table
    in parallel, then merges by MAC address into a unified client list.

    Wireless fetch failure is non-fatal (device may not have wireless interfaces).
    DHCP fetch failure is non-fatal (device may not run a DHCP server).
    ARP fetch failure is fatal (core data source).
    """
    await _check_tenant_access(current_user, tenant_id, db)
    await _check_device_online(db, device_id)

    device_id_str = str(device_id)

    # Fetch all three sources in parallel
    arp_result, dhcp_result, wireless_result = await asyncio.gather(
        routeros_proxy.execute_command(device_id_str, "/ip/arp/print"),
        routeros_proxy.execute_command(device_id_str, "/ip/dhcp-server/lease/print"),
        routeros_proxy.execute_command(
            device_id_str, "/interface/wireless/registration-table/print"
        ),
        return_exceptions=True,
    )

    # ARP is required -- if it failed, return 502
    if isinstance(arp_result, Exception):
        logger.error("ARP fetch exception", device_id=device_id_str, error=str(arp_result))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch ARP table: {arp_result}",
        )
    if not arp_result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=arp_result.get("error", "Failed to fetch ARP table"),
        )

    arp_data: list[dict[str, Any]] = arp_result.get("data", [])

    # DHCP is optional -- log warning and continue with empty data
    dhcp_data: list[dict[str, Any]] = []
    if isinstance(dhcp_result, Exception):
        logger.warning(
            "DHCP fetch exception (continuing without DHCP data)",
            device_id=device_id_str,
            error=str(dhcp_result),
        )
    elif not dhcp_result.get("success"):
        logger.warning(
            "DHCP fetch failed (continuing without DHCP data)",
            device_id=device_id_str,
            error=dhcp_result.get("error"),
        )
    else:
        dhcp_data = dhcp_result.get("data", [])

    # Wireless is optional -- many devices have no wireless interfaces
    wireless_data: list[dict[str, Any]] = []
    if isinstance(wireless_result, Exception):
        logger.warning(
            "Wireless fetch exception (device may not have wireless interfaces)",
            device_id=device_id_str,
            error=str(wireless_result),
        )
    elif not wireless_result.get("success"):
        logger.warning(
            "Wireless fetch failed (device may not have wireless interfaces)",
            device_id=device_id_str,
            error=wireless_result.get("error"),
        )
    else:
        wireless_data = wireless_result.get("data", [])

    # Merge by MAC address
    clients = _merge_client_data(arp_data, dhcp_data, wireless_data)

    logger.info(
        "client_discovery_complete",
        device_id=device_id_str,
        tenant_id=str(tenant_id),
        arp_count=len(arp_data),
        dhcp_count=len(dhcp_data),
        wireless_count=len(wireless_data),
        merged_count=len(clients),
    )

    return {
        "clients": clients,
        "device_id": device_id_str,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
