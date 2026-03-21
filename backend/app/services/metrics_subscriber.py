"""NATS JetStream subscriber for device metrics events.

Subscribes to device.metrics.> and inserts into TimescaleDB hypertables:
  - interface_metrics  — per-interface rx/tx byte counters
  - health_metrics     — CPU, memory, disk, temperature per device
  - wireless_metrics   — per-wireless-interface aggregated client stats
  - snmp_metrics       — custom SNMP OID metrics (UPS, vendor, tenant profiles)

Also maintains denormalized last_cpu_load and last_memory_used_pct columns
on the devices table for efficient fleet table display.

Uses AdminAsyncSessionLocal (superuser bypass RLS) so metrics from any tenant
can be written without setting app.current_tenant.
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

_metrics_client: Optional[NATSClient] = None


# =============================================================================
# INSERT HANDLERS
# =============================================================================


def _parse_timestamp(val: str | None) -> datetime:
    """Parse an ISO 8601 / RFC 3339 timestamp string into a datetime object."""
    if not val:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)


async def _insert_health_metrics(session, data: dict) -> None:
    """Insert a health metrics event into health_metrics and update devices."""
    health = data.get("health")
    if not health:
        logger.warning("health metrics event missing 'health' field — skipping")
        return

    device_id = data.get("device_id")
    tenant_id = data.get("tenant_id")
    collected_at = _parse_timestamp(data.get("collected_at"))

    # Parse numeric values; treat empty strings as NULL.
    def parse_int(val: str | None) -> int | None:
        if not val:
            return None
        try:
            return int(val)
        except (ValueError, TypeError):
            return None

    cpu_load = parse_int(health.get("cpu_load"))
    free_memory = parse_int(health.get("free_memory"))
    total_memory = parse_int(health.get("total_memory"))
    free_disk = parse_int(health.get("free_disk"))
    total_disk = parse_int(health.get("total_disk"))
    temperature = parse_int(health.get("temperature"))

    await session.execute(
        text("""
            INSERT INTO health_metrics
                (time, device_id, tenant_id, cpu_load, free_memory, total_memory,
                 free_disk, total_disk, temperature)
            VALUES
                (:time, :device_id, :tenant_id, :cpu_load, :free_memory, :total_memory,
                 :free_disk, :total_disk, :temperature)
        """),
        {
            "time": collected_at,
            "device_id": device_id,
            "tenant_id": tenant_id,
            "cpu_load": cpu_load,
            "free_memory": free_memory,
            "total_memory": total_memory,
            "free_disk": free_disk,
            "total_disk": total_disk,
            "temperature": temperature,
        },
    )

    # Update denormalized columns on devices for fleet table display.
    # Compute memory percentage in Python to avoid asyncpg type ambiguity.
    mem_pct = None
    if total_memory and total_memory > 0 and free_memory is not None:
        mem_pct = round((1.0 - free_memory / total_memory) * 100)

    await session.execute(
        text("""
            UPDATE devices SET
                last_cpu_load = COALESCE(:cpu_load, last_cpu_load),
                last_memory_used_pct = COALESCE(:mem_pct, last_memory_used_pct),
                updated_at = NOW()
            WHERE id = CAST(:device_id AS uuid)
        """),
        {
            "cpu_load": cpu_load,
            "mem_pct": mem_pct,
            "device_id": device_id,
        },
    )


async def _insert_interface_metrics(session, data: dict) -> None:
    """Insert per-interface traffic counters into interface_metrics."""
    interfaces = data.get("interfaces")
    if not interfaces:
        return  # Device may have no interfaces (unlikely but safe to skip)

    device_id = data.get("device_id")
    tenant_id = data.get("tenant_id")
    collected_at = _parse_timestamp(data.get("collected_at"))

    for iface in interfaces:
        await session.execute(
            text("""
                INSERT INTO interface_metrics
                    (time, device_id, tenant_id, interface, rx_bytes, tx_bytes, rx_bps, tx_bps)
                VALUES
                    (:time, :device_id, :tenant_id, :interface, :rx_bytes, :tx_bytes, NULL, NULL)
            """),
            {
                "time": collected_at,
                "device_id": device_id,
                "tenant_id": tenant_id,
                "interface": iface.get("name"),
                "rx_bytes": iface.get("rx_bytes"),
                "tx_bytes": iface.get("tx_bytes"),
            },
        )


async def _insert_wireless_metrics(session, data: dict) -> None:
    """Insert per-wireless-interface aggregated client stats into wireless_metrics."""
    wireless = data.get("wireless")
    if not wireless:
        return  # Device may have no wireless interfaces

    device_id = data.get("device_id")
    tenant_id = data.get("tenant_id")
    collected_at = _parse_timestamp(data.get("collected_at"))

    for wif in wireless:
        await session.execute(
            text("""
                INSERT INTO wireless_metrics
                    (time, device_id, tenant_id, interface, client_count, avg_signal, ccq, frequency)
                VALUES
                    (:time, :device_id, :tenant_id, :interface,
                     :client_count, :avg_signal, :ccq, :frequency)
            """),
            {
                "time": collected_at,
                "device_id": device_id,
                "tenant_id": tenant_id,
                "interface": wif.get("interface"),
                "client_count": wif.get("client_count"),
                "avg_signal": wif.get("avg_signal"),
                "ccq": wif.get("ccq"),
                "frequency": wif.get("frequency"),
            },
        )


async def _insert_snmp_custom_metrics(session, data: dict) -> None:
    """Insert custom SNMP OID metrics into snmp_metrics hypertable."""
    metrics = data.get("metrics")
    if not metrics:
        logger.warning("snmp_custom event missing 'metrics' field — skipping")
        return

    device_id = data.get("device_id")
    tenant_id = data.get("tenant_id")
    collected_at = _parse_timestamp(data.get("collected_at"))

    for m in metrics:
        await session.execute(
            text("""
                INSERT INTO snmp_metrics
                    (time, device_id, tenant_id, metric_name, metric_group,
                     value_numeric, value_text, oid, index_value)
                VALUES
                    (:time, :device_id, :tenant_id, :metric_name, :metric_group,
                     :value_numeric, :value_text, :oid, :index_value)
            """),
            {
                "time": collected_at,
                "device_id": device_id,
                "tenant_id": tenant_id,
                "metric_name": m.get("metric_name"),
                "metric_group": m.get("metric_group"),
                "value_numeric": m.get("value_numeric"),
                "value_text": m.get("value_text"),
                "oid": m.get("oid"),
                "index_value": m.get("index_value"),
            },
        )


# =============================================================================
# MAIN MESSAGE HANDLER
# =============================================================================


async def on_device_metrics(msg) -> None:
    """Handle a device.metrics event published by the Go poller.

    Dispatches to the appropriate insert handler based on the 'type' field:
      - "health"      → _insert_health_metrics + update devices
      - "interfaces"  → _insert_interface_metrics
      - "wireless"    → _insert_wireless_metrics
      - "snmp_custom" → _insert_snmp_custom_metrics (custom SNMP OID data)

    Unknown types are NAKed (not ACKed) so NATS can redeliver once the
    subscriber is updated -- prevents permanent data loss during deployments.
    On success, acknowledges the message. On error, NAKs so NATS can redeliver.
    """
    try:
        data = json.loads(msg.data)
        metric_type = data.get("type")
        device_id = data.get("device_id")

        if not metric_type or not device_id:
            logger.warning("device.metrics event missing 'type' or 'device_id' — skipping")
            await msg.ack()
            return

        async with AdminAsyncSessionLocal() as session:
            if metric_type == "health":
                await _insert_health_metrics(session, data)
            elif metric_type == "interfaces":
                await _insert_interface_metrics(session, data)
            elif metric_type == "wireless":
                await _insert_wireless_metrics(session, data)
            elif metric_type == "snmp_custom":
                await _insert_snmp_custom_metrics(session, data)
            else:
                logger.warning("Unknown metric type '%s' — NAKing for redelivery", metric_type)
                await msg.nak()
                return

            await session.commit()

        # Alert evaluation — non-fatal; metric write is the primary operation
        try:
            from app.services import alert_evaluator

            await alert_evaluator.evaluate(
                device_id=device_id,
                tenant_id=data.get("tenant_id", ""),
                metric_type=metric_type,
                data=data,
            )
        except Exception as eval_err:
            logger.warning("Alert evaluation failed for device %s: %s", device_id, eval_err)

        logger.debug(
            "device.metrics processed",
            extra={"device_id": device_id, "type": metric_type},
        )
        await msg.ack()

    except Exception as exc:
        logger.error(
            "Failed to process device.metrics event: %s",
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
    """Subscribe to device.metrics.> with durable consumer, retrying if stream not ready."""
    max_attempts = 6  # ~30 seconds at 5s intervals
    for attempt in range(1, max_attempts + 1):
        try:
            await js.subscribe(
                "device.metrics.>",
                cb=on_device_metrics,
                durable="api-metrics-consumer",
                stream="DEVICE_EVENTS",
            )
            logger.info("NATS: subscribed to device.metrics.> (durable: api-metrics-consumer)")
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream DEVICE_EVENTS not ready for metrics (attempt %d/%d): %s — retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on device.metrics.> after %d attempts: %s — API will run without metrics ingestion",
                    max_attempts,
                    exc,
                )
                return


async def start_metrics_subscriber() -> Optional[NATSClient]:
    """Connect to NATS and start the device.metrics.> subscription.

    Uses a separate NATS connection from the status subscriber — simpler and
    NATS handles multiple connections per client efficiently.

    Returns the NATS connection (must be passed to stop_metrics_subscriber on shutdown).
    Raises on fatal connection errors after retry exhaustion.
    """
    global _metrics_client

    logger.info("NATS metrics: connecting to %s", settings.NATS_URL)

    nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,
        reconnect_time_wait=2,
        error_cb=_on_error,
        reconnected_cb=_on_reconnected,
        disconnected_cb=_on_disconnected,
    )

    logger.info("NATS metrics: connected to %s", settings.NATS_URL)

    js = nc.jetstream()
    await _subscribe_with_retry(js)

    _metrics_client = nc
    return nc


async def stop_metrics_subscriber(nc: Optional[NATSClient]) -> None:
    """Drain and close the metrics NATS connection gracefully."""
    if nc is None:
        return
    try:
        logger.info("NATS metrics: draining connection...")
        await nc.drain()
        logger.info("NATS metrics: connection closed")
    except Exception as exc:
        logger.warning("NATS metrics: error during drain: %s", exc)
        try:
            await nc.close()
        except Exception:
            pass


async def _on_error(exc: Exception) -> None:
    logger.error("NATS metrics error: %s", exc)


async def _on_reconnected() -> None:
    logger.info("NATS metrics: reconnected")


async def _on_disconnected() -> None:
    logger.warning("NATS metrics: disconnected")
