"""NATS JetStream subscriber for device interface data.

Subscribes to device.interfaces.> on the DEVICE_EVENTS stream and upserts
per-interface rows into the device_interfaces table for MAC-to-device
resolution during link discovery.

Uses AdminAsyncSessionLocal (superuser bypass RLS) since interface data
arrives from the Go poller without tenant context in the DB session.
"""

import asyncio
import json
import logging
from typing import Optional

import nats
from nats.js import JetStreamContext
from nats.aio.client import Client as NATSClient
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = logging.getLogger(__name__)

_interface_client: Optional[NATSClient] = None


# =============================================================================
# MAIN MESSAGE HANDLER
# =============================================================================


async def on_device_interfaces(msg) -> None:
    """Handle a device.interfaces event published by the Go poller.

    Each message contains interface metadata (name, MAC, type, running) for
    a single device. Upserts into device_interfaces using ON CONFLICT so
    existing interfaces are updated rather than duplicated.

    On success, acknowledges the message. On error, NAKs so NATS can redeliver.
    """
    try:
        data = json.loads(msg.data)
        device_id = data.get("device_id")

        if not device_id:
            logger.warning("device.interfaces event missing 'device_id' -- skipping")
            await msg.ack()
            return

        tenant_id = data.get("tenant_id")
        interfaces = data.get("interfaces")

        if not interfaces:
            await msg.ack()
            return

        async with AdminAsyncSessionLocal() as session:
            for iface in interfaces:
                mac_address = iface.get("mac_address", "")
                if not mac_address:
                    continue  # Skip interfaces without MAC (loopback, bridge without MAC)

                await session.execute(
                    text("""
                        INSERT INTO device_interfaces
                            (id, device_id, tenant_id, name, mac_address, type, running, updated_at)
                        VALUES
                            (gen_random_uuid(), :device_id, :tenant_id, :name, :mac_address,
                             :type, :running, NOW())
                        ON CONFLICT (device_id, name)
                        DO UPDATE SET
                            mac_address = EXCLUDED.mac_address,
                            type = EXCLUDED.type,
                            running = EXCLUDED.running,
                            updated_at = NOW()
                    """),
                    {
                        "device_id": device_id,
                        "tenant_id": tenant_id,
                        "name": iface.get("name", ""),
                        "mac_address": mac_address.lower(),
                        "type": iface.get("type", ""),
                        "running": iface.get("running", False),
                    },
                )

            await session.commit()

        logger.debug(
            "device.interfaces processed",
            extra={"device_id": device_id, "count": len(interfaces)},
        )
        await msg.ack()

    except Exception as exc:
        logger.error(
            "Failed to process device.interfaces event: %s",
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
    """Subscribe to device.interfaces.> with durable consumer, retrying if stream not ready."""
    max_attempts = 6  # ~30 seconds at 5s intervals
    for attempt in range(1, max_attempts + 1):
        try:
            await js.subscribe(
                "device.interfaces.>",
                cb=on_device_interfaces,
                durable="api-interface-consumer",
                stream="DEVICE_EVENTS",
            )
            logger.info(
                "NATS: subscribed to device.interfaces.> (durable: api-interface-consumer)"
            )
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream DEVICE_EVENTS not ready (attempt %d/%d): %s -- retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on device.interfaces.> after %d attempts: %s "
                    "-- API will run without interface ingestion",
                    max_attempts,
                    exc,
                )
                return


async def start_interface_subscriber() -> Optional[NATSClient]:
    """Connect to NATS and start the device.interfaces.> subscription.

    Returns the NATS connection (must be passed to stop_interface_subscriber
    on shutdown).
    """
    global _interface_client

    logger.info("NATS device interfaces: connecting to %s", settings.NATS_URL)

    nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,
        reconnect_time_wait=2,
        error_cb=_on_error,
        reconnected_cb=_on_reconnected,
        disconnected_cb=_on_disconnected,
    )

    logger.info("NATS device interfaces: connected to %s", settings.NATS_URL)

    js = nc.jetstream()
    await _subscribe_with_retry(js)

    _interface_client = nc
    return nc


async def stop_interface_subscriber(nc: Optional[NATSClient]) -> None:
    """Drain and close the interface NATS connection gracefully."""
    if nc is None:
        return
    try:
        logger.info("NATS device interfaces: draining connection...")
        await nc.drain()
        logger.info("NATS device interfaces: connection closed")
    except Exception as exc:
        logger.warning("NATS device interfaces: error during drain: %s", exc)
        try:
            await nc.close()
        except Exception:
            pass


async def _on_error(exc: Exception) -> None:
    logger.error("NATS device interfaces error: %s", exc)


async def _on_reconnected() -> None:
    logger.info("NATS device interfaces: reconnected")


async def _on_disconnected() -> None:
    logger.warning("NATS device interfaces: disconnected")
