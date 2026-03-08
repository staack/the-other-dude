"""NATS subscriber for config change events from the Go poller.

Triggers automatic backups when out-of-band config changes are detected,
with 5-minute deduplication to prevent rapid-fire backups.
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select

from app.config import settings
from app.database import AdminAsyncSessionLocal
from app.models.config_backup import ConfigBackupRun
from app.services import backup_service

logger = logging.getLogger(__name__)

DEDUP_WINDOW_MINUTES = 5

_nc: Optional[Any] = None


async def _last_backup_within_dedup_window(device_id: str) -> bool:
    """Check if a backup was created for this device in the last N minutes."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=DEDUP_WINDOW_MINUTES)
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            select(ConfigBackupRun)
            .where(
                ConfigBackupRun.device_id == device_id,
                ConfigBackupRun.created_at > cutoff,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None


async def handle_config_changed(event: dict) -> None:
    """Handle a config change event. Trigger backup with dedup."""
    device_id = event.get("device_id")
    tenant_id = event.get("tenant_id")

    if not device_id or not tenant_id:
        logger.warning("Config change event missing device_id or tenant_id: %s", event)
        return

    # Dedup check
    if await _last_backup_within_dedup_window(device_id):
        logger.info(
            "Config change on device %s — skipping backup (within %dm dedup window)",
            device_id, DEDUP_WINDOW_MINUTES,
        )
        return

    logger.info(
        "Config change detected on device %s (tenant %s): %s -> %s",
        device_id, tenant_id,
        event.get("old_timestamp", "?"),
        event.get("new_timestamp", "?"),
    )

    try:
        async with AdminAsyncSessionLocal() as session:
            await backup_service.run_backup(
                device_id=device_id,
                tenant_id=tenant_id,
                trigger_type="config-change",
                db_session=session,
            )
            await session.commit()
        logger.info("Config-change backup completed for device %s", device_id)
    except Exception as e:
        logger.error("Config-change backup failed for device %s: %s", device_id, e)


async def _on_message(msg) -> None:
    """NATS message handler for config.changed.> subjects."""
    try:
        event = json.loads(msg.data.decode())
        await handle_config_changed(event)
        await msg.ack()
    except Exception as e:
        logger.error("Error handling config change message: %s", e)
        await msg.nak()


async def start_config_change_subscriber() -> Optional[Any]:
    """Connect to NATS and subscribe to config.changed.> events."""
    import nats

    global _nc
    try:
        logger.info("NATS config-change: connecting to %s", settings.NATS_URL)
        _nc = await nats.connect(settings.NATS_URL)
        js = _nc.jetstream()
        await js.subscribe(
            "config.changed.>",
            cb=_on_message,
            durable="api-config-change-consumer",
            stream="DEVICE_EVENTS",
            manual_ack=True,
        )
        logger.info("Config change subscriber started")
        return _nc
    except Exception as e:
        logger.error("Failed to start config change subscriber: %s", e)
        return None


async def stop_config_change_subscriber() -> None:
    """Gracefully close the NATS connection."""
    global _nc
    if _nc:
        await _nc.drain()
        _nc = None
