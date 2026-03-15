"""Dynamic backup scheduler — reads cron schedules from DB, manages APScheduler jobs."""

import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import AdminAsyncSessionLocal
from app.models.config_backup import ConfigBackupSchedule
from app.models.device import Device
from app.services import backup_service

from sqlalchemy import select

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None

# System default: 2am UTC daily
DEFAULT_CRON = "0 2 * * *"


def _cron_to_trigger(cron_expr: str) -> Optional[CronTrigger]:
    """Parse a 5-field cron expression into an APScheduler CronTrigger.

    Returns None if the expression is invalid.
    """
    try:
        parts = cron_expr.strip().split()
        if len(parts) != 5:
            return None
        minute, hour, day, month, day_of_week = parts
        return CronTrigger(
            minute=minute,
            hour=hour,
            day=day,
            month=month,
            day_of_week=day_of_week,
            timezone="UTC",
        )
    except Exception as e:
        logger.warning("Invalid cron expression '%s': %s", cron_expr, e)
        return None


def build_schedule_map(schedules: list) -> dict[str, list[dict]]:
    """Group device schedules by cron expression.

    Returns: {cron_expression: [{device_id, tenant_id}, ...]}
    """
    schedule_map: dict[str, list[dict]] = {}
    for s in schedules:
        if not s.enabled:
            continue
        cron = s.cron_expression or DEFAULT_CRON
        if cron not in schedule_map:
            schedule_map[cron] = []
        schedule_map[cron].append(
            {
                "device_id": str(s.device_id),
                "tenant_id": str(s.tenant_id),
            }
        )
    return schedule_map


async def _run_scheduled_backups(devices: list[dict]) -> None:
    """Run backups for a list of devices. Each failure is isolated."""
    success_count = 0
    failure_count = 0

    for dev_info in devices:
        try:
            async with AdminAsyncSessionLocal() as session:
                await backup_service.run_backup(
                    device_id=dev_info["device_id"],
                    tenant_id=dev_info["tenant_id"],
                    trigger_type="scheduled",
                    db_session=session,
                )
                await session.commit()
            logger.info("Scheduled backup OK: device %s", dev_info["device_id"])
            success_count += 1
        except Exception as e:
            logger.error(
                "Scheduled backup FAILED: device %s: %s",
                dev_info["device_id"],
                e,
            )
            failure_count += 1

    logger.info(
        "Backup batch complete — %d succeeded, %d failed",
        success_count,
        failure_count,
    )


async def _load_effective_schedules() -> list:
    """Load all effective schedules from DB.

    For each device: use device-specific schedule if exists, else tenant default.
    Returns flat list of (device_id, tenant_id, cron_expression, enabled) objects.
    """
    from types import SimpleNamespace

    async with AdminAsyncSessionLocal() as session:
        # Get all devices
        dev_result = await session.execute(select(Device))
        devices = dev_result.scalars().all()

        # Get all schedules
        sched_result = await session.execute(select(ConfigBackupSchedule))
        schedules = sched_result.scalars().all()

    # Index: device-specific and tenant defaults
    device_schedules = {}  # device_id -> schedule
    tenant_defaults = {}  # tenant_id -> schedule

    for s in schedules:
        if s.device_id:
            device_schedules[str(s.device_id)] = s
        else:
            tenant_defaults[str(s.tenant_id)] = s

    effective = []
    for dev in devices:
        dev_id = str(dev.id)
        tenant_id = str(dev.tenant_id)

        if dev_id in device_schedules:
            sched = device_schedules[dev_id]
        elif tenant_id in tenant_defaults:
            sched = tenant_defaults[tenant_id]
        else:
            # No schedule configured — use system default
            sched = None

        effective.append(
            SimpleNamespace(
                device_id=dev_id,
                tenant_id=tenant_id,
                cron_expression=sched.cron_expression if sched else DEFAULT_CRON,
                enabled=sched.enabled if sched else True,
            )
        )

    return effective


async def sync_schedules() -> None:
    """Reload all schedules from DB and reconfigure APScheduler jobs."""
    global _scheduler
    if not _scheduler:
        return

    # Remove all existing backup jobs (keep other jobs like firmware check)
    for job in _scheduler.get_jobs():
        if job.id.startswith("backup_cron_"):
            job.remove()

    schedules = await _load_effective_schedules()
    schedule_map = build_schedule_map(schedules)

    for cron_expr, devices in schedule_map.items():
        trigger = _cron_to_trigger(cron_expr)
        if not trigger:
            logger.warning("Skipping invalid cron '%s', using default", cron_expr)
            trigger = _cron_to_trigger(DEFAULT_CRON)

        job_id = f"backup_cron_{cron_expr.replace(' ', '_')}"
        _scheduler.add_job(
            _run_scheduled_backups,
            trigger=trigger,
            args=[devices],
            id=job_id,
            name=f"Backup: {cron_expr} ({len(devices)} devices)",
            max_instances=1,
            replace_existing=True,
        )
        logger.info("Scheduled %d devices with cron '%s'", len(devices), cron_expr)


async def on_schedule_change(tenant_id: str, device_id: str) -> None:
    """Called when a schedule is created/updated via API. Hot-reloads all schedules."""
    logger.info("Schedule changed for tenant=%s device=%s, resyncing", tenant_id, device_id)
    await sync_schedules()


async def start_backup_scheduler() -> None:
    """Start the APScheduler and load initial schedules from DB."""
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()

    await sync_schedules()
    logger.info("Backup scheduler started with dynamic schedules")


async def stop_backup_scheduler() -> None:
    """Gracefully shutdown the scheduler."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Backup scheduler stopped")


class _SchedulerProxy:
    """Proxy to access the module-level scheduler from other modules.

    Usage: `from app.services.backup_scheduler import backup_scheduler`
    then `backup_scheduler.add_job(...)`.
    """

    def __getattr__(self, name):
        if _scheduler is None:
            raise RuntimeError("Backup scheduler not started yet")
        return getattr(_scheduler, name)


backup_scheduler = _SchedulerProxy()
