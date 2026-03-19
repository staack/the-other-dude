"""Site alert rule evaluator -- periodic evaluation of operator-defined alert rules.

Runs every 5 minutes (configurable via ALERT_EVALUATION_INTERVAL_SECONDS).
Evaluates each enabled site_alert_rule against current data and creates/resolves
site_alert_events with hysteresis (consecutive_hits >= 2 before confirming).

Supported rule types:
  - device_offline_percent: site-scoped, % of devices offline
  - device_offline_count: site-scoped, count of offline devices
  - sector_signal_avg: sector-scoped, average signal below threshold (dBm)
  - sector_client_drop: sector-scoped, client count drop % over 1 hour

Uses AdminAsyncSessionLocal (bypasses RLS -- evaluation is system-level).
"""

import asyncio

import structlog
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = structlog.get_logger(__name__)


async def _evaluate_condition(session, rule) -> bool:  # noqa: ANN001
    """Evaluate a single rule and return True if the alert condition is met."""
    rule_type = rule.rule_type
    site_id = str(rule.site_id)
    sector_id = str(rule.sector_id) if rule.sector_id else None
    threshold = float(rule.threshold_value)

    if rule_type == "device_offline_percent":
        total_result = await session.execute(
            text("SELECT count(*) AS cnt FROM devices WHERE site_id = :site_id"),
            {"site_id": site_id},
        )
        total = total_result.fetchone().cnt

        if total == 0:
            return False

        offline_result = await session.execute(
            text(
                "SELECT count(*) AS cnt FROM devices "
                "WHERE site_id = :site_id AND is_online = false"
            ),
            {"site_id": site_id},
        )
        offline = offline_result.fetchone().cnt
        offline_pct = (offline / total) * 100
        return offline_pct > threshold

    elif rule_type == "device_offline_count":
        offline_result = await session.execute(
            text(
                "SELECT count(*) AS cnt FROM devices "
                "WHERE site_id = :site_id AND is_online = false"
            ),
            {"site_id": site_id},
        )
        offline = offline_result.fetchone().cnt
        return offline > threshold

    elif rule_type == "sector_signal_avg":
        if not sector_id:
            return False
        avg_result = await session.execute(
            text("""
                SELECT avg(wr.signal_strength) AS avg_signal
                FROM wireless_registrations wr
                JOIN devices d ON d.id = wr.device_id
                WHERE d.sector_id = :sector_id
                  AND wr.time > now() - interval '10 minutes'
            """),
            {"sector_id": sector_id},
        )
        row = avg_result.fetchone()
        if row is None or row.avg_signal is None:
            return False
        # Threshold is negative dBm (e.g., -75). Condition met when avg is worse (lower).
        return float(row.avg_signal) < threshold

    elif rule_type == "sector_client_drop":
        if not sector_id:
            return False

        # Current client count (last 10 minutes)
        current_result = await session.execute(
            text("""
                SELECT count(DISTINCT wr.mac_address) AS cnt
                FROM wireless_registrations wr
                JOIN devices d ON d.id = wr.device_id
                WHERE d.sector_id = :sector_id
                  AND wr.time > now() - interval '10 minutes'
            """),
            {"sector_id": sector_id},
        )
        current = current_result.fetchone().cnt

        # Previous client count (60-70 minutes ago)
        previous_result = await session.execute(
            text("""
                SELECT count(DISTINCT wr.mac_address) AS cnt
                FROM wireless_registrations wr
                JOIN devices d ON d.id = wr.device_id
                WHERE d.sector_id = :sector_id
                  AND wr.time BETWEEN now() - interval '70 minutes'
                                         AND now() - interval '60 minutes'
            """),
            {"sector_id": sector_id},
        )
        previous = previous_result.fetchone().cnt

        if previous == 0:
            return False

        drop_pct = ((previous - current) / previous) * 100
        return drop_pct > threshold

    else:
        logger.warning("unknown rule type", rule_type=rule_type, rule_id=str(rule.id))
        return False


async def _evaluate_rules() -> None:
    """Evaluate all enabled alert rules and create/resolve events with hysteresis."""
    async with AdminAsyncSessionLocal() as session:
        # Fetch all enabled rules across all tenants
        rules_result = await session.execute(
            text("SELECT * FROM site_alert_rules WHERE enabled = true")
        )
        rules = rules_result.fetchall()

        rules_checked = 0
        alerts_triggered = 0
        alerts_resolved = 0

        for rule in rules:
            rules_checked += 1
            rule_id = str(rule.id)
            condition_met = await _evaluate_condition(session, rule)

            # Check for existing active event for this rule
            existing_result = await session.execute(
                text("""
                    SELECT id, consecutive_hits FROM site_alert_events
                    WHERE rule_id = :rule_id
                      AND state = 'active'
                    ORDER BY triggered_at DESC
                    LIMIT 1
                """),
                {"rule_id": rule_id},
            )
            active_event = existing_result.fetchone()

            if condition_met:
                if active_event:
                    # Already active -- increment consecutive hits
                    await session.execute(
                        text("""
                            UPDATE site_alert_events
                            SET consecutive_hits = consecutive_hits + 1
                            WHERE id = :event_id
                        """),
                        {"event_id": str(active_event.id)},
                    )
                else:
                    # No active event -- create one with consecutive_hits=1.
                    # Events with consecutive_hits < 2 are considered "pending"
                    # (not yet confirmed). On next evaluation if still met,
                    # consecutive_hits increments to 2 (confirmed alert).
                    severity = "critical" if rule.rule_type in (
                        "device_offline_percent", "device_offline_count"
                    ) else "warning"

                    await session.execute(
                        text("""
                            INSERT INTO site_alert_events
                                (tenant_id, site_id, sector_id, rule_id,
                                 severity, message, state, consecutive_hits, triggered_at)
                            VALUES
                                (:tenant_id, :site_id, :sector_id, :rule_id,
                                 :severity, :message, 'active', 1, now())
                        """),
                        {
                            "tenant_id": str(rule.tenant_id),
                            "site_id": str(rule.site_id),
                            "sector_id": str(rule.sector_id) if rule.sector_id else None,
                            "rule_id": rule_id,
                            "severity": severity,
                            "message": f"Alert rule '{rule.name}' condition met",
                        },
                    )
                    alerts_triggered += 1

            else:
                # Condition not met
                if active_event:
                    # Auto-resolve: condition cleared
                    await session.execute(
                        text("""
                            UPDATE site_alert_events
                            SET state = 'resolved', resolved_at = now()
                            WHERE id = :event_id
                        """),
                        {"event_id": str(active_event.id)},
                    )
                    alerts_resolved += 1

        await session.commit()

        logger.info(
            "alert evaluation complete",
            rules_checked=rules_checked,
            alerts_triggered=alerts_triggered,
            resolved=alerts_resolved,
        )


async def alert_evaluation_loop() -> None:
    """Run alert rule evaluation on a configurable interval (default: 5 minutes)."""
    interval = getattr(settings, "ALERT_EVALUATION_INTERVAL_SECONDS", 300)
    while True:
        try:
            await _evaluate_rules()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("alert evaluation error", error=str(e))
        await asyncio.sleep(interval)
