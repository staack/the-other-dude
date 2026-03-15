"""
Remote WinBox (Browser) endpoints — Xpra-based in-browser WinBox sessions.

All routes are tenant-scoped under /api/tenants/{tenant_id}/devices/{device_id}.
RBAC: operator+ required for all endpoints.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
import nats
import redis.asyncio as aioredis
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.rbac import require_operator_or_above
from app.middleware.rate_limit import limiter
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.device import Device
from app.schemas.winbox_remote import (
    RemoteWinboxCreateRequest,
    RemoteWinboxSessionResponse,
    RemoteWinboxState,
    RemoteWinboxStatusResponse,
    RemoteWinboxTerminateResponse,
)
from app.services.audit_service import log_action
from app.services.winbox_remote import (
    WorkerCapacityError,
    WorkerLaunchError,
    create_session as worker_create_session,
    get_session as worker_get_session,
    terminate_session as worker_terminate_session,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["winbox-remote"])

REDIS_PREFIX = "winbox-remote:"
RATE_PREFIX = "winbox-remote-rate:"

# ---------------------------------------------------------------------------
# Lazy NATS and Redis clients (same pattern as remote_access.py)
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


async def _check_rate_limit(user_id: uuid.UUID) -> None:
    """Allow max 3 session creates per 5 minutes per user."""
    rd = await _get_redis()
    key = f"{RATE_PREFIX}{user_id}"
    count = await rd.incr(key)
    if count == 1:
        await rd.expire(key, 300)
    if count > 3:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many session requests. Try again later.",
        )


async def _get_session_from_redis(session_id: str) -> Optional[dict]:
    rd = await _get_redis()
    raw = await rd.get(f"{REDIS_PREFIX}{session_id}")
    if raw is None:
        return None
    return json.loads(raw)


async def _save_session_to_redis(session_id: str, data: dict, ttl: int = 14400) -> None:
    rd = await _get_redis()
    await rd.setex(f"{REDIS_PREFIX}{session_id}", ttl, json.dumps(data, default=str))


async def _delete_session_from_redis(session_id: str) -> None:
    rd = await _get_redis()
    await rd.delete(f"{REDIS_PREFIX}{session_id}")


async def _open_tunnel(device_id: uuid.UUID, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Open a TCP tunnel to device port 8291 via NATS request-reply."""
    payload = json.dumps(
        {
            "device_id": str(device_id),
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "target_port": 8291,
        }
    ).encode()

    try:
        nc = await _get_nats()
        msg = await nc.request("tunnel.open", payload, timeout=10)
    except Exception as exc:
        logger.error("NATS tunnel.open failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Tunnel service unavailable",
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

    return data


async def _close_tunnel(tunnel_id: str) -> None:
    """Close a tunnel via NATS — idempotent."""
    try:
        nc = await _get_nats()
        payload = json.dumps({"tunnel_id": tunnel_id}).encode()
        await nc.request("tunnel.close", payload, timeout=10)
    except Exception:
        pass  # Idempotent — tunnel may already be closed


# ---------------------------------------------------------------------------
# POST — Create a Remote WinBox (Browser) session
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions",
    response_model=RemoteWinboxSessionResponse,
    summary="Create a Remote WinBox browser session",
    dependencies=[Depends(require_operator_or_above)],
)
@limiter.limit("10/minute")
async def create_winbox_remote_session(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    request: Request,
    body: RemoteWinboxCreateRequest = RemoteWinboxCreateRequest(),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RemoteWinboxSessionResponse:
    """
    Create an Xpra-based WinBox session accessible via WebSocket in the browser.

    Flow: auth -> tenant check -> device exists -> duplicate check -> rate limit ->
    credential decrypt -> tunnel open -> worker create -> Redis save -> audit log.
    Full rollback on failure.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    device = await _get_device(db, tenant_id, device_id)
    source_ip = _source_ip(request)

    # Check for duplicate active session for this user+device
    rd = await _get_redis()
    cursor = "0"
    while True:
        cursor, keys = await rd.scan(cursor=cursor, match=f"{REDIS_PREFIX}*", count=100)
        for key in keys:
            raw = await rd.get(key)
            if raw is None:
                continue
            try:
                sess = json.loads(raw)
            except Exception:
                continue
            if (
                sess.get("device_id") == str(device_id)
                and sess.get("user_id") == str(current_user.user_id)
                and sess.get("status") in ("creating", "active", "grace")
            ):
                # Verify the worker actually has this session — if not, clean up
                # the stale Redis entry instead of blocking the user.
                stale_sid = sess.get("session_id", "")
                try:
                    worker_info = await worker_get_session(stale_sid)
                except Exception:
                    worker_info = None
                if worker_info is None:
                    logger.warning("Cleaning stale Redis session %s (worker 404)", stale_sid)
                    tunnel_id = sess.get("tunnel_id")
                    if tunnel_id:
                        await _close_tunnel(tunnel_id)
                    await _delete_session_from_redis(stale_sid)
                    continue
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Active session already exists for this device",
                )
        if cursor == "0" or cursor == 0:
            break

    # Rate limit
    await _check_rate_limit(current_user.user_id)

    # Decrypt device credentials
    try:
        from app.services.crypto import decrypt_credentials_hybrid

        creds_json = await decrypt_credentials_hybrid(
            transit_ciphertext=device.encrypted_credentials_transit,
            legacy_ciphertext=device.encrypted_credentials,
            tenant_id=str(tenant_id),
            legacy_key=settings.get_encryption_key_bytes(),
        )
        creds = json.loads(creds_json)
        username = creds.get("username", "")
        password = creds.get("password", "")
    except Exception as exc:
        logger.error("Failed to decrypt credentials for device %s: %s", device_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve device credentials",
        )

    # Open tunnel to device
    tunnel_data = None
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    try:
        tunnel_data = await _open_tunnel(device_id, tenant_id, current_user.user_id)
        tunnel_id = tunnel_data.get("tunnel_id", "")
        tunnel_port = tunnel_data.get("local_port")

        if not isinstance(tunnel_port, int) or not (49000 <= tunnel_port <= 49100):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Invalid port allocation from tunnel service",
            )

        # Create session on worker
        # Tunnel listener runs on the poller container, reachable via Docker DNS
        try:
            worker_resp = await worker_create_session(
                session_id=session_id,
                device_ip="tod_poller",
                device_port=tunnel_port,
                username=username,
                password=password,
                idle_timeout_seconds=body.idle_timeout_seconds,
                max_lifetime_seconds=body.max_lifetime_seconds,
            )
        except WorkerCapacityError:
            await _close_tunnel(tunnel_id)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No capacity for new sessions",
            )
        except WorkerLaunchError as exc:
            await _close_tunnel(tunnel_id)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Session launch failed: {exc}",
            )
        finally:
            # Zero credentials
            username = ""  # noqa: F841
            password = ""  # noqa: F841

        expires_at = datetime.fromisoformat(worker_resp.get("expires_at", now.isoformat()))
        max_expires_at = datetime.fromisoformat(worker_resp.get("max_expires_at", now.isoformat()))

        # Save session to Redis
        session_data = {
            "session_id": session_id,
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "user_id": str(current_user.user_id),
            "tunnel_id": tunnel_id,
            "tunnel_port": tunnel_port,
            "status": RemoteWinboxState.active.value,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "max_expires_at": max_expires_at.isoformat(),
            "idle_timeout_seconds": body.idle_timeout_seconds,
            "max_lifetime_seconds": body.max_lifetime_seconds,
            "xpra_ws_port": worker_resp.get("xpra_ws_port"),
        }
        await _save_session_to_redis(session_id, session_data, ttl=body.max_lifetime_seconds + 60)

        # Audit log (fire-and-forget)
        try:
            await log_action(
                db,
                tenant_id,
                current_user.user_id,
                "winbox_remote_session_create",
                resource_type="device",
                resource_id=str(device_id),
                device_id=device_id,
                details={"session_id": session_id, "source_ip": source_ip},
                ip_address=source_ip,
            )
        except Exception:
            pass

        ws_path = (
            f"/api/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions/{session_id}/ws"
        )

        return RemoteWinboxSessionResponse(
            session_id=uuid.UUID(session_id),
            websocket_path=ws_path,
            expires_at=expires_at,
            max_expires_at=max_expires_at,
            idle_timeout_seconds=body.idle_timeout_seconds,
            max_lifetime_seconds=body.max_lifetime_seconds,
            xpra_ws_port=worker_resp.get("xpra_ws_port"),
        )

    except HTTPException:
        raise
    except Exception as exc:
        # Full rollback
        logger.error("Unexpected error creating winbox remote session: %s", exc)
        if tunnel_data and tunnel_data.get("tunnel_id"):
            await _close_tunnel(tunnel_data["tunnel_id"])
        await _delete_session_from_redis(session_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Session creation failed",
        )


# ---------------------------------------------------------------------------
# GET — Session status
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions/{session_id}",
    response_model=RemoteWinboxStatusResponse,
    summary="Get Remote WinBox session status",
    dependencies=[Depends(require_operator_or_above)],
)
async def get_winbox_remote_session(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RemoteWinboxStatusResponse:
    await _check_tenant_access(current_user, tenant_id, db)

    sess = await _get_session_from_redis(str(session_id))
    if sess is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if sess.get("tenant_id") != str(tenant_id) or sess.get("device_id") != str(device_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    return RemoteWinboxStatusResponse(
        session_id=uuid.UUID(sess["session_id"]),
        status=RemoteWinboxState(sess.get("status", "active")),
        created_at=datetime.fromisoformat(sess["created_at"]),
        expires_at=datetime.fromisoformat(sess["expires_at"]),
        max_expires_at=datetime.fromisoformat(sess["max_expires_at"]),
        idle_timeout_seconds=sess.get("idle_timeout_seconds", 600),
        max_lifetime_seconds=sess.get("max_lifetime_seconds", 7200),
        xpra_ws_port=sess.get("xpra_ws_port"),
    )


# ---------------------------------------------------------------------------
# GET — List sessions for a device
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions",
    response_model=list[RemoteWinboxStatusResponse],
    summary="List Remote WinBox sessions for a device",
    dependencies=[Depends(require_operator_or_above)],
)
async def list_winbox_remote_sessions(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RemoteWinboxStatusResponse]:
    await _check_tenant_access(current_user, tenant_id, db)

    sessions = []
    rd = await _get_redis()
    cursor = "0"
    while True:
        cursor, keys = await rd.scan(cursor=cursor, match=f"{REDIS_PREFIX}*", count=100)
        for key in keys:
            raw = await rd.get(key)
            if raw is None:
                continue
            try:
                sess = json.loads(raw)
            except Exception:
                continue
            if sess.get("tenant_id") == str(tenant_id) and sess.get("device_id") == str(device_id):
                sessions.append(
                    RemoteWinboxStatusResponse(
                        session_id=uuid.UUID(sess["session_id"]),
                        status=RemoteWinboxState(sess.get("status", "active")),
                        created_at=datetime.fromisoformat(sess["created_at"]),
                        expires_at=datetime.fromisoformat(sess["expires_at"]),
                        max_expires_at=datetime.fromisoformat(sess["max_expires_at"]),
                        idle_timeout_seconds=sess.get("idle_timeout_seconds", 600),
                        max_lifetime_seconds=sess.get("max_lifetime_seconds", 7200),
                        xpra_ws_port=sess.get("xpra_ws_port"),
                    )
                )
        if cursor == "0" or cursor == 0:
            break

    return sessions


# ---------------------------------------------------------------------------
# DELETE — Terminate session (idempotent)
# ---------------------------------------------------------------------------


@router.delete(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions/{session_id}",
    response_model=RemoteWinboxTerminateResponse,
    summary="Terminate a Remote WinBox session",
    dependencies=[Depends(require_operator_or_above)],
)
async def terminate_winbox_remote_session(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    session_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RemoteWinboxTerminateResponse:
    await _check_tenant_access(current_user, tenant_id, db)
    source_ip = _source_ip(request)

    sess = await _get_session_from_redis(str(session_id))

    # Idempotent — if already gone, return terminated
    if sess is None:
        return RemoteWinboxTerminateResponse(
            session_id=session_id,
            status=RemoteWinboxState.terminated,
            reason="Session already terminated or not found",
        )

    if sess.get("tenant_id") != str(tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Rollback order: worker -> tunnel -> redis -> audit
    await worker_terminate_session(str(session_id))

    tunnel_id = sess.get("tunnel_id")
    if tunnel_id:
        await _close_tunnel(tunnel_id)

    await _delete_session_from_redis(str(session_id))

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "winbox_remote_session_terminate",
            resource_type="device",
            resource_id=str(device_id),
            device_id=device_id,
            details={"session_id": str(session_id), "source_ip": source_ip},
            ip_address=source_ip,
        )
    except Exception:
        pass

    return RemoteWinboxTerminateResponse(
        session_id=session_id,
        status=RemoteWinboxState.terminated,
        reason="Terminated by user",
    )


# ---------------------------------------------------------------------------
# HTTP Proxy — Serve Xpra HTML5 client files from worker
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions/{session_id}/xpra/{path:path}",
    summary="Proxy Xpra HTML5 client files",
    dependencies=[Depends(require_operator_or_above)],
)
@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions/{session_id}/xpra",
    summary="Proxy Xpra HTML5 client (root)",
    dependencies=[Depends(require_operator_or_above)],
)
async def proxy_xpra_html(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    session_id: uuid.UUID,
    request: Request,
    path: str = "",
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Reverse-proxy HTTP requests to the Xpra HTML5 server inside the worker."""
    from starlette.responses import Response

    await _check_tenant_access(current_user, tenant_id, db)

    sess = await _get_session_from_redis(str(session_id))
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if sess.get("tenant_id") != str(tenant_id) or sess.get("device_id") != str(device_id):
        raise HTTPException(status_code=404, detail="Session not found")

    xpra_ws_port = sess.get("xpra_ws_port")
    if not xpra_ws_port:
        raise HTTPException(status_code=503, detail="Xpra port unavailable")

    # Proxy the request to Xpra's built-in HTTP server
    target_url = f"http://tod_winbox_worker:{xpra_ws_port}/{path}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            proxy_resp = await client.get(
                target_url,
                params=dict(request.query_params),
            )
    except Exception as exc:
        logger.error("Xpra HTTP proxy error: %s", exc)
        raise HTTPException(status_code=502, detail="Xpra server unreachable")

    # Forward the response with correct content type
    return Response(
        content=proxy_resp.content,
        status_code=proxy_resp.status_code,
        headers={
            k: v
            for k, v in proxy_resp.headers.items()
            if k.lower() in ("content-type", "cache-control", "content-encoding")
        },
    )


