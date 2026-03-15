"""
Remote access endpoints for WinBox tunnels and SSH terminal sessions.

All routes are tenant-scoped under /api/tenants/{tenant_id}/devices/{device_id}.
RBAC: operator+ required for all endpoints.
"""

import json
import logging
import secrets
import time
import uuid
from typing import Optional

import nats
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.rbac import require_operator_or_above
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.device import Device
from app.schemas.remote_access import (
    ActiveSessionsResponse,
    SSHSessionRequest,
    SSHSessionResponse,
    TunnelStatusItem,
    WinboxSessionResponse,
)
from app.schemas.winbox_remote import RemoteWinboxSessionItem
from app.middleware.rate_limit import limiter
from app.services.audit_service import log_action
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter(tags=["remote-access"])

# ---------------------------------------------------------------------------
# Lazy NATS and Redis clients
# ---------------------------------------------------------------------------

_nc: Optional[nats.aio.client.Client] = None
_redis: Optional[aioredis.Redis] = None


async def _get_nats() -> nats.aio.client.Client:
    """Get or create a shared NATS client."""
    global _nc
    if _nc is None or _nc.is_closed:
        _nc = await nats.connect(settings.NATS_URL)
    return _nc


async def _get_redis() -> aioredis.Redis:
    """Get or create a shared Redis client."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _source_ip(request: Request) -> Optional[str]:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else None)


async def _get_device(db: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID) -> Device:
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    if current_user.is_super_admin:
        from app.database import set_tenant_context

        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


# ---------------------------------------------------------------------------
# POST /winbox-session — Open a WinBox tunnel via NATS request-reply
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-session",
    response_model=WinboxSessionResponse,
    summary="Open a WinBox tunnel to the device",
    dependencies=[Depends(require_operator_or_above)],
)
@limiter.limit("10/minute")
async def open_winbox_session(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WinboxSessionResponse:
    """
    Requests the poller to open a local TCP tunnel to device port 8291 (WinBox).

    Returns a tunnel_id, local host/port, and a winbox:// URI.
    Requires operator role or above.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    await _get_device(db, tenant_id, device_id)
    source_ip = _source_ip(request)

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "winbox_tunnel_open",
            resource_type="device",
            resource_id=str(device_id),
            device_id=device_id,
            details={"source_ip": source_ip},
            ip_address=source_ip,
        )
    except Exception:
        pass

    payload = json.dumps(
        {
            "device_id": str(device_id),
            "tenant_id": str(tenant_id),
            "user_id": str(current_user.user_id),
            "target_port": 8291,
        }
    ).encode()

    try:
        nc = await _get_nats()
        msg = await nc.request("tunnel.open", payload, timeout=10)
    except Exception as exc:
        logger.error("NATS tunnel.open failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Tunnel service unavailable"
        )

    try:
        data = json.loads(msg.data)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Invalid response from tunnel service",
        )

    if "error" in data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=data["error"])

    port = data.get("local_port")
    tunnel_id = data.get("tunnel_id", "")
    if not isinstance(port, int) or not (49000 <= port <= 49100):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Invalid port allocation from tunnel service",
        )

    # Derive the tunnel host from the request so remote clients get the server's
    # address rather than 127.0.0.1 (which would point to the user's own machine).
    tunnel_host = (
        request.headers.get("x-forwarded-host") or request.headers.get("host") or "127.0.0.1"
    )
    # Strip port from host header (e.g. "10.101.0.175:8001" → "10.101.0.175")
    tunnel_host = tunnel_host.split(":")[0]

    return WinboxSessionResponse(
        tunnel_id=tunnel_id,
        host=tunnel_host,
        port=port,
        winbox_uri=f"winbox://{tunnel_host}:{port}",
    )


