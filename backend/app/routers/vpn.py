"""WireGuard VPN API endpoints.

Tenant-scoped routes under /api/tenants/{tenant_id}/vpn/ for:
- VPN setup (enable WireGuard for tenant)
- VPN config management (update endpoint, enable/disable)
- Peer management (add device, remove, get config)

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: operator and above for all operations.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.rate_limit import limiter
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.device import Device
from app.schemas.vpn import (
    VpnConfigResponse,
    VpnConfigUpdate,
    VpnOnboardRequest,
    VpnOnboardResponse,
    VpnPeerConfig,
    VpnPeerCreate,
    VpnPeerResponse,
    VpnSetupRequest,
)
from app.services import vpn_service

router = APIRouter(tags=["vpn"])


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    if current_user.is_super_admin:
        await set_tenant_context(db, str(tenant_id))
    elif current_user.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def _require_operator(current_user: CurrentUser) -> None:
    if current_user.role == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator role required")


# ── VPN Config ──


@router.get("/tenants/{tenant_id}/vpn", response_model=VpnConfigResponse | None)
async def get_vpn_config(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get VPN configuration for this tenant."""
    await _check_tenant_access(current_user, tenant_id, db)
    config = await vpn_service.get_vpn_config(db, tenant_id)
    if not config:
        return None
    peers = await vpn_service.get_peers(db, tenant_id)
    resp = VpnConfigResponse.model_validate(config)
    resp.peer_count = len(peers)
    return resp


@router.post(
    "/tenants/{tenant_id}/vpn",
    response_model=VpnConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def setup_vpn(
    request: Request,
    tenant_id: uuid.UUID,
    body: VpnSetupRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Enable VPN for this tenant — generates server keys."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)
    try:
        config = await vpn_service.setup_vpn(db, tenant_id, endpoint=body.endpoint)
    except ValueError as e:
        msg = str(e)
        if "already configured" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        elif "exhausted" in msg:
            raise HTTPException(status_code=422, detail=msg)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
    return VpnConfigResponse.model_validate(config)


@router.delete("/tenants/{tenant_id}/vpn", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
async def delete_vpn_config(
    request: Request,
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete VPN configuration and all peers for this tenant."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)
    config = await vpn_service.get_vpn_config(db, tenant_id)
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VPN not configured")
    # Delete all peers first
    peers = await vpn_service.get_peers(db, tenant_id)
    for peer in peers:
        await db.delete(peer)
    await db.delete(config)
    await db.flush()
    await vpn_service._commit_and_sync(db)


@router.patch("/tenants/{tenant_id}/vpn", response_model=VpnConfigResponse)
@limiter.limit("20/minute")
async def update_vpn_config(
    request: Request,
    tenant_id: uuid.UUID,
    body: VpnConfigUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update VPN settings (endpoint, enable/disable)."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)
    try:
        config = await vpn_service.update_vpn_config(
            db, tenant_id, endpoint=body.endpoint, is_enabled=body.is_enabled
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    peers = await vpn_service.get_peers(db, tenant_id)
    resp = VpnConfigResponse.model_validate(config)
    resp.peer_count = len(peers)
    return resp


# ── VPN Peers ──


@router.get("/tenants/{tenant_id}/vpn/peers", response_model=list[VpnPeerResponse])
async def list_peers(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all VPN peers for this tenant."""
    await _check_tenant_access(current_user, tenant_id, db)
    peers = await vpn_service.get_peers(db, tenant_id)

    # Enrich with device info
    device_ids = [p.device_id for p in peers]
    devices = {}
    if device_ids:
        result = await db.execute(select(Device).where(Device.id.in_(device_ids)))
        devices = {d.id: d for d in result.scalars().all()}

    # Read live WireGuard status for handshake enrichment
    wg_status = vpn_service.read_wg_status()

    responses = []
    for peer in peers:
        resp = VpnPeerResponse.model_validate(peer)
        device = devices.get(peer.device_id)
        if device:
            resp.device_hostname = device.hostname
            resp.device_ip = device.ip_address
        # Enrich with live handshake from WireGuard container
        live_handshake = vpn_service.get_peer_handshake(wg_status, peer.peer_public_key)
        if live_handshake:
            resp.last_handshake = live_handshake
        responses.append(resp)
    return responses


@router.post(
    "/tenants/{tenant_id}/vpn/peers",
    response_model=VpnPeerResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def add_peer(
    request: Request,
    tenant_id: uuid.UUID,
    body: VpnPeerCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a device as a VPN peer."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)
    try:
        peer = await vpn_service.add_peer(
            db, tenant_id, body.device_id, additional_allowed_ips=body.additional_allowed_ips
        )
    except ValueError as e:
        msg = str(e)
        if "must not overlap" in msg:
            raise HTTPException(status_code=422, detail=msg)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)

    # Enrich with device info
    result = await db.execute(select(Device).where(Device.id == peer.device_id))
    device = result.scalar_one_or_none()

    resp = VpnPeerResponse.model_validate(peer)
    if device:
        resp.device_hostname = device.hostname
        resp.device_ip = device.ip_address
    return resp


@router.post(
    "/tenants/{tenant_id}/vpn/peers/onboard",
    response_model=VpnOnboardResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def onboard_device(
    request: Request,
    tenant_id: uuid.UUID,
    body: VpnOnboardRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create device + VPN peer in one step. Returns RouterOS commands for tunnel setup."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)
    try:
        result = await vpn_service.onboard_device(
            db,
            tenant_id,
            hostname=body.hostname,
            username=body.username,
            password=body.password,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return VpnOnboardResponse(**result)


@router.delete("/tenants/{tenant_id}/vpn/peers/{peer_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
async def remove_peer(
    request: Request,
    tenant_id: uuid.UUID,
    peer_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a VPN peer."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)
    try:
        await vpn_service.remove_peer(db, tenant_id, peer_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/tenants/{tenant_id}/vpn/peers/{peer_id}/config", response_model=VpnPeerConfig)
async def get_peer_device_config(
    tenant_id: uuid.UUID,
    peer_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the full config for a peer — includes private key and RouterOS commands."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_operator(current_user)
    try:
        config = await vpn_service.get_peer_config(db, tenant_id, peer_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return VpnPeerConfig(**config)
