"""Alert rule evaluation engine with Redis breach counters and flap detection.

Entry points:
- evaluate(device_id, tenant_id, metric_type, data): called from metrics_subscriber
- evaluate_offline(device_id, tenant_id): called from nats_subscriber on device offline
- evaluate_online(device_id, tenant_id): called from nats_subscriber on device online

Uses Redis for:
- Consecutive breach counting (alert:breach:{device_id}:{rule_id})
- Flap detection (alert:flap:{device_id}:{rule_id} sorted set)

Uses AdminAsyncSessionLocal for all DB operations (runs cross-tenant in NATS handlers).
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal
from app.services.event_publisher import publish_event

logger = logging.getLogger(__name__)

# Module-level Redis client, lazily initialized
_redis_client: aioredis.Redis | None = None

# Module-level rule cache: {tenant_id: (rules_list, fetched_at_timestamp)}
_rule_cache: dict[str, tuple[list[dict], float]] = {}
_CACHE_TTL_SECONDS = 60

# Module-level maintenance window cache: {tenant_id: (active_windows_list, fetched_at_timestamp)}
# Each window: {"device_ids": [...], "suppress_alerts": True}
_maintenance_cache: dict[str, tuple[list[dict], float]] = {}
_MAINTENANCE_CACHE_TTL = 30  # 30 seconds


async def _get_redis() -> aioredis.Redis:
    """Get or create the Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


async def _get_active_maintenance_windows(tenant_id: str) -> list[dict]:
    """Fetch active maintenance windows for a tenant, with 30s cache."""
    now = time.time()
    cached = _maintenance_cache.get(tenant_id)
    if cached and (now - cached[1]) < _MAINTENANCE_CACHE_TTL:
        return cached[0]

    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT device_ids, suppress_alerts
                FROM maintenance_windows
                WHERE tenant_id = CAST(:tenant_id AS uuid)
                  AND suppress_alerts = true
                  AND start_at <= NOW()
                  AND end_at >= NOW()
            """),
            {"tenant_id": tenant_id},
        )
        rows = result.fetchall()

    windows = [
        {
            "device_ids": row[0] if isinstance(row[0], list) else [],
            "suppress_alerts": row[1],
        }
        for row in rows
    ]

    _maintenance_cache[tenant_id] = (windows, now)
    return windows


async def _is_device_in_maintenance(tenant_id: str, device_id: str) -> bool:
    """Check if a device is currently under active maintenance with alert suppression.

    Returns True if there is at least one active maintenance window covering
    this device (or all devices via empty device_ids array).
    """
    windows = await _get_active_maintenance_windows(tenant_id)
    for window in windows:
        device_ids = window["device_ids"]
        # Empty device_ids means "all devices in tenant"
        if not device_ids or device_id in device_ids:
            return True
    return False


async def _get_rules_for_tenant(tenant_id: str) -> list[dict]:
    """Fetch active alert rules for a tenant, with 60s cache."""
    now = time.time()
    cached = _rule_cache.get(tenant_id)
    if cached and (now - cached[1]) < _CACHE_TTL_SECONDS:
        return cached[0]

    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT id, tenant_id, device_id, group_id, name, metric,
                       operator, threshold, duration_polls, severity
                FROM alert_rules
                WHERE tenant_id = CAST(:tenant_id AS uuid) AND enabled = TRUE
            """),
            {"tenant_id": tenant_id},
        )
        rows = result.fetchall()

    rules = [
        {
            "id": str(row[0]),
            "tenant_id": str(row[1]),
            "device_id": str(row[2]) if row[2] else None,
            "group_id": str(row[3]) if row[3] else None,
            "name": row[4],
            "metric": row[5],
            "operator": row[6],
            "threshold": float(row[7]),
            "duration_polls": row[8],
            "severity": row[9],
        }
        for row in rows
    ]

    _rule_cache[tenant_id] = (rules, now)
    return rules


def _check_threshold(value: float, operator: str, threshold: float) -> bool:
    """Check if a metric value breaches a threshold."""
    if operator == "gt":
        return value > threshold
    elif operator == "lt":
        return value < threshold
    elif operator == "gte":
        return value >= threshold
    elif operator == "lte":
        return value <= threshold
    return False


