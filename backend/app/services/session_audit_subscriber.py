"""NATS JetStream subscriber for SSH session end audit events from the Go poller.

Subscribes to audit.session.end.> and writes ssh_session_end audit log entries
with session duration. Uses the existing self-committing audit service.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Optional

import nats
from nats.js import JetStreamContext
from nats.aio.client import Client as NATSClient

from app.config import settings
from app.services.audit_service import log_action

logger = logging.getLogger(__name__)

_session_audit_client: Optional[NATSClient] = None


async def on_session_end(msg) -> None:
    """Handle an audit.session.end event published by the Go poller.

    Payload (JSON):
        session_id  (str) -- UUID of the SSH session
        user_id     (str) -- UUID of the user
        tenant_id   (str) -- UUID of the owning tenant
        device_id   (str) -- UUID of the device
        start_time  (str) -- RFC3339 session start
        end_time    (str) -- RFC3339 session end
        source_ip   (str) -- client IP address
        reason      (str) -- "normal", "idle_timeout", or "shutdown"
    """
    try:
        data = json.loads(msg.data)
        tenant_id = data.get("tenant_id")
        user_id = data.get("user_id")
        device_id = data.get("device_id")

        if not tenant_id or not device_id:
            logger.warning("audit.session.end event missing tenant_id or device_id — skipping")
            await msg.ack()
            return

        start_time = data.get("start_time", "")
        end_time = data.get("end_time", "")
        duration_seconds = None
        if start_time and end_time:
            try:
                t0 = datetime.fromisoformat(start_time)
                t1 = datetime.fromisoformat(end_time)
                duration_seconds = int((t1 - t0).total_seconds())
            except (ValueError, TypeError):
                pass

        await log_action(
            db=None,  # not used by audit_service internally
            tenant_id=uuid.UUID(tenant_id),
            user_id=uuid.UUID(user_id) if user_id else None,
            action="ssh_session_end",
            resource_type="device",
            resource_id=device_id,
            device_id=uuid.UUID(device_id),
            details={
                "session_id": data.get("session_id"),
                "start_time": start_time,
                "end_time": end_time,
                "duration_seconds": duration_seconds,
                "source_ip": data.get("source_ip"),
                "reason": data.get("reason"),
            },
            ip_address=data.get("source_ip"),
        )

        logger.debug(
            "audit.session.end processed",
            extra={
                "session_id": data.get("session_id"),
                "device_id": device_id,
                "duration_seconds": duration_seconds,
            },
        )
        await msg.ack()

    except Exception as exc:
        logger.error(
            "Failed to process audit.session.end event: %s",
            exc,
            exc_info=True,
        )
        try:
            await msg.nak()
        except Exception:
            pass


async def _subscribe_with_retry(js: JetStreamContext) -> None:
    """Subscribe to audit.session.end.> with durable consumer, retrying if stream not ready."""
    max_attempts = 6  # ~30 seconds at 5s intervals
    for attempt in range(1, max_attempts + 1):
        try:
            await js.subscribe(
                "audit.session.end.>",
                cb=on_session_end,
                durable="api-session-audit-consumer",
                stream="DEVICE_EVENTS",
            )
            logger.info(
                "NATS: subscribed to audit.session.end.> (durable: api-session-audit-consumer)"
            )
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream DEVICE_EVENTS not ready for session audit (attempt %d/%d): %s — retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on audit.session.end.> after %d attempts: %s — API will run without session audit",
                    max_attempts,
                    exc,
                )
                return


async def start_session_audit_subscriber() -> Optional[NATSClient]:
    """Connect to NATS and start the audit.session.end.> subscription.

    Returns the NATS connection (must be passed to stop_session_audit_subscriber on shutdown).
    """
    global _session_audit_client

    logger.info("NATS session audit: connecting to %s", settings.NATS_URL)

    nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,
        reconnect_time_wait=2,
        error_cb=_on_error,
        reconnected_cb=_on_reconnected,
        disconnected_cb=_on_disconnected,
    )

    logger.info("NATS session audit: connected to %s", settings.NATS_URL)

    js = nc.jetstream()
    await _subscribe_with_retry(js)

    _session_audit_client = nc
    return nc


async def stop_session_audit_subscriber(nc: Optional[NATSClient]) -> None:
    """Drain and close the session audit NATS connection gracefully."""
    if nc is None:
        return
    try:
        logger.info("NATS session audit: draining connection...")
        await nc.drain()
        logger.info("NATS session audit: connection closed")
    except Exception as exc:
        logger.warning("NATS session audit: error during drain: %s", exc)
        try:
            await nc.close()
        except Exception:
            pass


async def _on_error(exc: Exception) -> None:
    logger.error("NATS session audit error: %s", exc)


async def _on_reconnected() -> None:
    logger.info("NATS session audit: reconnected")


async def _on_disconnected() -> None:
    logger.warning("NATS session audit: disconnected")
