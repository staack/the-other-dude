"""Fire-and-forget NATS JetStream event publisher for real-time SSE pipeline.

Provides a shared lazy NATS connection and publish helper used by:
- alert_evaluator.py  (alert.fired.{tenant_id}, alert.resolved.{tenant_id})
- restore_service.py  (config.push.{tenant_id}.{device_id})
- upgrade_service.py  (firmware.progress.{tenant_id}.{device_id})

All publishes are fire-and-forget: errors are logged but never propagate
to the caller. A NATS outage must never block alert evaluation, config
push, or firmware upgrade operations.
"""

import json
import logging
from typing import Any

import nats
import nats.aio.client

from app.config import settings

logger = logging.getLogger(__name__)

# Module-level NATS connection (lazy initialized, reused across publishes)
_nc: nats.aio.client.Client | None = None


async def _get_nats() -> nats.aio.client.Client:
    """Get or create a NATS connection for event publishing."""
    global _nc
    if _nc is None or _nc.is_closed:
        _nc = await nats.connect(settings.NATS_URL)
        logger.info("Event publisher NATS connection established")
    return _nc


async def publish_event(subject: str, payload: dict[str, Any]) -> None:
    """Publish a JSON event to a NATS JetStream subject (fire-and-forget).

    Args:
        subject: NATS subject, e.g. "alert.fired.{tenant_id}".
        payload: Dict that will be JSON-serialized as the message body.

    Never raises -- all exceptions are caught and logged as warnings.
    """
    try:
        nc = await _get_nats()
        js = nc.jetstream()
        await js.publish(subject, json.dumps(payload).encode())
        logger.debug("Published event to %s", subject)
    except Exception as exc:
        logger.warning("Failed to publish event to %s: %s", subject, exc)