def _extract_metrics(metric_type: str, data: dict) -> dict[str, float]:
    """Extract metric name->value pairs from a NATS metrics event."""
    metrics: dict[str, float] = {}

    if metric_type == "health":
        health = data.get("health", {})
        for key in ("cpu_load", "temperature"):
            val = health.get(key)
            if val is not None and val != "":
                try:
                    metrics[key] = float(val)
                except (ValueError, TypeError):
                    pass
        # Compute memory_used_pct and disk_used_pct
        free_mem = health.get("free_memory")
        total_mem = health.get("total_memory")
        if free_mem is not None and total_mem is not None:
            try:
                total = float(total_mem)
                free = float(free_mem)
                if total > 0:
                    metrics["memory_used_pct"] = round((1.0 - free / total) * 100, 1)
            except (ValueError, TypeError):
                pass
        free_disk = health.get("free_disk")
        total_disk = health.get("total_disk")
        if free_disk is not None and total_disk is not None:
            try:
                total = float(total_disk)
                free = float(free_disk)
                if total > 0:
                    metrics["disk_used_pct"] = round((1.0 - free / total) * 100, 1)
            except (ValueError, TypeError):
                pass

    elif metric_type == "wireless":
        wireless = data.get("wireless", [])
        # Aggregate: use worst signal, lowest CCQ, sum client_count
        for wif in wireless:
            for key in ("signal_strength", "ccq", "client_count"):
                val = wif.get(key) if key != "avg_signal" else wif.get("avg_signal")
                if key == "signal_strength":
                    val = wif.get("avg_signal")
                if val is not None and val != "":
                    try:
                        fval = float(val)
                        if key not in metrics:
                            metrics[key] = fval
                        elif key == "signal_strength":
                            metrics[key] = min(metrics[key], fval)  # worst signal
                        elif key == "ccq":
                            metrics[key] = min(metrics[key], fval)  # worst CCQ
                        elif key == "client_count":
                            metrics[key] = metrics.get(key, 0) + fval  # sum
                    except (ValueError, TypeError):
                        pass

    # TODO: Interface bandwidth alerting (rx_bps/tx_bps) requires stateful delta
    # computation between consecutive poll values. Deferred for now — the alert_rules
    # table supports these metric types, but evaluation is skipped.

    return metrics


async def _increment_breach(
    r: aioredis.Redis, device_id: str, rule_id: str, required_polls: int
) -> bool:
    """Increment breach counter in Redis. Returns True when threshold duration reached."""
    key = f"alert:breach:{device_id}:{rule_id}"
    count = await r.incr(key)
    # Set TTL to (required_polls + 2) * 60 seconds so it expires if breaches stop
    await r.expire(key, (required_polls + 2) * 60)
    return count >= required_polls


async def _reset_breach(r: aioredis.Redis, device_id: str, rule_id: str) -> None:
    """Reset breach counter when metric returns to normal."""
    key = f"alert:breach:{device_id}:{rule_id}"
    await r.delete(key)


async def _check_flapping(r: aioredis.Redis, device_id: str, rule_id: str) -> bool:
    """Check if alert is flapping (>= 5 state transitions in 10 minutes).

    Uses a Redis sorted set with timestamps as scores.
    """
    key = f"alert:flap:{device_id}:{rule_id}"
    now = time.time()
    window_start = now - 600  # 10 minute window

    # Add this transition
    await r.zadd(key, {str(now): now})
    # Remove entries outside the window
    await r.zremrangebyscore(key, "-inf", window_start)
    # Set TTL on the key
    await r.expire(key, 1200)
    # Count transitions in window
    count = await r.zcard(key)
    return count >= 5


async def _get_device_groups(device_id: str) -> list[str]:
    """Get group IDs for a device."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text(
                "SELECT group_id FROM device_group_memberships WHERE device_id = CAST(:device_id AS uuid)"
            ),
            {"device_id": device_id},
        )
        return [str(row[0]) for row in result.fetchall()]


async def _has_open_alert(device_id: str, rule_id: str | None, metric: str | None = None) -> bool:
    """Check if there's an open (firing, unresolved) alert for this device+rule."""
    async with AdminAsyncSessionLocal() as session:
        if rule_id:
            result = await session.execute(
                text("""
                    SELECT 1 FROM alert_events
                    WHERE device_id = CAST(:device_id AS uuid) AND rule_id = CAST(:rule_id AS uuid)
                      AND status = 'firing' AND resolved_at IS NULL
                    LIMIT 1
                """),
                {"device_id": device_id, "rule_id": rule_id},
            )
        else:
            result = await session.execute(
                text("""
                    SELECT 1 FROM alert_events
                    WHERE device_id = CAST(:device_id AS uuid) AND rule_id IS NULL
                      AND metric = :metric AND status = 'firing' AND resolved_at IS NULL
                    LIMIT 1
                """),
                {"device_id": device_id, "metric": metric or "offline"},
            )
        return result.fetchone() is not None


