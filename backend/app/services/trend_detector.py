"""Signal trend detection -- hourly scan for signal degradation across active wireless links.

Compares 7-day rolling average vs 14-day baseline average per active link.
If the recent average has degraded beyond the configured threshold, creates
a site_alert_event with rule_type 'signal_degradation'.  Auto-resolves when
the condition clears.

Runs as an asyncio background task wired into the FastAPI lifespan.
Uses AdminAsyncSessionLocal (bypasses RLS -- trend detection is system-level).
"""

import asyncio
from datetime import datetime, timezone

import structlog
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = structlog.get_logger(__name__)


async def _detect_trends() -> None:
    """Scan all active/degraded wireless links for signal degradation trends."""
    async with AdminAsyncSessionLocal() as session:
        # Fetch active/degraded links with site_id derived from the AP device
        result = await session.execute(
            text("""
                SELECT wl.id, wl.tenant_id, d.site_id, wl.client_mac, wl.ap_device_id
                FROM wireless_links wl
                JOIN devices d ON d.id = wl.ap_device_id
                WHERE wl.state IN ('active', 'degraded')
                  AND d.site_id IS NOT NULL
            """)
        )
        links = result.fetchall()

        degradations_found = 0
        resolved_count = 0

        for link in links:
            link_id = link.id
            tenant_id = link.tenant_id
            site_id = link.site_id
            mac = link.client_mac
            ap_device_id = link.ap_device_id

            # Compute 7-day average signal
            avg_7d_result = await session.execute(
                text("""
                    SELECT avg(signal_strength) AS avg_signal
                    FROM wireless_registrations
                    WHERE mac_address = :mac
                      AND device_id = :ap_device_id
                      AND time > now() - interval '7 days'
                """),
                {"mac": mac, "ap_device_id": str(ap_device_id)},
            )
            avg_7d_row = avg_7d_result.fetchone()
            avg_7d = avg_7d_row.avg_signal if avg_7d_row else None

            # Compute 14-day average signal
            avg_14d_result = await session.execute(
                text("""
                    SELECT avg(signal_strength) AS avg_signal
                    FROM wireless_registrations
                    WHERE mac_address = :mac
                      AND device_id = :ap_device_id
                      AND time > now() - interval '14 days'
                """),
                {"mac": mac, "ap_device_id": str(ap_device_id)},
            )
            avg_14d_row = avg_14d_result.fetchone()
            avg_14d = avg_14d_row.avg_signal if avg_14d_row else None

            if avg_7d is None or avg_14d is None:
                continue

            # Signal values are negative dBm -- a more negative 7d avg means degradation.
            # delta = 14d_avg - 7d_avg: positive delta means 7d is worse (more negative).
            delta = float(avg_14d) - float(avg_7d)
            threshold = getattr(settings, "SIGNAL_DEGRADATION_THRESHOLD_DB", 5)
            condition_met = delta >= threshold

            # Check for existing active event for this link
            existing = await session.execute(
                text("""
                    SELECT id FROM site_alert_events
                    WHERE link_id = :link_id
                      AND rule_id IS NULL
                      AND state = 'active'
                    LIMIT 1
                """),
                {"link_id": str(link_id)},
            )
            active_event = existing.fetchone()

            if condition_met and not active_event:
                # Create new degradation alert event
                msg = (
                    f"Signal degraded {delta:.1f}dB over 2 weeks "
                    f"(from {float(avg_14d):.0f}dBm to {float(avg_7d):.0f}dBm)"
                )
                await session.execute(
                    text("""
                        INSERT INTO site_alert_events
                            (tenant_id, site_id, link_id, severity, message, state,
                             consecutive_hits, triggered_at)
                        VALUES
                            (:tenant_id, :site_id, :link_id, 'warning',
                             :message, 'active', 1, now())
                    """),
                    {
                        "tenant_id": str(tenant_id),
                        "site_id": str(site_id),
                        "link_id": str(link_id),
                        "message": msg,
                    },
                )
                degradations_found += 1

            elif not condition_met and active_event:
                # Auto-resolve: condition cleared
                await session.execute(
                    text("""
                        UPDATE site_alert_events
                        SET state = 'resolved', resolved_at = now()
                        WHERE id = :event_id
                    """),
                    {"event_id": str(active_event.id)},
                )
                resolved_count += 1

        await session.commit()

        logger.info(
            "trend detection complete",
            links_checked=len(links),
            degradations_found=degradations_found,
            resolved=resolved_count,
        )


async def trend_detection_loop() -> None:
    """Run trend detection on a configurable interval (default: hourly)."""
    interval = getattr(settings, "TREND_DETECTION_INTERVAL_SECONDS", 3600)
    while True:
        try:
            await _detect_trends()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("trend detection error", error=str(e))
        await asyncio.sleep(interval)
