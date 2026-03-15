"""Firmware upgrade orchestration service.

Handles single-device and mass firmware upgrades with:
- Mandatory pre-upgrade config backup
- NPK download and SFTP upload to device
- Reboot trigger and reconnect polling
- Post-upgrade version verification
- Sequential mass rollout with pause-on-failure
- Scheduled upgrades via APScheduler DateTrigger

All DB operations use AdminAsyncSessionLocal to bypass RLS since upgrade
jobs may span multiple tenants and run in background asyncio tasks.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import asyncssh
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal
from app.services.event_publisher import publish_event

logger = logging.getLogger(__name__)

# Maximum time to wait for a device to reconnect after reboot (seconds)
_RECONNECT_TIMEOUT = 300  # 5 minutes
_RECONNECT_POLL_INTERVAL = 15  # seconds
_INITIAL_WAIT = 60  # Wait before first reconnect attempt (boot cycle)


async def start_upgrade(job_id: str) -> None:
    """Execute a single device firmware upgrade.

    Lifecycle: pending -> downloading -> uploading -> rebooting -> verifying -> completed/failed

    This function is designed to run as a background asyncio.create_task or
    APScheduler job. It never raises — all errors are caught and recorded
    in the FirmwareUpgradeJob row.
    """
    try:
        await _run_upgrade(job_id)
    except Exception as exc:
        logger.error("Uncaught exception in firmware upgrade %s: %s", job_id, exc, exc_info=True)
        await _update_job(job_id, status="failed", error_message=f"Unexpected error: {exc}")


async def _publish_upgrade_progress(
    tenant_id: str,
    device_id: str,
    job_id: str,
    stage: str,
    target_version: str,
    message: str,
    error: str | None = None,
) -> None:
    """Publish firmware upgrade progress event to NATS (fire-and-forget)."""
    payload = {
        "event_type": "firmware_progress",
        "tenant_id": tenant_id,
        "device_id": device_id,
        "job_id": job_id,
        "stage": stage,
        "target_version": target_version,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if error:
        payload["error"] = error
    await publish_event(f"firmware.progress.{tenant_id}.{device_id}", payload)


async def _run_upgrade(job_id: str) -> None:
    """Internal upgrade implementation."""

    # Step 1: Load job
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT j.id, j.device_id, j.tenant_id, j.target_version,
                       j.architecture, j.channel, j.status, j.confirmed_major_upgrade,
                       d.ip_address, d.hostname, d.encrypted_credentials,
                       d.routeros_version, d.encrypted_credentials_transit
                FROM firmware_upgrade_jobs j
                JOIN devices d ON d.id = j.device_id
                WHERE j.id = CAST(:job_id AS uuid)
            """),
            {"job_id": job_id},
        )
        row = result.fetchone()

    if not row:
        logger.error("Upgrade job %s not found", job_id)
        return

    (
        _,
        device_id,
        tenant_id,
        target_version,
        architecture,
        channel,
        status,
        confirmed_major,
        ip_address,
        hostname,
        encrypted_credentials,
        current_version,
        encrypted_credentials_transit,
    ) = row

    device_id = str(device_id)
    tenant_id = str(tenant_id)
    hostname = hostname or ip_address

    # Skip if already running or completed
    if status not in ("pending", "scheduled"):
        logger.info("Upgrade job %s already in status %s — skipping", job_id, status)
        return

    logger.info(
        "Starting firmware upgrade for %s (%s): %s -> %s",
        hostname,
        ip_address,
        current_version,
        target_version,
    )

    # Step 2: Update status to downloading
    await _update_job(job_id, status="downloading", started_at=datetime.now(timezone.utc))
    await _publish_upgrade_progress(
        tenant_id,
        device_id,
        job_id,
        "downloading",
        target_version,
        f"Downloading firmware {target_version} for {hostname}",
    )

    # Step 3: Check major version upgrade confirmation
    if current_version and target_version:
        current_major = current_version.split(".")[0] if current_version else ""
        target_major = target_version.split(".")[0]
        if current_major != target_major and not confirmed_major:
            await _update_job(
                job_id,
                status="failed",
                error_message="Major version upgrade requires explicit confirmation",
            )
            await _publish_upgrade_progress(
                tenant_id,
                device_id,
                job_id,
                "failed",
                target_version,
                f"Major version upgrade requires explicit confirmation for {hostname}",
                error="Major version upgrade requires explicit confirmation",
            )
            return

    # Step 4: Mandatory config backup
    logger.info("Running mandatory pre-upgrade backup for %s", hostname)
    try:
        from app.services import backup_service

        backup_result = await backup_service.run_backup(
            device_id=device_id,
            tenant_id=tenant_id,
            trigger_type="pre-upgrade",
        )
        backup_sha = backup_result["commit_sha"]
        await _update_job(job_id, pre_upgrade_backup_sha=backup_sha)
        logger.info("Pre-upgrade backup complete: %s", backup_sha[:8])
    except Exception as backup_err:
        logger.error("Pre-upgrade backup failed for %s: %s", hostname, backup_err)
        await _update_job(
            job_id,
            status="failed",
            error_message=f"Pre-upgrade backup failed: {backup_err}",
        )
        await _publish_upgrade_progress(
            tenant_id,
            device_id,
            job_id,
            "failed",
            target_version,
            f"Pre-upgrade backup failed for {hostname}",
            error=str(backup_err),
        )
        return

    # Step 5: Download NPK
    logger.info("Downloading firmware %s for %s/%s", target_version, architecture, channel)
    try:
        from app.services.firmware_service import download_firmware

        npk_path = await download_firmware(architecture, channel, target_version)
        logger.info("Firmware cached at %s", npk_path)
    except Exception as dl_err:
        logger.error("Firmware download failed: %s", dl_err)
        await _update_job(
            job_id,
            status="failed",
            error_message=f"Firmware download failed: {dl_err}",
        )
        await _publish_upgrade_progress(
            tenant_id,
            device_id,
            job_id,
            "failed",
            target_version,
            f"Firmware download failed for {hostname}",
            error=str(dl_err),
        )
        return

    # Step 6: Upload NPK to device via SFTP
    await _update_job(job_id, status="uploading")
    await _publish_upgrade_progress(
        tenant_id,
        device_id,
        job_id,
        "uploading",
        target_version,
        f"Uploading firmware to {hostname}",
    )

    # Decrypt device credentials (dual-read: Transit preferred, legacy fallback)
    if not encrypted_credentials_transit and not encrypted_credentials:
        await _update_job(job_id, status="failed", error_message="Device has no stored credentials")
        await _publish_upgrade_progress(
            tenant_id,
            device_id,
            job_id,
            "failed",
            target_version,
            f"No stored credentials for {hostname}",
            error="Device has no stored credentials",
        )
        return

    try:
        from app.services.crypto import decrypt_credentials_hybrid

        key = settings.get_encryption_key_bytes()
        creds_json = await decrypt_credentials_hybrid(
            encrypted_credentials_transit,
            encrypted_credentials,
            tenant_id,
            key,
        )
        creds = json.loads(creds_json)
        ssh_username = creds.get("username", "")
        ssh_password = creds.get("password", "")
    except Exception as cred_err:
        await _update_job(
            job_id,
            status="failed",
            error_message=f"Failed to decrypt credentials: {cred_err}",
        )
        await _publish_upgrade_progress(
            tenant_id,
            device_id,
            job_id,
            "failed",
            target_version,
            f"Failed to decrypt credentials for {hostname}",
            error=str(cred_err),
        )
        return

    try:
        npk_data = Path(npk_path).read_bytes()
        npk_filename = Path(npk_path).name

        async with asyncssh.connect(
            ip_address,
            port=22,
            username=ssh_username,
            password=ssh_password,
            known_hosts=None,
            connect_timeout=30,
        ) as conn:
            async with conn.start_sftp_client() as sftp:
                async with sftp.open(f"/{npk_filename}", "wb") as f:
                    await f.write(npk_data)
            logger.info("Uploaded %s to %s", npk_filename, hostname)
    except Exception as upload_err:
        logger.error("NPK upload failed for %s: %s", hostname, upload_err)
        await _update_job(
            job_id,
            status="failed",
            error_message=f"NPK upload failed: {upload_err}",
        )
        await _publish_upgrade_progress(
            tenant_id,
            device_id,
            job_id,
            "failed",
            target_version,
            f"NPK upload failed for {hostname}",
            error=str(upload_err),
        )
        return

    # Step 7: Trigger reboot
    await _update_job(job_id, status="rebooting")
    await _publish_upgrade_progress(
        tenant_id,
        device_id,
        job_id,
        "rebooting",
        target_version,
        f"Rebooting {hostname} for firmware install",
    )
    try:
        async with asyncssh.connect(
            ip_address,
            port=22,
            username=ssh_username,
            password=ssh_password,
            known_hosts=None,
            connect_timeout=30,
        ) as conn:
            # RouterOS will install NPK on boot
            await conn.run("/system reboot", check=False)
            logger.info("Reboot command sent to %s", hostname)
    except Exception as reboot_err:
        # Device may drop connection during reboot — this is expected
        logger.info(
            "Device %s dropped connection after reboot command (expected): %s", hostname, reboot_err
        )

    # Step 8: Wait for reconnect
    logger.info("Waiting %ds before polling %s for reconnect", _INITIAL_WAIT, hostname)
    await asyncio.sleep(_INITIAL_WAIT)

    reconnected = False
    elapsed = 0
    while elapsed < _RECONNECT_TIMEOUT:
        if await _check_ssh_reachable(ip_address, ssh_username, ssh_password):
            reconnected = True
            break
        await asyncio.sleep(_RECONNECT_POLL_INTERVAL)
        elapsed += _RECONNECT_POLL_INTERVAL

    if not reconnected:
        logger.error("Device %s did not reconnect within %ds", hostname, _RECONNECT_TIMEOUT)
        await _update_job(
            job_id,
            status="failed",
            error_message=f"Device did not reconnect within {_RECONNECT_TIMEOUT // 60} minutes after reboot",
        )
        await _publish_upgrade_progress(
            tenant_id,
            device_id,
            job_id,
            "failed",
            target_version,
            f"Device {hostname} did not reconnect within {_RECONNECT_TIMEOUT // 60} minutes",
            error="Reconnect timeout",
        )
        return

    # Step 9: Verify upgrade
    await _update_job(job_id, status="verifying")
    await _publish_upgrade_progress(
        tenant_id,
        device_id,
        job_id,
        "verifying",
        target_version,
        f"Verifying firmware version on {hostname}",
    )
    try:
        actual_version = await _get_device_version(ip_address, ssh_username, ssh_password)
        if actual_version and target_version in actual_version:
            logger.info(
                "Firmware upgrade verified for %s: %s",
                hostname,
                actual_version,
            )
            await _update_job(
                job_id,
                status="completed",
                completed_at=datetime.now(timezone.utc),
            )
            await _publish_upgrade_progress(
                tenant_id,
                device_id,
                job_id,
                "completed",
                target_version,
                f"Firmware upgrade to {target_version} completed on {hostname}",
            )
        else:
            logger.error(
                "Version mismatch for %s: expected %s, got %s",
                hostname,
                target_version,
                actual_version,
            )
            await _update_job(
                job_id,
                status="failed",
                error_message=f"Expected {target_version} but got {actual_version}",
            )
            await _publish_upgrade_progress(
                tenant_id,
                device_id,
                job_id,
                "failed",
                target_version,
                f"Version mismatch on {hostname}: expected {target_version}, got {actual_version}",
                error=f"Expected {target_version} but got {actual_version}",
            )
    except Exception as verify_err:
        logger.error("Post-upgrade verification failed for %s: %s", hostname, verify_err)
        await _update_job(
            job_id,
            status="failed",
            error_message=f"Post-upgrade verification failed: {verify_err}",
        )
        await _publish_upgrade_progress(
            tenant_id,
            device_id,
            job_id,
            "failed",
            target_version,
            f"Post-upgrade verification failed for {hostname}",
            error=str(verify_err),
        )