async def _create_alert_event(
    device_id: str,
    tenant_id: str,
    rule_id: str | None,
    status: str,
    severity: str,
    metric: str | None,
    value: float | None,
    threshold: float | None,
    message: str | None,
    is_flapping: bool = False,
) -> dict:
    """Create an alert event row and return its data."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                INSERT INTO alert_events
                    (id, device_id, tenant_id, rule_id, status, severity, metric,
                     value, threshold, message, is_flapping, fired_at,
                     resolved_at)
                VALUES
                    (gen_random_uuid(), CAST(:device_id AS uuid), CAST(:tenant_id AS uuid),
                     :rule_id, :status, :severity, :metric,
                     :value, :threshold, :message, :is_flapping, NOW(),
                     CASE WHEN :status = 'resolved' THEN NOW() ELSE NULL END)
                RETURNING id, fired_at
            """),
            {
                "device_id": device_id,
                "tenant_id": tenant_id,
                "rule_id": rule_id,
                "status": status,
                "severity": severity,
                "metric": metric,
                "value": value,
                "threshold": threshold,
                "message": message,
                "is_flapping": is_flapping,
            },
        )
        row = result.fetchone()
        await session.commit()

    alert_data = {
        "id": str(row[0]) if row else None,
        "device_id": device_id,
        "tenant_id": tenant_id,
        "rule_id": rule_id,
        "status": status,
        "severity": severity,
        "metric": metric,
        "value": value,
        "threshold": threshold,
        "message": message,
        "is_flapping": is_flapping,
    }

    # Publish real-time event to NATS for SSE pipeline (fire-and-forget)
    if status in ("firing", "flapping"):
        await publish_event(
            f"alert.fired.{tenant_id}",
            {
                "event_type": "alert_fired",
                "tenant_id": tenant_id,
                "device_id": device_id,
                "alert_event_id": alert_data["id"],
                "severity": severity,
                "metric": metric,
                "current_value": value,
                "threshold": threshold,
                "message": message,
                "is_flapping": is_flapping,
                "fired_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    elif status == "resolved":
        await publish_event(
            f"alert.resolved.{tenant_id}",
            {
                "event_type": "alert_resolved",
                "tenant_id": tenant_id,
                "device_id": device_id,
                "alert_event_id": alert_data["id"],
                "severity": severity,
                "metric": metric,
                "message": message,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    return alert_data


async def _resolve_alert(device_id: str, rule_id: str | None, metric: str | None = None) -> None:
    """Resolve an open alert by setting resolved_at."""
    async with AdminAsyncSessionLocal() as session:
        if rule_id:
            await session.execute(
                text("""
                    UPDATE alert_events SET resolved_at = NOW(), status = 'resolved'
                    WHERE device_id = CAST(:device_id AS uuid) AND rule_id = CAST(:rule_id AS uuid)
                      AND status = 'firing' AND resolved_at IS NULL
                """),
                {"device_id": device_id, "rule_id": rule_id},
            )
        else:
            await session.execute(
                text("""
                    UPDATE alert_events SET resolved_at = NOW(), status = 'resolved'
                    WHERE device_id = CAST(:device_id AS uuid) AND rule_id IS NULL
                      AND metric = :metric AND status = 'firing' AND resolved_at IS NULL
                """),
                {"device_id": device_id, "metric": metric or "offline"},
            )
        await session.commit()


async def _get_channels_for_tenant(tenant_id: str) -> list[dict]:
    """Get all notification channels for a tenant."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT id, name, channel_type, smtp_host, smtp_port, smtp_user,
                       smtp_password, smtp_use_tls, from_address, to_address,
                       webhook_url, smtp_password_transit, slack_webhook_url, tenant_id
                FROM notification_channels
                WHERE tenant_id = CAST(:tenant_id AS uuid)
            """),
            {"tenant_id": tenant_id},
        )
        return [
            {
                "id": str(row[0]),
                "name": row[1],
                "channel_type": row[2],
                "smtp_host": row[3],
                "smtp_port": row[4],
                "smtp_user": row[5],
                "smtp_password": row[6],
                "smtp_use_tls": row[7],
                "from_address": row[8],
                "to_address": row[9],
                "webhook_url": row[10],
                "smtp_password_transit": row[11],
                "slack_webhook_url": row[12],
                "tenant_id": str(row[13]) if row[13] else None,
            }
            for row in result.fetchall()
        ]


async def _get_channels_for_rule(rule_id: str) -> list[dict]:
    """Get notification channels linked to a specific alert rule."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT nc.id, nc.name, nc.channel_type, nc.smtp_host, nc.smtp_port,
                       nc.smtp_user, nc.smtp_password, nc.smtp_use_tls,
                       nc.from_address, nc.to_address, nc.webhook_url,
                       nc.smtp_password_transit, nc.slack_webhook_url, nc.tenant_id
                FROM notification_channels nc
                JOIN alert_rule_channels arc ON arc.channel_id = nc.id
                WHERE arc.rule_id = CAST(:rule_id AS uuid)
            """),
            {"rule_id": rule_id},
        )
        return [
            {
                "id": str(row[0]),
                "name": row[1],
                "channel_type": row[2],
                "smtp_host": row[3],
                "smtp_port": row[4],
                "smtp_user": row[5],
                "smtp_password": row[6],
                "smtp_use_tls": row[7],
                "from_address": row[8],
                "to_address": row[9],
                "webhook_url": row[10],
                "smtp_password_transit": row[11],
                "slack_webhook_url": row[12],
                "tenant_id": str(row[13]) if row[13] else None,
            }
            for row in result.fetchall()
        ]


