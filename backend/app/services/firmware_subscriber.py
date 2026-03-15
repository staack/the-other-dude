"""NATS JetStream subscriber for device firmware events from the Go poller.

Subscribes to device.firmware.> and:
1. Updates devices.routeros_version and devices.architecture from poller data
2. Upserts firmware_versions table with latest version per architecture/channel

Uses AdminAsyncSessionLocal (superuser bypass RLS) so firmware data from any
tenant can be written without setting app.current_tenant.
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

_firmware_client: Optional[NATSClient] = None


async def on_device_firmware(msg) -> None:
    """Handle a device.firmware event published by the Go poller.

    Payload (JSON):
        device_id          (str)  -- UUID of the device
        tenant_id          (str)  -- UUID of the owning tenant
        installed_version  (str)  -- currently installed RouterOS version
        latest_version     (str)  -- latest available version (may be empty)
        channel            (str)  -- firmware channel ("stable", "long-term")
        status             (str)  -- "New version is available", etc.
        architecture       (str)  -- CPU architecture (arm, arm64, mipsbe, etc.)
    """
    try:
        data = json.loads(msg.data)
        device_id = data.get("device_id")
        _tenant_id = data.get("tenant_id")
        architecture = data.get("architecture")
        installed_version = data.get("installed_version")
        latest_version = data.get("latest_version")
        channel = data.get("channel", "stable")

        if not device_id:
            logger.warning("device.firmware event missing device_id — skipping")
            await msg.ack()
            return

        async with AdminAsyncSessionLocal() as session:
            # Update device routeros_version and architecture from poller data
            if architecture or installed_version:
                await session.execute(
                    text("""
                        UPDATE devices
                        SET routeros_version = COALESCE(:installed_ver, routeros_version),
                            architecture = COALESCE(:architecture, architecture),
                            updated_at = NOW()
                        WHERE id = CAST(:device_id AS uuid)
                    """),
                    {
                        "installed_ver": installed_version,
                        "architecture": architecture,
                        "device_id": device_id,
                    },
                )

            # Upsert firmware_versions if we got latest version info
            if latest_version and architecture:
                npk_url = (
                    f"https://download.mikrotik.com/routeros/"
                    f"{latest_version}/routeros-{latest_version}-{architecture}.npk"
                )
                await session.execute(
                    text("""
                        INSERT INTO firmware_versions (id, architecture, channel, version, npk_url, checked_at)
                        VALUES (gen_random_uuid(), :arch, :channel, :version, :url, NOW())
                        ON CONFLICT (architecture, channel, version) DO UPDATE SET checked_at = NOW()
                    """),
                    {
                        "arch": architecture,
                        "channel": channel,
                        "version": latest_version,
                        "url": npk_url,
                    },
                )

            await session.commit()

        logger.debug(
            "device.firmware processed",
            extra={
                "device_id": device_id,
                "architecture": architecture,
                "installed": installed_version,
                "latest": latest_version,
            },
        )
        await msg.ack()

    except Exception as exc:
        logger.error(
            "Failed to process device.firmware event: %s",
            exc,
            exc_info=True,
        )
        try:
            await msg.nak()
        except Exception:
            pass


async def _subscribe_with_retry(js: JetStreamContext) -> None:
    """Subscribe to device.firmware.> with durable consumer, retrying if stream not ready."""
    max_attempts = 6  # ~30 seconds at 5s intervals
    for attempt in range(1, max_attempts + 1):
        try:
            await js.subscribe(
                "device.firmware.>",
                cb=on_device_firmware,
                durable="api-firmware-consumer",
                stream="DEVICE_EVENTS",
            )
            logger.info("NATS: subscribed to device.firmware.> (durable: api-firmware-consumer)")
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream DEVICE_EVENTS not ready for firmware (attempt %d/%d): %s — retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on device.firmware.> after %d attempts: %s — API will run without firmware updates",
                    max_attempts,
                    exc,
                )
                return


async def start_firmware_subscriber() -> Optional[NATSClient]:
    """Connect to NATS and start the device.firmware.> subscription.

    Uses a separate NATS connection from the status and metrics subscribers.

    Returns the NATS connection (must be passed to stop_firmware_subscriber on shutdown).
    Raises on fatal connection errors after retry exhaustion.
    """
    global _firmware_client

    logger.info("NATS firmware: connecting to %s", settings.NATS_URL)

    nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,
        reconnect_time_wait=2,
        error_cb=_on_error,
        reconnected_cb=_on_reconnected,
        disconnected_cb=_on_disconnected,
    )

    logger.info("NATS firmware: connected to %s", settings.NATS_URL)

    js = nc.jetstream()
    await _subscribe_with_retry(js)

    _firmware_client = nc
    return nc


async def stop_firmware_subscriber(nc: Optional[NATSClient]) -> None:
    """Drain and close the firmware NATS connection gracefully."""
    if nc is None:
        return
    try:
        logger.info("NATS firmware: draining connection...")
        await nc.drain()
        logger.info("NATS firmware: connection closed")
    except Exception as exc:
        logger.warning("NATS firmware: error during drain: %s", exc)
        try:
            await nc.close()
        except Exception:
            pass


async def _on_error(exc: Exception) -> None:
    logger.error("NATS firmware error: %s", exc)


async def _on_reconnected() -> None:
    logger.info("NATS firmware: reconnected")


async def _on_disconnected() -> None:
    logger.warning("NATS firmware: disconnected")
