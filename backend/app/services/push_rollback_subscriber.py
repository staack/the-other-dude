"""NATS subscribers for push rollback (auto) and push alert (manual).

- config.push.rollback.> -> auto-restore for template pushes
- config.push.alert.>    -> create alert for editor pushes
"""

import json
import logging
from typing import Any, Optional

from app.config import settings
from app.database import AdminAsyncSessionLocal
from app.models.alert import AlertEvent
from app.services import restore_service

logger = logging.getLogger(__name__)

_nc: Optional[Any] = None


async def _create_push_alert(device_id: str, tenant_id: str, push_type: str) -> None:
    """Create a high-priority alert for device offline after config push."""
    async with AdminAsyncSessionLocal() as session:
        alert = AlertEvent(
            device_id=device_id,
            tenant_id=tenant_id,
            status="firing",
            severity="critical",
            message=f"Device went offline after config {push_type} — rollback available",
        )
        session.add(alert)
        await session.commit()
    logger.info("Created push alert for device %s (type=%s)", device_id, push_type)


async def handle_push_rollback(event: dict) -> None:
    """Auto-rollback: restore device to pre-push config."""
    device_id = event.get("device_id")
    tenant_id = event.get("tenant_id")
    commit_sha = event.get("pre_push_commit_sha")

    if not all([device_id, tenant_id, commit_sha]):
        logger.warning("Push rollback event missing fields: %s", event)
        return

    logger.warning(
        "AUTO-ROLLBACK: Device %s offline after template push, restoring to %s",
        device_id,
        commit_sha,
    )

    try:
        async with AdminAsyncSessionLocal() as session:
            result = await restore_service.restore_config(
                device_id=device_id,
                tenant_id=tenant_id,
                commit_sha=commit_sha,
                db_session=session,
            )
            await session.commit()
        logger.info(
            "Auto-rollback result for device %s: %s",
            device_id,
            result.get("status"),
        )
    except Exception as e:
        logger.error("Auto-rollback failed for device %s: %s", device_id, e)
        await _create_push_alert(device_id, tenant_id, "template (auto-rollback failed)")


async def handle_push_alert(event: dict) -> None:
    """Alert: create notification for device offline after editor push."""
    device_id = event.get("device_id")
    tenant_id = event.get("tenant_id")
    push_type = event.get("push_type", "editor")

    if not device_id or not tenant_id:
        logger.warning("Push alert event missing fields: %s", event)
        return

    await _create_push_alert(device_id, tenant_id, push_type)


async def _on_rollback_message(msg) -> None:
    """NATS message handler for config.push.rollback.> subjects."""
    try:
        event = json.loads(msg.data.decode())
        await handle_push_rollback(event)
        await msg.ack()
    except Exception as e:
        logger.error("Error handling rollback message: %s", e)
        await msg.nak()


async def _on_alert_message(msg) -> None:
    """NATS message handler for config.push.alert.> subjects."""
    try:
        event = json.loads(msg.data.decode())
        await handle_push_alert(event)
        await msg.ack()
    except Exception as e:
        logger.error("Error handling push alert message: %s", e)
        await msg.nak()


async def start_push_rollback_subscriber() -> Optional[Any]:
    """Connect to NATS and subscribe to push rollback/alert events."""
    import nats

    global _nc
    try:
        logger.info("NATS push-rollback: connecting to %s", settings.NATS_URL)
        _nc = await nats.connect(settings.NATS_URL)
        js = _nc.jetstream()
        await js.subscribe(
            "config.push.rollback.>",
            cb=_on_rollback_message,
            durable="api-push-rollback-consumer",
            stream="DEVICE_EVENTS",
            manual_ack=True,
        )
        await js.subscribe(
            "config.push.alert.>",
            cb=_on_alert_message,
            durable="api-push-alert-consumer",
            stream="DEVICE_EVENTS",
            manual_ack=True,
        )
        logger.info("Push rollback/alert subscriber started")
        return _nc
    except Exception as e:
        logger.error("Failed to start push rollback subscriber: %s", e)
        return None


async def stop_push_rollback_subscriber() -> None:
    """Gracefully close the NATS connection."""
    global _nc
    if _nc:
        await _nc.drain()
        _nc = None
