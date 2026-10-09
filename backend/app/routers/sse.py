"""SSE streaming endpoint for real-time event delivery.

Provides a Server-Sent Events endpoint per tenant that streams device status,
alert, config push, and firmware progress events in real time.  Authentication
is via a short-lived, single-use exchange token (obtained from POST /auth/sse-token)
to avoid exposing the full JWT in query parameters.
"""

import asyncio
import json
import uuid
from typing import AsyncGenerator, Optional

import nats.errors
import redis.asyncio as aioredis
import structlog
from fastapi import APIRouter, HTTPException, Query, Request, status
from sse_starlette.sse import EventSourceResponse, ServerSentEvent
from starlette.background import BackgroundTask

from app.services.sse_manager import SSEConnectionManager

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["sse"])

# ─── Redis for SSE token validation ───────────────────────────────────────────

_redis: aioredis.Redis | None = None


async def _get_sse_redis() -> aioredis.Redis:
    """Lazily initialise and return the SSE Redis client."""
    global _redis
    if _redis is None:
        from app.config import settings

        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def _validate_sse_token(token: str) -> dict:
    """Validate a short-lived SSE exchange token via Redis.

    The token is single-use: retrieved and deleted atomically with GETDEL.
    If the token is not found (expired or already used), raises 401.

    Args:
        token: SSE exchange token string (from query param).

    Returns:
        Dict with user_id, tenant_id, and role.

    Raises:
        HTTPException 401: If the token is invalid, expired, or already used.
    """
    redis = await _get_sse_redis()
    key = f"sse_token:{token}"
    data = await redis.getdel(key)  # Single-use: delete on retrieval
    if not data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired SSE token",
        )
    return json.loads(data)


@router.get(
    "/tenants/{tenant_id}/events/stream",
    summary="SSE event stream for real-time tenant events",
    response_class=EventSourceResponse,
)
async def event_stream(
    request: Request,
    tenant_id: uuid.UUID,
    token: str = Query(
        ..., description="Short-lived SSE exchange token (from POST /auth/sse-token)"
    ),
) -> EventSourceResponse:
    """Stream real-time events for a tenant via Server-Sent Events.

    Event types: device_status, alert_fired, alert_resolved, config_push,
    firmware_progress, metric_update.

    Sends heartbeat comments every 15 seconds on idle connections.  The
    stream ends (and the browser reconnects) when the NATS connection is
    lost for good.  Last-Event-ID is logged but not replayed.
    """
    # Validate exchange token from query parameter (single-use, 30s TTL)
    user_context = await _validate_sse_token(token)
    user_role = user_context.get("role", "")
    user_tenant_id = user_context.get("tenant_id")
    user_id = user_context.get("user_id", "")

    # Authorization: user must belong to the requested tenant or be super_admin
    if user_role != "super_admin" and (
        user_tenant_id is None or str(user_tenant_id) != str(tenant_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    # super_admin receives events from ALL tenants (tenant_id filter = None)
    filter_tenant_id: Optional[str] = None if user_role == "super_admin" else str(tenant_id)

    # Generate unique connection ID
    connection_id = f"sse-{uuid.uuid4().hex[:12]}"

    # Logged for diagnostics; see SSEConnectionManager.connect for why it is not replayed.
    last_event_id = request.headers.get("Last-Event-ID")

    logger.info(
        "sse.stream_requested",
        connection_id=connection_id,
        tenant_id=str(tenant_id),
        user_id=user_id,
        role=user_role,
        last_event_id=last_event_id,
    )

    manager = SSEConnectionManager()
    try:
        queue = await manager.connect(
            connection_id=connection_id,
            tenant_id=filter_tenant_id,
            last_event_id=last_event_id,
        )
    except (nats.errors.Error, OSError, RuntimeError) as exc:
        # Broker outage: a 503 lets the browser retry with back-off instead
        # of a traceback-producing 500 per attempt.
        logger.warning(
            "sse.unavailable",
            connection_id=connection_id,
            error=str(exc) or exc.__class__.__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Event stream unavailable",
        ) from exc

    async def event_generator() -> AsyncGenerator[ServerSentEvent, None]:
        """Yield SSE events from the queue with 15s heartbeat on idle."""
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Send heartbeat comment to keep connection alive
                    yield ServerSentEvent(comment="heartbeat")
                    continue
                if event is None:
                    # NATS gone for good: end the stream so the browser
                    # reconnects (see SSEConnectionManager).
                    break
                yield ServerSentEvent(
                    data=event["data"],
                    event=event["event"],
                    id=event["id"],
                )
        finally:
            try:
                await manager.disconnect()
            finally:
                # disconnect() may re-raise CancelledError under sse-starlette's
                # cancelled scope; the teardown itself completes regardless.
                logger.info("sse.stream_closed", connection_id=connection_id)

    async def on_client_close(_message: dict) -> None:
        # sse-starlette runs this on http.disconnect before cancelling the
        # stream's scope, so the teardown gets an un-cancelled context.
        await manager.disconnect()

    # Three idempotent triggers: the close hook above (client disconnect), the
    # generator's finally (normal end, errors, shutdown) and the background
    # task, which sse-starlette awaits after the cancelled scope has exited.
    return EventSourceResponse(
        event_generator(),
        client_close_handler_callable=on_client_close,
        background=BackgroundTask(manager.disconnect),
    )