# ---------------------------------------------------------------------------
# WebSocket — Proxy browser <-> Xpra worker
# ---------------------------------------------------------------------------


@router.websocket("/tenants/{tenant_id}/devices/{device_id}/winbox-remote-sessions/{session_id}/ws")
async def winbox_remote_ws_proxy(
    websocket: WebSocket,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    session_id: uuid.UUID,
) -> None:
    """
    Bidirectional WebSocket proxy between the browser and the worker's Xpra
    WebSocket. Authentication via access_token cookie or query param.

    1. Authenticate via cookie/query param token
    2. Validate session in Redis (ownership, status, expiry)
    3. Resolve Xpra WebSocket port from worker
    4. Accept browser WebSocket upgrade
    5. Proxy bidirectionally until close
    """
    # --- Auth: extract token from cookie or query param ---
    token = websocket.cookies.get("access_token") or websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        return

    from app.services.auth import verify_token

    try:
        payload = verify_token(token, expected_type="access")
    except Exception:
        await websocket.close(code=4001, reason="Invalid token")
        return

    user_id_str = payload.get("sub")
    user_tenant_str = payload.get("tenant_id")
    role = payload.get("role")

    if not user_id_str or not role:
        await websocket.close(code=4001, reason="Invalid token payload")
        return

    # Tenant access check
    if role != "super_admin":
        if user_tenant_str != str(tenant_id):
            await websocket.close(code=4003, reason="Tenant access denied")
            return

    # --- Session validation ---
    sess = await _get_session_from_redis(str(session_id))
    if sess is None:
        await websocket.close(code=4004, reason="Session not found")
        return

    if sess.get("tenant_id") != str(tenant_id) or sess.get("device_id") != str(device_id):
        await websocket.close(code=4004, reason="Session not found")
        return

    # Ownership check: user must own the session (or be super_admin)
    if role != "super_admin" and sess.get("user_id") != user_id_str:
        await websocket.close(code=4003, reason="Not your session")
        return

    sess_status = sess.get("status")
    if sess_status not in ("active", "grace"):
        await websocket.close(code=4004, reason=f"Session not active (status={sess_status})")
        return

    # Check max expiry
    max_expires = datetime.fromisoformat(sess["max_expires_at"])
    if datetime.now(timezone.utc) > max_expires:
        await websocket.close(code=4004, reason="Session expired")
        return

    # Resolve Xpra WebSocket port from worker
    xpra_ws_port = sess.get("xpra_ws_port")
    if not xpra_ws_port:
        worker_info = await worker_get_session(str(session_id))
        if not worker_info:
            await websocket.close(code=4004, reason="Worker session not found")
            return
        xpra_ws_port = worker_info.get("xpra_ws_port") or worker_info.get("ws_port")

    if not xpra_ws_port:
        await websocket.close(code=4004, reason="Xpra port unavailable")
        return

    # Update last_client_connect_at in Redis
    sess["last_client_connect_at"] = datetime.now(timezone.utc).isoformat()
    try:
        await _save_session_to_redis(str(session_id), sess)
    except Exception:
        pass

    # Accept browser WebSocket
    await websocket.accept()

    # Connect to worker Xpra WebSocket
    import websockets

    worker_ws_url = f"ws://tod_winbox_worker:{xpra_ws_port}"

    try:
        async with websockets.connect(worker_ws_url) as worker_ws:

            async def browser_to_worker() -> None:
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        await worker_ws.send(data)
                except WebSocketDisconnect:
                    pass
                except Exception:
                    pass

            async def worker_to_browser() -> None:
                try:
                    async for message in worker_ws:
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except Exception:
                    pass

            # Run both directions concurrently
            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(browser_to_worker()),
                    asyncio.create_task(worker_to_browser()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()

    except Exception as exc:
        logger.warning("WebSocket proxy error for session %s: %s", session_id, exc)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
