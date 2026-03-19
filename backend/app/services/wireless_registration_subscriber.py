"""NATS JetStream subscriber for per-client wireless registration events.

Subscribes to wireless.registrations.> on the WIRELESS_REGISTRATIONS stream
and inserts per-client rows into the wireless_registrations hypertable and
RF monitor stats into the rf_monitor_stats hypertable.

Uses AdminAsyncSessionLocal (superuser bypass RLS) since registration data
arrives from the Go poller without tenant context in the DB session.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import nats
from nats.js import JetStreamContext
from nats.aio.client import Client as NATSClient
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = logging.getLogger(__name__)

_wireless_reg_client: Optional[NATSClient] = None


# =============================================================================
# HELPERS
# =============================================================================


def _parse_timestamp(val: str | None) -> datetime:
    """Parse an ISO 8601 / RFC 3339 timestamp string into a datetime object."""
    if not val:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)


# =============================================================================
# INSERT HANDLERS
# =============================================================================


async def _insert_registrations(session, data: dict) -> None:
    """Insert per-client wireless registration rows into wireless_registrations."""
    registrations = data.get("registrations")
    if not registrations:
        return

    device_id = data.get("device_id")
    tenant_id = data.get("tenant_id")
    collected_at = _parse_timestamp(data.get("collected_at"))

    for reg in registrations:
        await session.execute(
            text("""
                INSERT INTO wireless_registrations
                    (time, device_id, tenant_id, interface, mac_address, signal_strength,
                     tx_ccq, tx_rate, rx_rate, uptime, distance, last_ip,
                     tx_signal_strength, bytes)
                VALUES
                    (:time, :device_id, :tenant_id, :interface, :mac_address, :signal_strength,
                     :tx_ccq, :tx_rate, :rx_rate, :uptime, :distance, :last_ip,
                     :tx_signal_strength, :bytes)
            """),
            {
                "time": collected_at,
                "device_id": device_id,
                "tenant_id": tenant_id,
                "interface": reg.get("interface"),
                "mac_address": reg.get("mac_address"),
                "signal_strength": reg.get("signal_strength"),
                "tx_ccq": reg.get("tx_ccq"),
                "tx_rate": reg.get("tx_rate"),
                "rx_rate": reg.get("rx_rate"),
                "uptime": reg.get("uptime"),
                "distance": reg.get("distance"),
                "last_ip": reg.get("last_ip"),
                "tx_signal_strength": reg.get("tx_signal_strength"),
                "bytes": reg.get("bytes"),
            },
        )


async def _insert_rf_stats(session, data: dict) -> None:
    """Insert per-interface RF monitor stats into rf_monitor_stats."""
    rf_stats = data.get("rf_stats")
    if not rf_stats:
        return

    device_id = data.get("device_id")
    tenant_id = data.get("tenant_id")
    collected_at = _parse_timestamp(data.get("collected_at"))

    for stat in rf_stats:
        await session.execute(
            text("""
                INSERT INTO rf_monitor_stats
                    (time, device_id, tenant_id, interface, noise_floor, channel_width,
                     tx_power, registered_clients)
                VALUES
                    (:time, :device_id, :tenant_id, :interface, :noise_floor, :channel_width,
                     :tx_power, :registered_clients)
            """),
            {
                "time": collected_at,
                "device_id": device_id,
                "tenant_id": tenant_id,
                "interface": stat.get("interface"),
                "noise_floor": stat.get("noise_floor"),
                "channel_width": stat.get("channel_width"),
                "tx_power": stat.get("tx_power"),
                "registered_clients": stat.get("registered_clients"),
            },
        )


# =============================================================================
# MAIN MESSAGE HANDLER
# =============================================================================


async def on_wireless_registration(msg) -> None:
    """Handle a wireless.registrations event published by the Go poller.

    Each message contains per-client registration data and RF monitor stats
    for a single device. Inserts into both wireless_registrations and
    rf_monitor_stats hypertables.

    On success, acknowledges the message. On error, NAKs so NATS can redeliver.
    """
    try:
        data = json.loads(msg.data)
        device_id = data.get("device_id")

        if not device_id:
            logger.warning("wireless.registrations event missing 'device_id' — skipping")
            await msg.ack()
            return

        async with AdminAsyncSessionLocal() as session:
            await _insert_registrations(session, data)
            await _insert_rf_stats(session, data)
            await session.commit()

        logger.debug(
            "wireless.registrations processed",
            extra={"device_id": device_id},
        )
        await msg.ack()

    except Exception as exc:
        logger.error(
            "Failed to process wireless.registrations event: %s",
            exc,
            exc_info=True,
        )
        try:
            await msg.nak()
        except Exception:
            pass  # If NAK also fails, NATS will redeliver after ack_wait


# =============================================================================
# SUBSCRIPTION SETUP
# =============================================================================


async def _subscribe_with_retry(js: JetStreamContext) -> None:
    """Subscribe to wireless.registrations.> with durable consumer, retrying if stream not ready."""
    max_attempts = 6  # ~30 seconds at 5s intervals
    for attempt in range(1, max_attempts + 1):
        try:
            await js.subscribe(
                "wireless.registrations.>",
                cb=on_wireless_registration,
                durable="api-wireless-reg-consumer",
                stream="WIRELESS_REGISTRATIONS",
            )
            logger.info(
                "NATS: subscribed to wireless.registrations.> (durable: api-wireless-reg-consumer)"
            )
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream WIRELESS_REGISTRATIONS not ready (attempt %d/%d): %s — retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on wireless.registrations.> after %d attempts: %s "
                    "— API will run without wireless registration ingestion",
                    max_attempts,
                    exc,
                )
                return


async def start_wireless_registration_subscriber() -> Optional[NATSClient]:
    """Connect to NATS and start the wireless.registrations.> subscription.

    Returns the NATS connection (must be passed to stop_wireless_registration_subscriber
    on shutdown).
    """
    global _wireless_reg_client

    logger.info("NATS wireless registrations: connecting to %s", settings.NATS_URL)

    nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,
        reconnect_time_wait=2,
        error_cb=_on_error,
        reconnected_cb=_on_reconnected,
        disconnected_cb=_on_disconnected,
    )

    logger.info("NATS wireless registrations: connected to %s", settings.NATS_URL)

    js = nc.jetstream()
    await _subscribe_with_retry(js)

    _wireless_reg_client = nc
    return nc


async def stop_wireless_registration_subscriber(nc: Optional[NATSClient]) -> None:
    """Drain and close the wireless registration NATS connection gracefully."""
    if nc is None:
        return
    try:
        logger.info("NATS wireless registrations: draining connection...")
        await nc.drain()
        logger.info("NATS wireless registrations: connection closed")
    except Exception as exc:
        logger.warning("NATS wireless registrations: error during drain: %s", exc)
        try:
            await nc.close()
        except Exception:
            pass


async def _on_error(exc: Exception) -> None:
    logger.error("NATS wireless registrations error: %s", exc)


async def _on_reconnected() -> None:
    logger.info("NATS wireless registrations: reconnected")


async def _on_disconnected() -> None:
    logger.warning("NATS wireless registrations: disconnected")
