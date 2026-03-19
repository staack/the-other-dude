"""NATS JetStream subscriber for wireless link discovery.

Subscribes to wireless.registrations.> on the WIRELESS_REGISTRATIONS stream
using a SEPARATE durable consumer from the wireless_registration_subscriber.
Both consumers independently process the same messages.

Resolves client MAC addresses against the device_interfaces table to discover
AP-CPE relationships, manages link state transitions (active/degraded/down/stale),
and tracks missed polls for link health.

Uses AdminAsyncSessionLocal (superuser bypass RLS) since registration data
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

_link_discovery_client: Optional[NATSClient] = None

# Configurable thresholds for link state transitions
DEGRADED_SIGNAL_THRESHOLD = -80  # dBm — signals weaker than this mark link as degraded
CONSECUTIVE_MISS_THRESHOLD = 3  # Missed polls before marking link as down
STALE_HOURS = 24  # Hours after down before marking link as stale


# =============================================================================
# MAIN MESSAGE HANDLER
# =============================================================================


async def on_wireless_registration_for_links(msg) -> None:
    """Handle a wireless.registrations event for link discovery.

    For each client registration:
    1. Resolve the client MAC against device_interfaces to find a CPE device
    2. If found, upsert a wireless_link with state based on signal strength
    3. Increment missed_polls for links from this AP NOT seen in this batch
    4. Mark stale any links in 'down' state older than STALE_HOURS

    On success, acknowledges the message. On error, NAKs so NATS can redeliver.
    """
    try:
        data = json.loads(msg.data)
        device_id = data.get("device_id")  # This is the AP

        if not device_id:
            logger.warning("wireless.registrations event missing 'device_id' -- skipping")
            await msg.ack()
            return

        tenant_id = data.get("tenant_id")
        registrations = data.get("registrations")

        if not registrations:
            await msg.ack()
            return

        seen_cpe_ids = []

        async with AdminAsyncSessionLocal() as session:
            for reg in registrations:
                client_mac = (reg.get("mac_address") or "").lower()
                if not client_mac:
                    continue

                # Resolve MAC against device_interfaces to find CPE device
                result = await session.execute(
                    text("""
                        SELECT device_id FROM device_interfaces
                        WHERE LOWER(mac_address) = :mac AND tenant_id = :tenant_id
                        LIMIT 1
                    """),
                    {"mac": client_mac, "tenant_id": tenant_id},
                )
                row = result.fetchone()

                if not row:
                    # Unresolved MAC -- stays in wireless_registrations for unknown client queries
                    continue

                cpe_device_id = str(row[0])
                seen_cpe_ids.append(cpe_device_id)

                signal_strength = reg.get("signal_strength")

                # Upsert wireless_link with state based on signal strength
                await session.execute(
                    text("""
                        INSERT INTO wireless_links
                            (id, ap_device_id, cpe_device_id, tenant_id, interface, client_mac,
                             signal_strength, tx_ccq, tx_rate, rx_rate, state, missed_polls,
                             discovered_at, last_seen, updated_at)
                        VALUES
                            (gen_random_uuid(), :ap_device_id, :cpe_device_id, :tenant_id,
                             :interface, :client_mac, :signal_strength, :tx_ccq, :tx_rate,
                             :rx_rate,
                             CASE WHEN :signal_strength::int IS NULL THEN 'active'
                                  WHEN :signal_strength::int < :degraded_threshold THEN 'degraded'
                                  ELSE 'active' END,
                             0, NOW(), NOW(), NOW())
                        ON CONFLICT (ap_device_id, cpe_device_id) DO UPDATE SET
                            interface = EXCLUDED.interface,
                            client_mac = EXCLUDED.client_mac,
                            signal_strength = EXCLUDED.signal_strength,
                            tx_ccq = EXCLUDED.tx_ccq,
                            tx_rate = EXCLUDED.tx_rate,
                            rx_rate = EXCLUDED.rx_rate,
                            state = CASE WHEN EXCLUDED.signal_strength IS NULL THEN 'active'
                                         WHEN EXCLUDED.signal_strength < :degraded_threshold THEN 'degraded'
                                         ELSE 'active' END,
                            missed_polls = 0,
                            last_seen = NOW(),
                            updated_at = NOW()
                    """),
                    {
                        "ap_device_id": device_id,
                        "cpe_device_id": cpe_device_id,
                        "tenant_id": tenant_id,
                        "interface": reg.get("interface"),
                        "client_mac": client_mac,
                        "signal_strength": signal_strength,
                        "tx_ccq": reg.get("tx_ccq"),
                        "tx_rate": reg.get("tx_rate"),
                        "rx_rate": reg.get("rx_rate"),
                        "degraded_threshold": DEGRADED_SIGNAL_THRESHOLD,
                    },
                )

            # Increment missed_polls for links from this AP NOT seen in this batch
            if seen_cpe_ids:
                await session.execute(
                    text("""
                        UPDATE wireless_links
                        SET missed_polls = missed_polls + 1,
                            state = CASE
                                WHEN missed_polls + 1 >= :miss_threshold THEN 'down'
                                ELSE state
                            END,
                            updated_at = NOW()
                        WHERE ap_device_id = :ap_device_id
                          AND tenant_id = :tenant_id
                          AND cpe_device_id NOT IN (
                              SELECT unnest(:seen_cpe_ids::uuid[])
                          )
                          AND state NOT IN ('down', 'stale')
                    """),
                    {
                        "ap_device_id": device_id,
                        "tenant_id": tenant_id,
                        "seen_cpe_ids": seen_cpe_ids,
                        "miss_threshold": CONSECUTIVE_MISS_THRESHOLD,
                    },
                )
            else:
                # No CPEs resolved -- increment all links for this AP
                await session.execute(
                    text("""
                        UPDATE wireless_links
                        SET missed_polls = missed_polls + 1,
                            state = CASE
                                WHEN missed_polls + 1 >= :miss_threshold THEN 'down'
                                ELSE state
                            END,
                            updated_at = NOW()
                        WHERE ap_device_id = :ap_device_id
                          AND tenant_id = :tenant_id
                          AND state NOT IN ('down', 'stale')
                    """),
                    {
                        "ap_device_id": device_id,
                        "tenant_id": tenant_id,
                        "miss_threshold": CONSECUTIVE_MISS_THRESHOLD,
                    },
                )

            # Mark stale: any links in 'down' state where last_seen > STALE_HOURS ago
            await session.execute(
                text(
                    """
                    UPDATE wireless_links
                    SET state = 'stale', updated_at = NOW()
                    WHERE ap_device_id = :ap_device_id
                      AND tenant_id = :tenant_id
                      AND state = 'down'
                      AND last_seen < NOW() - INTERVAL ':stale_hours hours'
                """.replace(":stale_hours", str(STALE_HOURS))
                ),
                {
                    "ap_device_id": device_id,
                    "tenant_id": tenant_id,
                },
            )

            await session.commit()

        logger.debug(
            "wireless.registrations link discovery processed",
            extra={
                "device_id": device_id,
                "registrations": len(registrations),
                "resolved_cpes": len(seen_cpe_ids),
            },
        )
        await msg.ack()

    except Exception as exc:
        logger.error(
            "Failed to process wireless.registrations for link discovery: %s",
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
                cb=on_wireless_registration_for_links,
                durable="api-link-discovery-consumer",
                stream="WIRELESS_REGISTRATIONS",
            )
            logger.info(
                "NATS: subscribed to wireless.registrations.> "
                "(durable: api-link-discovery-consumer)"
            )
            return
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "NATS: stream WIRELESS_REGISTRATIONS not ready (attempt %d/%d): %s "
                    "-- retrying in 5s",
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(5)
            else:
                logger.warning(
                    "NATS: giving up on wireless.registrations.> link discovery "
                    "after %d attempts: %s -- API will run without link discovery",
                    max_attempts,
                    exc,
                )
                return


async def start_link_discovery_subscriber() -> Optional[NATSClient]:
    """Connect to NATS and start the wireless.registrations.> link discovery subscription.

    Returns the NATS connection (must be passed to stop_link_discovery_subscriber
    on shutdown).
    """
    global _link_discovery_client

    logger.info("NATS link discovery: connecting to %s", settings.NATS_URL)

    nc = await nats.connect(
        settings.NATS_URL,
        max_reconnect_attempts=-1,
        reconnect_time_wait=2,
        error_cb=_on_error,
        reconnected_cb=_on_reconnected,
        disconnected_cb=_on_disconnected,
    )

    logger.info("NATS link discovery: connected to %s", settings.NATS_URL)

    js = nc.jetstream()
    await _subscribe_with_retry(js)

    _link_discovery_client = nc
    return nc


async def stop_link_discovery_subscriber(nc: Optional[NATSClient]) -> None:
    """Drain and close the link discovery NATS connection gracefully."""
    if nc is None:
        return
    try:
        logger.info("NATS link discovery: draining connection...")
        await nc.drain()
        logger.info("NATS link discovery: connection closed")
    except Exception as exc:
        logger.warning("NATS link discovery: error during drain: %s", exc)
        try:
            await nc.close()
        except Exception:
            pass


async def _on_error(exc: Exception) -> None:
    logger.error("NATS link discovery error: %s", exc)


async def _on_reconnected() -> None:
    logger.info("NATS link discovery: reconnected")


async def _on_disconnected() -> None:
    logger.warning("NATS link discovery: disconnected")
