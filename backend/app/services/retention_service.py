"""Retention cleanup service — deletes config snapshots older than CONFIG_RETENTION_DAYS.

Runs as an APScheduler IntervalTrigger job (every 24h). CASCADE FK constraints
on router_config_diffs and router_config_changes handle associated data automatically.
"""

import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from prometheus_client import Counter, Histogram
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None

# Prometheus metrics
config_snapshots_cleaned_total = Counter(
    "config_snapshots_cleaned_total",
    "Cumulative count of expired config snapshots deleted by retention cleanup",
)
config_retention_cleanup_duration_seconds = Histogram(
    "config_retention_cleanup_duration_seconds",
    "Duration of retention cleanup execution",
)


async def cleanup_expired_snapshots() -> int:
    """Delete config snapshots older than CONFIG_RETENTION_DAYS.

    CASCADE FK constraints on router_config_diffs and router_config_changes
    automatically remove associated rows.

    Returns the number of deleted snapshots.
    """
    days = settings.CONFIG_RETENTION_DAYS

    with config_retention_cleanup_duration_seconds.time():
        async with AdminAsyncSessionLocal() as session:
            result = await session.execute(
                text(
                    "DELETE FROM router_config_snapshots "
                    "WHERE collected_at < NOW() - make_interval(days => :days)"
                ),
                {"days": days},
            )
            await session.commit()
            deleted = result.rowcount

    config_snapshots_cleaned_total.inc(deleted)
    logger.info("retention cleanup complete", extra={"deleted_snapshots": deleted, "retention_days": days})
    return deleted


async def start_retention_scheduler() -> None:
    """Start APScheduler with a 24-hour interval job for retention cleanup."""
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        cleanup_expired_snapshots,
        trigger=IntervalTrigger(hours=24, jitter=3600),
        id="retention_cleanup",
        name="Config snapshot retention cleanup",
        max_instances=1,
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(
        "retention scheduler started (every 24h, retention_days=%d)",
        settings.CONFIG_RETENTION_DAYS,
    )


async def stop_retention_scheduler() -> None:
    """Gracefully shutdown the retention scheduler."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("retention scheduler stopped")