async def start_mass_upgrade(rollout_group_id: str) -> dict:
    """Execute a sequential mass firmware upgrade.

    Processes upgrade jobs one at a time. If any device fails,
    all remaining jobs in the group are paused.

    Returns summary dict with completed/failed/paused counts.
    """
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT j.id, j.status, d.hostname
                FROM firmware_upgrade_jobs j
                JOIN devices d ON d.id = j.device_id
                WHERE j.rollout_group_id = CAST(:group_id AS uuid)
                ORDER BY j.created_at ASC
            """),
            {"group_id": rollout_group_id},
        )
        jobs = result.fetchall()

    if not jobs:
        logger.warning("No jobs found for rollout group %s", rollout_group_id)
        return {"completed": 0, "failed": 0, "paused": 0}

    completed = 0
    failed_device = None

    for job_id, current_status, hostname in jobs:
        job_id_str = str(job_id)

        # Only process pending/scheduled jobs
        if current_status not in ("pending", "scheduled"):
            if current_status == "completed":
                completed += 1
            continue

        logger.info("Mass rollout: upgrading device %s (job %s)", hostname, job_id_str)
        await start_upgrade(job_id_str)

        # Check if it completed or failed
        async with AdminAsyncSessionLocal() as session:
            result = await session.execute(
                text("SELECT status FROM firmware_upgrade_jobs WHERE id = CAST(:id AS uuid)"),
                {"id": job_id_str},
            )
            row = result.fetchone()

        if row and row[0] == "completed":
            completed += 1
        elif row and row[0] == "failed":
            failed_device = hostname
            logger.error("Mass rollout paused: %s failed", hostname)
            break

    # Pause remaining jobs if one failed
    paused = 0
    if failed_device:
        async with AdminAsyncSessionLocal() as session:
            result = await session.execute(
                text("""
                    UPDATE firmware_upgrade_jobs
                    SET status = 'paused'
                    WHERE rollout_group_id = CAST(:group_id AS uuid)
                      AND status IN ('pending', 'scheduled')
                    RETURNING id
                """),
                {"group_id": rollout_group_id},
            )
            paused = len(result.fetchall())
            await session.commit()

    return {
        "completed": completed,
        "failed": 1 if failed_device else 0,
        "failed_device": failed_device,
        "paused": paused,
    }


def schedule_upgrade(job_id: str, scheduled_at: datetime) -> None:
    """Schedule a firmware upgrade for future execution via APScheduler."""
    from app.services.backup_scheduler import backup_scheduler

    backup_scheduler.add_job(
        start_upgrade,
        trigger="date",
        run_date=scheduled_at,
        args=[job_id],
        id=f"fw_upgrade_{job_id}",
        name=f"Firmware upgrade {job_id}",
        max_instances=1,
        replace_existing=True,
    )
    logger.info("Scheduled firmware upgrade %s for %s", job_id, scheduled_at)


def schedule_mass_upgrade(rollout_group_id: str, scheduled_at: datetime) -> None:
    """Schedule a mass firmware upgrade for future execution."""
    from app.services.backup_scheduler import backup_scheduler

    backup_scheduler.add_job(
        start_mass_upgrade,
        trigger="date",
        run_date=scheduled_at,
        args=[rollout_group_id],
        id=f"fw_mass_upgrade_{rollout_group_id}",
        name=f"Mass firmware upgrade {rollout_group_id}",
        max_instances=1,
        replace_existing=True,
    )
    logger.info("Scheduled mass firmware upgrade %s for %s", rollout_group_id, scheduled_at)


async def cancel_upgrade(job_id: str) -> None:
    """Cancel a scheduled or pending upgrade."""
    from app.services.backup_scheduler import backup_scheduler

    # Remove APScheduler job if it exists
    try:
        backup_scheduler.remove_job(f"fw_upgrade_{job_id}")
    except Exception:
        pass  # Job might not be scheduled

    await _update_job(
        job_id,
        status="failed",
        error_message="Cancelled by operator",
        completed_at=datetime.now(timezone.utc),
    )
    logger.info("Upgrade job %s cancelled", job_id)


async def retry_failed_upgrade(job_id: str) -> None:
    """Reset a failed upgrade job to pending and re-execute."""
    await _update_job(
        job_id,
        status="pending",
        error_message=None,
        started_at=None,
        completed_at=None,
    )
    asyncio.create_task(start_upgrade(job_id))
    logger.info("Retrying upgrade job %s", job_id)


async def resume_mass_upgrade(rollout_group_id: str) -> None:
    """Resume a paused mass rollout from where it left off."""
    # Reset first paused job to pending, then restart sequential processing
    async with AdminAsyncSessionLocal() as session:
        await session.execute(
            text("""
                UPDATE firmware_upgrade_jobs
                SET status = 'pending'
                WHERE rollout_group_id = CAST(:group_id AS uuid)
                  AND status = 'paused'
            """),
            {"group_id": rollout_group_id},
        )
        await session.commit()

    asyncio.create_task(start_mass_upgrade(rollout_group_id))
    logger.info("Resuming mass rollout %s", rollout_group_id)


async def abort_mass_upgrade(rollout_group_id: str) -> int:
    """Abort all remaining jobs in a paused mass rollout."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                UPDATE firmware_upgrade_jobs
                SET status = 'failed',
                    error_message = 'Aborted by operator',
                    completed_at = NOW()
                WHERE rollout_group_id = CAST(:group_id AS uuid)
                  AND status IN ('pending', 'scheduled', 'paused')
                RETURNING id
            """),
            {"group_id": rollout_group_id},
        )
        aborted = len(result.fetchall())
        await session.commit()

    logger.info("Aborted %d remaining jobs in rollout %s", aborted, rollout_group_id)
    return aborted


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _update_job(job_id: str, **kwargs) -> None:
    """Update FirmwareUpgradeJob fields."""
    sets = []
    params: dict = {"job_id": job_id}

    for key, value in kwargs.items():
        param_name = f"v_{key}"
        if value is None and key in ("error_message", "started_at", "completed_at"):
            sets.append(f"{key} = NULL")
        else:
            sets.append(f"{key} = :{param_name}")
            params[param_name] = value

    if not sets:
        return

    async with AdminAsyncSessionLocal() as session:
        await session.execute(
            text(f"""
                UPDATE firmware_upgrade_jobs
                SET {", ".join(sets)}
                WHERE id = CAST(:job_id AS uuid)
            """),
            params,
        )
        await session.commit()


async def _check_ssh_reachable(ip: str, username: str, password: str) -> bool:
    """Check if a device is reachable via SSH."""
    try:
        async with asyncssh.connect(
            ip,
            port=22,
            username=username,
            password=password,
            known_hosts=None,
            connect_timeout=15,
        ) as conn:
            await conn.run("/system identity print", check=True)
            return True
    except Exception:
        return False


async def _get_device_version(ip: str, username: str, password: str) -> str:
    """Get the current RouterOS version from a device via SSH."""
    async with asyncssh.connect(
        ip,
        port=22,
        username=username,
        password=password,
        known_hosts=None,
        connect_timeout=30,
    ) as conn:
        result = await conn.run("/system resource print", check=True)
        # Parse version from output: "version: 7.17 (stable)"
        for line in result.stdout.splitlines():
            if "version" in line.lower():
                parts = line.split(":", 1)
                if len(parts) == 2:
                    return parts[1].strip()
    return ""