# ---------------------------------------------------------------------------
# POST /ssh-session — Create a single-use Redis token for SSH WebSocket
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/ssh-session",
    response_model=SSHSessionResponse,
    summary="Create a single-use SSH WebSocket session token",
    dependencies=[Depends(require_operator_or_above)],
)
@limiter.limit("10/minute")
async def open_ssh_session(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    request: Request,
    body: SSHSessionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SSHSessionResponse:
    """
    Generates a single-use token (120s TTL) stored in Redis that authorises
    the WebSocket SSH relay to accept a connection for this device.

    Requires operator role or above.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    await _get_device(db, tenant_id, device_id)
    source_ip = _source_ip(request)

    # TODO(defense-in-depth): No API-side SSH session count check is performed here.
    # SSH session limits (per-user, per-device, global) are enforced at the poller/SSH
    # relay level on WebSocket connect. There is currently no NATS subject that exposes
    # SSH session counts to the API (tunnel.status.list only covers WinBox tunnels).
    # When such a subject is added, query it here before issuing the token and raise
    # HTTPException(429) if limits are exceeded, providing earlier feedback to the client.

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "ssh_session_open",
            resource_type="device",
            resource_id=str(device_id),
            device_id=device_id,
            details={"source_ip": source_ip, "cols": body.cols, "rows": body.rows},
            ip_address=source_ip,
        )
    except Exception:
        pass

    token = secrets.token_urlsafe(32)
    token_payload = json.dumps(
        {
            "device_id": str(device_id),
            "tenant_id": str(tenant_id),
            "user_id": str(current_user.user_id),
            "source_ip": source_ip,
            "cols": body.cols,
            "rows": body.rows,
            "created_at": int(time.time()),
        }
    )

    try:
        rd = await _get_redis()
        await rd.setex(f"ssh:token:{token}", 120, token_payload)
    except Exception as exc:
        logger.error("Redis setex failed for SSH token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Session store unavailable"
        )

    return SSHSessionResponse(
        token=token,
        websocket_url=f"/ws/ssh?token={token}",
    )


# ---------------------------------------------------------------------------
# DELETE /winbox-session/{tunnel_id} — Close a WinBox tunnel (idempotent)
# ---------------------------------------------------------------------------


@router.delete(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-session/{tunnel_id}",
    summary="Close a WinBox tunnel",
    dependencies=[Depends(require_operator_or_above)],
)
async def close_winbox_session(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tunnel_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Instructs the poller to close the given WinBox tunnel.
    Idempotent — does not error if the tunnel is already closed.
    Requires operator role or above.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    source_ip = _source_ip(request)

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "winbox_tunnel_close",
            resource_type="device",
            resource_id=str(device_id),
            device_id=device_id,
            details={"tunnel_id": tunnel_id, "source_ip": source_ip},
            ip_address=source_ip,
        )
    except Exception:
        pass

    try:
        nc = await _get_nats()
        payload = json.dumps({"tunnel_id": tunnel_id}).encode()
        await nc.request("tunnel.close", payload, timeout=10)
    except Exception:
        # Idempotent — tunnel may already be closed or poller unavailable
        pass

    return {"status": "closed"}


# ---------------------------------------------------------------------------
# GET /sessions — List active WinBox tunnels and SSH sessions
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/sessions",
    response_model=ActiveSessionsResponse,
    summary="List active WinBox tunnels and SSH sessions for a device",
    dependencies=[Depends(require_operator_or_above)],
)
async def list_sessions(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActiveSessionsResponse:
    """
    Queries the poller via NATS for active WinBox tunnels for this device.
    SSH sessions are not tracked server-side (token-based, single-use).
    Requires operator role or above.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    tunnels: list[TunnelStatusItem] = []
    try:
        nc = await _get_nats()
        payload = json.dumps({"device_id": str(device_id), "tenant_id": str(tenant_id)}).encode()
        msg = await nc.request("tunnel.status.list", payload, timeout=10)
        raw = json.loads(msg.data)
        if isinstance(raw, list):
            tunnels = [TunnelStatusItem(**item) for item in raw]
    except Exception as exc:
        logger.warning("tunnel.status.list NATS request failed: %s", exc)
        # Return empty list rather than error — poller may be unavailable

    # Query Redis for remote winbox (browser) sessions for this device
    remote_winbox: list[RemoteWinboxSessionItem] = []
    try:
        rd = await _get_redis()
        pattern = f"winbox-remote:{device_id}:*"
        cursor, keys = await rd.scan(0, match=pattern, count=100)
        while keys or cursor:
            for key in keys:
                raw = await rd.get(key)
                if raw:
                    data = json.loads(raw)
                    remote_winbox.append(RemoteWinboxSessionItem(**data))
            if not cursor:
                break
            cursor, keys = await rd.scan(cursor, match=pattern, count=100)
    except Exception as exc:
        logger.warning("Redis winbox-remote scan failed: %s", exc)

    return ActiveSessionsResponse(
        winbox_tunnels=tunnels,
        ssh_sessions=[],
        remote_winbox_sessions=remote_winbox,
    )