async def _dispatch_async(alert_event: dict, channels: list[dict], device_hostname: str) -> None:
    """Fire-and-forget notification dispatch."""
    try:
        from app.services.notification_service import dispatch_notifications

        await dispatch_notifications(alert_event, channels, device_hostname)
    except Exception as e:
        logger.warning("Notification dispatch failed: %s", e)


async def _get_device_hostname(device_id: str) -> str:
    """Get device hostname for notification messages."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT hostname FROM devices WHERE id = CAST(:device_id AS uuid)"),
            {"device_id": device_id},
        )
        row = result.fetchone()
        return row[0] if row else device_id


async def evaluate(
    device_id: str,
    tenant_id: str,
    metric_type: str,
    data: dict[str, Any],
) -> None:
    """Evaluate alert rules for incoming device metrics.

    Called from metrics_subscriber after metric DB write.
    """
    # Check maintenance window suppression before evaluating rules
    if await _is_device_in_maintenance(tenant_id, device_id):
        logger.debug(
            "Alert suppressed by maintenance window for device %s tenant %s",
            device_id,
            tenant_id,
        )
        return

    rules = await _get_rules_for_tenant(tenant_id)
    if not rules:
        return

    metrics = _extract_metrics(metric_type, data)
    if not metrics:
        return

    r = await _get_redis()
    device_groups = await _get_device_groups(device_id)

    # Build a set of metrics that have device-specific rules
    device_specific_metrics: set[str] = set()
    for rule in rules:
        if rule["device_id"] == device_id:
            device_specific_metrics.add(rule["metric"])

    for rule in rules:
        rule_metric = rule["metric"]
        if rule_metric not in metrics:
            continue

        # Check if rule applies to this device
        applies = False
        if rule["device_id"] == device_id:
            applies = True
        elif rule["device_id"] is None and rule["group_id"] is None:
            # Tenant-wide rule — skip if device-specific rule exists for same metric
            if rule_metric in device_specific_metrics:
                continue
            applies = True
        elif rule["group_id"] and rule["group_id"] in device_groups:
            applies = True

        if not applies:
            continue

        value = metrics[rule_metric]
        breaching = _check_threshold(value, rule["operator"], rule["threshold"])

        if breaching:
            reached = await _increment_breach(r, device_id, rule["id"], rule["duration_polls"])
            if reached:
                # Check if already firing
                if await _has_open_alert(device_id, rule["id"]):
                    continue

                # Check flapping
                is_flapping = await _check_flapping(r, device_id, rule["id"])

                hostname = await _get_device_hostname(device_id)
                message = f"{rule['name']}: {rule_metric} = {value} (threshold: {rule['operator']} {rule['threshold']})"

                alert_event = await _create_alert_event(
                    device_id=device_id,
                    tenant_id=tenant_id,
                    rule_id=rule["id"],
                    status="flapping" if is_flapping else "firing",
                    severity=rule["severity"],
                    metric=rule_metric,
                    value=value,
                    threshold=rule["threshold"],
                    message=message,
                    is_flapping=is_flapping,
                )

                if is_flapping:
                    logger.info(
                        "Alert %s for device %s is flapping — notifications suppressed",
                        rule["name"],
                        device_id,
                    )
                else:
                    channels = await _get_channels_for_rule(rule["id"])
                    if channels:
                        asyncio.create_task(_dispatch_async(alert_event, channels, hostname))
        else:
            # Not breaching — reset counter and check for open alert to resolve
            await _reset_breach(r, device_id, rule["id"])

            if await _has_open_alert(device_id, rule["id"]):
                # Check flapping before resolving
                is_flapping = await _check_flapping(r, device_id, rule["id"])

                await _resolve_alert(device_id, rule["id"])

                hostname = await _get_device_hostname(device_id)
                message = f"Resolved: {rule['name']}: {rule_metric} = {value}"

                resolved_event = await _create_alert_event(
                    device_id=device_id,
                    tenant_id=tenant_id,
                    rule_id=rule["id"],
                    status="resolved",
                    severity=rule["severity"],
                    metric=rule_metric,
                    value=value,
                    threshold=rule["threshold"],
                    message=message,
                    is_flapping=is_flapping,
                )

                if not is_flapping:
                    channels = await _get_channels_for_rule(rule["id"])
                    if channels:
                        asyncio.create_task(_dispatch_async(resolved_event, channels, hostname))


async def _get_offline_rule(tenant_id: str) -> dict | None:
    """Look up the device_offline default rule for a tenant."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT id, enabled FROM alert_rules
                WHERE tenant_id = CAST(:tenant_id AS uuid)
                  AND metric = 'device_offline' AND is_default = TRUE
                LIMIT 1
            """),
            {"tenant_id": tenant_id},
        )
        row = result.fetchone()
        if row:
            return {"id": str(row[0]), "enabled": row[1]}
        return None


async def evaluate_offline(device_id: str, tenant_id: str) -> None:
    """Create a critical alert when a device goes offline.

    Uses the tenant's device_offline default rule if it exists and is enabled.
    Falls back to system-level alert (rule_id=NULL) for backward compatibility.
    """
    if await _is_device_in_maintenance(tenant_id, device_id):
        logger.debug(
            "Offline alert suppressed by maintenance window for device %s",
            device_id,
        )
        return

    rule = await _get_offline_rule(tenant_id)
    rule_id = rule["id"] if rule else None

    # If rule exists but is disabled, skip alert creation (user opted out)
    if rule and not rule["enabled"]:
        return

    if rule_id:
        if await _has_open_alert(device_id, rule_id):
            return
    else:
        if await _has_open_alert(device_id, None, "offline"):
            return

    hostname = await _get_device_hostname(device_id)
    message = f"Device {hostname} is offline"

    alert_event = await _create_alert_event(
        device_id=device_id,
        tenant_id=tenant_id,
        rule_id=rule_id,
        status="firing",
        severity="critical",
        metric="offline",
        value=None,
        threshold=None,
        message=message,
    )

    # Use rule-linked channels if available, otherwise tenant-wide channels
    if rule_id:
        channels = await _get_channels_for_rule(rule_id)
        if not channels:
            channels = await _get_channels_for_tenant(tenant_id)
    else:
        channels = await _get_channels_for_tenant(tenant_id)

    if channels:
        asyncio.create_task(_dispatch_async(alert_event, channels, hostname))


async def evaluate_online(device_id: str, tenant_id: str) -> None:
    """Resolve offline alert when device comes back online."""
    rule = await _get_offline_rule(tenant_id)
    rule_id = rule["id"] if rule else None

    if rule_id:
        if not await _has_open_alert(device_id, rule_id):
            return
        await _resolve_alert(device_id, rule_id)
    else:
        if not await _has_open_alert(device_id, None, "offline"):
            return
        await _resolve_alert(device_id, None, "offline")

    hostname = await _get_device_hostname(device_id)
    message = f"Device {hostname} is back online"

    resolved_event = await _create_alert_event(
        device_id=device_id,
        tenant_id=tenant_id,
        rule_id=rule_id,
        status="resolved",
        severity="critical",
        metric="offline",
        value=None,
        threshold=None,
        message=message,
    )

    if rule_id:
        channels = await _get_channels_for_rule(rule_id)
        if not channels:
            channels = await _get_channels_for_tenant(tenant_id)
    else:
        channels = await _get_channels_for_tenant(tenant_id)

    if channels:
        asyncio.create_task(_dispatch_async(resolved_event, channels, hostname))
