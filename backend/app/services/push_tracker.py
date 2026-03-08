"""Track recent config pushes in Redis for poller-aware rollback.

When a device goes offline shortly after a push, the poller checks these
keys and triggers rollback (template/restore) or alert (editor).

Redis key format: push:recent:{device_id}
TTL: 300 seconds (5 minutes)
"""

import json
import logging
from typing import Optional

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger(__name__)

PUSH_TTL_SECONDS = 300  # 5 minutes

_redis: Optional[redis.Redis] = None


async def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.REDIS_URL)
    return _redis


async def record_push(
    device_id: str,
    tenant_id: str,
    push_type: str,
    push_operation_id: str = "",
    pre_push_commit_sha: str = "",
) -> None:
    """Record a recent config push in Redis.

    Args:
        device_id: UUID of the device.
        tenant_id: UUID of the tenant.
        push_type: 'template' (auto-rollback) or 'editor' (alert only) or 'restore'.
        push_operation_id: ID of the ConfigPushOperation row.
        pre_push_commit_sha: Git SHA of the pre-push backup (for rollback).
    """
    r = await _get_redis()
    key = f"push:recent:{device_id}"
    value = json.dumps({
        "device_id": device_id,
        "tenant_id": tenant_id,
        "push_type": push_type,
        "push_operation_id": push_operation_id,
        "pre_push_commit_sha": pre_push_commit_sha,
    })
    await r.set(key, value, ex=PUSH_TTL_SECONDS)
    logger.debug(
        "Recorded push for device %s (type=%s, TTL=%ds)",
        device_id,
        push_type,
        PUSH_TTL_SECONDS,
    )


async def clear_push(device_id: str) -> None:
    """Clear the push tracking key (e.g., after successful commit)."""
    r = await _get_redis()
    await r.delete(f"push:recent:{device_id}")
    logger.debug("Cleared push tracking for device %s", device_id)
