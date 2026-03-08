"""NATS JetStream subscriber for device status events from the Go poller.

Subscribes to device.status.> and updates device records in PostgreSQL.
This is a system-level process that needs to update devices across all tenants,
so it uses the admin engine (bypasses RLS).
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

import nats
from nats.js import JetStreamContext
from nats.aio.client import Client as NATSClient
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = logging.getLogger(__name__)

_nats_client: Optional[NATSClient] = None

# Regex for RouterOS uptime strings like "42d14h23m15s", "14h23m15s", "23m15s", "3w2d"
_UPTIME_RE = re.compile(r"(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?")


def _parse_uptime(raw: str) -> int | None:
    """Parse a RouterOS uptime string into total seconds."""
    if not raw:
        return None
    m = _UPTIME_RE.fullmatch(raw)
    if not m:
        return None
    weeks = int(m.group(1) or 0)
    days = int(m.group(2) or 0)
    hours = int(m.group(3) or 0)
    minutes = int(m.group(4) or 0)
    seconds = int(m.group(5) or 0)
    total = weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds
    return total if total > 0 else None


async def on_device_status(msg) -> None:
    """Handle a device.status event published by the Go poller.

    Payload (JSON):
        device_id    (str)  — UUID of the device
        tenant_id    (str)  — UUID of the owning tenant
        status       (str)  — "online" or "offline"
        routeros_version (str | None) — e.g. "7.16.2"
        major_version    (int | None) — e.g. 7
        board_name       (str | None) — e.g. "RB4011iGS+5HacQ2HnD"
        last_seen        (str | None) — ISO-8601 timestamp
    """
    try:
        data = json.loads(msg.data)
        device_id = data.get("device_id")
        status = data.get("status")
        routeros_version = data.get("routeros_version")
        major_version = data.get("major_version")
        board_name = data.get("board_name")
        last_seen_raw = data.get("last_seen")
        serial_number = data.get("serial_number") or None
        firmware_version = data.get("firmware_version") or None
        uptime_seconds = _parse_uptime(data.get("uptime", ""))

        if not device_id or not status:
            logger.warning("Received device.status event with missing device_id or status — skipping")
            await msg.ack()
            return

        # Parse timestamp in Python — asyncpg needs datetime objects, not strings
        last_seen_dt = None
        if last_seen_raw:
            try:
                last_seen_dt = datetime.fromisoformat(last_seen_raw.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                last_seen_dt = datetime.now(timezone.utc)

        async with AdminAsyncSessionLocal() as session:
            await session.execute(
                text(
                    """
                    UPDATE devices SET
                        status = :status,
                        routeros_version = COALESCE(:routeros_version, routeros_version),
                        routeros_major_version = COALESCE(:major_version, routeros_major_version),
                        model = COALESCE(:board_name, model),
                        serial_number = COALESCE(:serial_number, serial_number),
                        firmware_version = COALESCE(:firmware_version, firmware_version),
                        uptime_seconds = COALESCE(:uptime_seconds, uptime_seconds),
                        last_seen = COALESCE(:last_seen, last_seen),
                        updated_at = NOW()
                    WHERE id = CAST(:device_id AS uuid)
                    """
                ),
                {
                    "status": status,
                    "routeros_version": routeros_version,
                    "major_version": major_version,
                    "board_name": board_name,
                    "serial_number": serial_number,
                    "firmware_version": firmware_version,
                    "uptime_seconds": uptime_seconds,
                    "last_seen": last_seen_dt,
                    "device_id": device_id,
                },
            )
            await session.commit()

        # Alert evaluation for offline/online status changes — non-fatal
        try:
            from app.services import alert_evaluator
            if status == "offline":
                await alert_evaluator.evaluate_offline(device_id, data.get("tenant_id", ""))
            elif status == "online":
                await alert_evaluator.evaluate_online(device_id, data.get("tenant_id", ""))
        except Exception as e:
            logger.warning("Alert evaluation failed for device %s status=%s: %s", device_id, status, e)

        logger.info(
            "Device status updated",
            extra={
                "device_id": device_id,
                "status": status,
                "routeros_version": routeros_version,
            },
        )
        await msg.ack()

    except Exception as exc:
        logger.error(
            "Failed to process device.status event: %s",
            exc,
            exc_info=True,
        )
        try:
            await msg.nak()
        except Exception:
            pass  # If NAK also fails, NATS will redeliver after ack_wait


async def _subscribe_with_retry(js: JetStreamContext) -> None:
    """Subscribe to device.status.> with durable consumer, retrying if stream not ready."""
    max_attempts = 6  # ~30 seconds at 5s intervals
    for attempt in range(1, max_attempts + 1):
        try:
            await js.subscribe(
                "device.status.>",
                cb=on_device_status,
                durable="api-status-consumer",
                stream="DEVICE_EVENTS",
            )
            logger.info("NATS: subscribed to device.status.> (durable: api-status-consumer)")
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream DEVICE_EVENTS not ready (attempt %d/%d): %s — retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on device.status.> after %d attempts: %s — API will run without real-time status updates",
                    max_attempts,
                    exc,
                )
                return


async def start_nats_subscriber() -> Optional[NATSClient]:
    """Connect to NATS and start the device.status.> subscription.

    Returns the NATS connection (must be passed to stop_nats_subscriber on shutdown).
    Raises on fatal connection errors after retry exhaustion.
    """
    global _nats_client

    logger.info("NATS: connecting to %s", settings.NATS_URL)

    nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,  # reconnect forever (pod-to-pod transient failures)
        reconnect_time_wait=2,
        error_cb=_on_error,
        reconnected_cb=_on_reconnected,
        disconnected_cb=_on_disconnected,
    )

    logger.info("NATS: connected to %s", settings.NATS_URL)

    js = nc.jetstream()
    await _subscribe_with_retry(js)

    _nats_client = nc
    return nc


async def stop_nats_subscriber(nc: Optional[NATSClient]) -> None:
    """Drain and close the NATS connection gracefully."""
    if nc is None:
        return
    try:
        logger.info("NATS: draining connection...")
        await nc.drain()
        logger.info("NATS: connection closed")
    except Exception as exc:
        logger.warning("NATS: error during drain: %s", exc)
        try:
            await nc.close()
        except Exception:
            pass


async def _on_error(exc: Exception) -> None:
    logger.error("NATS error: %s", exc)


async def _on_reconnected() -> None:
    logger.info("NATS: reconnected")


async def _on_disconnected() -> None:
    logger.warning("NATS: disconnected")
