"""
Network topology inference endpoint.

Endpoint: GET /api/tenants/{tenant_id}/topology

Builds a topology graph of managed devices by:
1. Querying all devices for the tenant (via RLS)
2. Fetching /ip/neighbor tables from online devices via NATS
3. Matching neighbor addresses to known devices
4. Falling back to shared /24 subnet inference when neighbor data is unavailable
5. Caching results in Redis with 5-minute TTL
"""

import asyncio
import ipaddress
import json
import logging
import uuid
from typing import Any

import redis.asyncio as aioredis
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db, set_tenant_context
from app.middleware.rbac import require_min_role
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.device import Device
from app.models.vpn import VpnPeer
from app.services import routeros_proxy

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["topology"])

# ---------------------------------------------------------------------------
# Redis connection (lazy initialized, same pattern as routeros_proxy NATS)
# ---------------------------------------------------------------------------

_redis: aioredis.Redis | None = None
TOPOLOGY_CACHE_TTL = 300  # 5 minutes


async def _get_redis() -> aioredis.Redis:
    """Get or create a Redis connection for topology caching."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        logger.info("Topology Redis connection established")
    return _redis


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class TopologyNode(BaseModel):
    id: str
    hostname: str
    ip: str
    status: str
    model: str | None
    uptime: str | None


class TopologyEdge(BaseModel):
    source: str
    target: str
    label: str


class TopologyResponse(BaseModel):
    nodes: list[TopologyNode]
    edges: list[TopologyEdge]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    if current_user.is_super_admin:
        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


def _format_uptime(seconds: int | None) -> str | None:
    """Convert uptime seconds to a human-readable string."""
    if seconds is None:
        return None
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    if days > 0:
        return f"{days}d {hours}h {minutes}m"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def _get_subnet_key(ip_str: str) -> str | None:
    """Return the /24 network key for an IPv4 address, or None if invalid."""
    try:
        addr = ipaddress.ip_address(ip_str)
        if isinstance(addr, ipaddress.IPv4Address):
            network = ipaddress.ip_network(f"{ip_str}/24", strict=False)
            return str(network)
    except ValueError:
        pass
    return None


def _build_edges_from_neighbors(
    neighbor_data: dict[str, list[dict[str, Any]]],
    ip_to_device: dict[str, str],
) -> list[TopologyEdge]:
    """Build topology edges from neighbor discovery results.

    Args:
        neighbor_data: Mapping of device_id -> list of neighbor entries.
        ip_to_device: Mapping of IP address -> device_id for known devices.

    Returns:
        De-duplicated list of topology edges.
    """
    seen_edges: set[tuple[str, str]] = set()
    edges: list[TopologyEdge] = []

    for device_id, neighbors in neighbor_data.items():
        for neighbor in neighbors:
            # RouterOS neighbor entry has 'address' (or 'address4') field
            neighbor_ip = neighbor.get("address") or neighbor.get("address4", "")
            if not neighbor_ip:
                continue

            target_device_id = ip_to_device.get(neighbor_ip)
            if target_device_id is None or target_device_id == device_id:
                continue

            # De-duplicate bidirectional edges (A->B and B->A become one edge)
            edge_key = tuple(sorted([device_id, target_device_id]))
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)

            interface_name = neighbor.get("interface", "neighbor")
            edges.append(
                TopologyEdge(
                    source=device_id,
                    target=target_device_id,
                    label=interface_name,
                )
            )

    return edges


def _build_edges_from_subnets(
    devices: list[Device],
    existing_connected: set[tuple[str, str]],
) -> list[TopologyEdge]:
    """Infer edges from shared /24 subnets for devices without neighbor data.

    Only adds subnet-based edges for device pairs that are NOT already connected
    via neighbor discovery.
    """
    # Group devices by /24 subnet
    subnet_groups: dict[str, list[str]] = {}
    for device in devices:
        subnet_key = _get_subnet_key(device.ip_address)
        if subnet_key:
            subnet_groups.setdefault(subnet_key, []).append(str(device.id))

    edges: list[TopologyEdge] = []
    for subnet, device_ids in subnet_groups.items():
        if len(device_ids) < 2:
            continue
        # Connect all pairs in the subnet
        for i, src in enumerate(device_ids):
            for tgt in device_ids[i + 1 :]:
                edge_key = tuple(sorted([src, tgt]))
                if edge_key in existing_connected:
                    continue
                edges.append(
                    TopologyEdge(
                        source=src,
                        target=tgt,
                        label="shared subnet",
                    )
                )
                existing_connected.add(edge_key)

    return edges


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/topology",
    response_model=TopologyResponse,
    summary="Get network topology for a tenant",
)
async def get_topology(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> TopologyResponse:
    """Build and return a network topology graph for the given tenant.

    The topology is inferred from:
    1. LLDP/CDP/MNDP neighbor discovery on online devices
    2. Shared /24 subnet fallback for devices without neighbor data

    Results are cached in Redis with a 5-minute TTL.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    cache_key = f"topology:{tenant_id}"

    # Check Redis cache
    try:
        rd = await _get_redis()
        cached = await rd.get(cache_key)
        if cached:
            data = json.loads(cached)
            return TopologyResponse(**data)
    except Exception as exc:
        logger.warning("Redis cache read failed, computing topology fresh", error=str(exc))

    # Fetch all devices for tenant (RLS enforced via get_db)
    result = await db.execute(
        select(
            Device.id,
            Device.hostname,
            Device.ip_address,
            Device.status,
            Device.model,
            Device.uptime_seconds,
        )
    )
    rows = result.all()

    if not rows:
        return TopologyResponse(nodes=[], edges=[])

    # Build nodes
    nodes: list[TopologyNode] = []
    ip_to_device: dict[str, str] = {}
    online_device_ids: list[str] = []
    devices_by_id: dict[str, Any] = {}

    for row in rows:
        device_id = str(row.id)
        nodes.append(
            TopologyNode(
                id=device_id,
                hostname=row.hostname,
                ip=row.ip_address,
                status=row.status,
                model=row.model,
                uptime=_format_uptime(row.uptime_seconds),
            )
        )
        ip_to_device[row.ip_address] = device_id
        if row.status == "online":
            online_device_ids.append(device_id)

    # Fetch neighbor tables from online devices in parallel
    neighbor_data: dict[str, list[dict[str, Any]]] = {}

    if online_device_ids:
        tasks = [
            routeros_proxy.execute_command(
                device_id, "/ip/neighbor/print", timeout=10.0
            )
            for device_id in online_device_ids
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for device_id, res in zip(online_device_ids, results):
            if isinstance(res, Exception):
                logger.warning(
                    "Neighbor fetch failed",
                    device_id=device_id,
                    error=str(res),
                )
                continue
            if isinstance(res, dict) and res.get("success") and res.get("data"):
                neighbor_data[device_id] = res["data"]

    # Build edges from neighbor discovery
    neighbor_edges = _build_edges_from_neighbors(neighbor_data, ip_to_device)

    # Track connected pairs for subnet fallback
    connected_pairs: set[tuple[str, str]] = set()
    for edge in neighbor_edges:
        connected_pairs.add(tuple(sorted([edge.source, edge.target])))

    # VPN-based edges: query WireGuard peers to infer hub-spoke topology.
    # VPN peers all connect to the same WireGuard server. The gateway device
    # is the managed device NOT in the VPN peers list (it's the server, not a
    # client). If found, create star edges from gateway to each VPN peer device.
    vpn_edges: list[TopologyEdge] = []
    vpn_peer_device_ids: set[str] = set()
    try:
        peer_result = await db.execute(
            select(VpnPeer.device_id).where(VpnPeer.is_enabled.is_(True))
        )
        vpn_peer_device_ids = {str(row[0]) for row in peer_result.all()}

        if vpn_peer_device_ids:
            # Gateway = managed devices NOT in VPN peers (typically the Core router)
            all_device_ids = {str(row.id) for row in rows}
            gateway_ids = all_device_ids - vpn_peer_device_ids
            # Pick the gateway that's online (prefer online devices)
            gateway_id = None
            for gid in gateway_ids:
                if gid in online_device_ids:
                    gateway_id = gid
                    break
            if not gateway_id and gateway_ids:
                gateway_id = next(iter(gateway_ids))

            if gateway_id:
                for peer_device_id in vpn_peer_device_ids:
                    edge_key = tuple(sorted([gateway_id, peer_device_id]))
                    if edge_key not in connected_pairs:
                        vpn_edges.append(
                            TopologyEdge(
                                source=gateway_id,
                                target=peer_device_id,
                                label="vpn tunnel",
                            )
                        )
                        connected_pairs.add(edge_key)
    except Exception as exc:
        logger.warning("VPN edge detection failed", error=str(exc))

    # Fallback: infer connections from shared /24 subnets
    # Query full Device objects for subnet analysis
    device_result = await db.execute(select(Device))
    all_devices = list(device_result.scalars().all())
    subnet_edges = _build_edges_from_subnets(all_devices, connected_pairs)

    all_edges = neighbor_edges + vpn_edges + subnet_edges

    topology = TopologyResponse(nodes=nodes, edges=all_edges)

    # Cache result in Redis
    try:
        rd = await _get_redis()
        await rd.set(cache_key, topology.model_dump_json(), ex=TOPOLOGY_CACHE_TTL)
    except Exception as exc:
        logger.warning("Redis cache write failed", error=str(exc))

    return topology
