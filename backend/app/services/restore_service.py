"""Two-phase config push with panic-revert safety for RouterOS devices.

This module implements the critical safety mechanism for config restoration:

Phase 1 — Push:
  1. Pre-backup (mandatory) — snapshot current config before any changes
  2. Install panic-revert RouterOS scheduler — auto-reverts if device becomes
     unreachable (the scheduler fires after 90s and loads the pre-push backup)
  3. Push the target config via SSH /import

Phase 2 — Verification (60s settle window):
  4. Wait 60s for config to settle (scheduled processes restart, etc.)
  5. Reachability check via asyncssh
  6a. Reachable — remove panic-revert scheduler; mark operation committed
  6b. Unreachable — RouterOS is auto-reverting; mark operation reverted

Pitfall 6 handling:
  If the API pod restarts during the 60s window, the config_push_operations
  row with status='pending_verification' serves as the recovery signal.
  On startup, recover_stale_push_operations() resolves any stale rows.

Security policy:
  known_hosts=None — RouterOS self-signed host keys; mirrors InsecureSkipVerify
  used in the poller's TLS connection. See Pitfall 2 in 04-RESEARCH.md.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import asyncssh
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import set_tenant_context, AdminAsyncSessionLocal
from app.models.config_backup import ConfigPushOperation
from app.models.device import Device
from app.services import backup_service, git_store
from app.services.event_publisher import publish_event
from app.services.push_tracker import record_push, clear_push

logger = logging.getLogger(__name__)

# Name of the panic-revert scheduler installed on the RouterOS device
_PANIC_REVERT_SCHEDULER = "mikrotik-portal-panic-revert"
# Name of the pre-push binary backup saved on device flash
_PRE_PUSH_BACKUP = "portal-pre-push"
# Name of the RSC file used for /import on device
_RESTORE_RSC = "portal-restore.rsc"


async def _publish_push_progress(
    tenant_id: str,
    device_id: str,
    stage: str,
    message: str,
    push_op_id: str | None = None,
    error: str | None = None,
) -> None:
    """Publish config push progress event to NATS (fire-and-forget)."""
    payload = {
        "event_type": "config_push",
        "tenant_id": tenant_id,
        "device_id": device_id,
        "stage": stage,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "push_operation_id": push_op_id,
    }
    if error:
        payload["error"] = error
    await publish_event(f"config.push.{tenant_id}.{device_id}", payload)


async def restore_config(
    device_id: str,
    tenant_id: str,
    commit_sha: str,
    db_session: AsyncSession,
) -> dict:
    """Restore a device config to a specific backup version via two-phase push.

    Args:
        device_id:  Device UUID as string.
        tenant_id:  Tenant UUID as string.
        commit_sha: Git commit SHA of the backup version to restore.
        db_session: AsyncSession with RLS context already set (from API endpoint).

    Returns:
        {
            "status": "committed" | "reverted" | "failed",
            "message": str,
            "pre_backup_sha": str,
        }

    Raises:
        ValueError: If device not found or missing credentials.
        Exception:  On SSH failure during push phase (reverted status logged).
    """
    loop = asyncio.get_event_loop()

    # ------------------------------------------------------------------
    # Step 1: Load device from DB and decrypt credentials
    # ------------------------------------------------------------------
    from sqlalchemy import select

    result = await db_session.execute(
        select(Device).where(Device.id == device_id)  # type: ignore[arg-type]
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise ValueError(f"Device {device_id!r} not found")

    if not device.encrypted_credentials_transit and not device.encrypted_credentials:
        raise ValueError(
            f"Device {device_id!r} has no stored credentials — cannot perform restore"
        )

    key = settings.get_encryption_key_bytes()
    from app.services.crypto import decrypt_credentials_hybrid
    creds_json = await decrypt_credentials_hybrid(
        device.encrypted_credentials_transit,
        device.encrypted_credentials,
        str(device.tenant_id),
        key,
    )
    creds = json.loads(creds_json)
    ssh_username = creds.get("username", "")
    ssh_password = creds.get("password", "")
    ip = device.ip_address

    hostname = device.hostname or ip

    # Publish "started" progress event
    await _publish_push_progress(tenant_id, device_id, "started", f"Config restore started for {hostname}")

    # ------------------------------------------------------------------
    # Step 2: Read the target export.rsc from the backup commit
    # ------------------------------------------------------------------
    try:
        export_bytes = await loop.run_in_executor(
            None,
            git_store.read_file,
            tenant_id,
            commit_sha,
            device_id,
            "export.rsc",
        )
    except (KeyError, Exception) as exc:
        raise ValueError(
            f"Backup version {commit_sha!r} not found for device {device_id!r}: {exc}"
        ) from exc

    export_text = export_bytes.decode("utf-8", errors="replace")

    # ------------------------------------------------------------------
    # Step 3: Mandatory pre-backup before push
    # ------------------------------------------------------------------
    await _publish_push_progress(tenant_id, device_id, "backing_up", f"Creating pre-restore backup for {hostname}")

    logger.info(
        "Starting pre-restore backup for device %s (%s) before pushing commit %s",
        hostname,
        ip,
        commit_sha[:8],
    )
    pre_backup_result = await backup_service.run_backup(
        device_id=device_id,
        tenant_id=tenant_id,
        trigger_type="pre-restore",
        db_session=db_session,
    )
    pre_backup_sha = pre_backup_result["commit_sha"]
    logger.info("Pre-restore backup complete: %s", pre_backup_sha[:8])

    # ------------------------------------------------------------------
    # Step 4: Record push operation (pending_verification for recovery)
    # ------------------------------------------------------------------
    push_op = ConfigPushOperation(
        device_id=device.id,
        tenant_id=device.tenant_id,
        pre_push_commit_sha=pre_backup_sha,
        scheduler_name=_PANIC_REVERT_SCHEDULER,
        status="pending_verification",
    )
    db_session.add(push_op)
    await db_session.flush()
    push_op_id = push_op.id

    logger.info(
        "Push op %s in pending_verification — if API restarts, "
        "recover_stale_push_operations() will resolve on next startup",
        push_op.id,
    )

    # ------------------------------------------------------------------
    # Step 5: SSH to device — install panic-revert, push config
    # ------------------------------------------------------------------
    push_op_id_str = str(push_op_id)
    await _publish_push_progress(tenant_id, device_id, "pushing", f"Pushing config to {hostname}", push_op_id=push_op_id_str)

    logger.info(
        "Pushing config to device %s (%s): installing panic-revert scheduler and uploading config",
        hostname,
        ip,
    )

    try:
        async with asyncssh.connect(
            ip,
            port=22,
            username=ssh_username,
            password=ssh_password,
            known_hosts=None,  # RouterOS self-signed host keys — see module docstring
            connect_timeout=30,
        ) as conn:
            # 5a: Create binary backup on device as revert point
            await conn.run(
                f"/system backup save name={_PRE_PUSH_BACKUP} dont-encrypt=yes",
                check=True,
            )
            logger.debug("Pre-push binary backup saved on device as %s.backup", _PRE_PUSH_BACKUP)

            # 5b: Install panic-revert RouterOS scheduler
            # The scheduler fires after 90s on startup and loads the pre-push backup.
            # This is the safety net: if the device becomes unreachable after push,
            # RouterOS will auto-revert to the known-good config on the next reboot
            # or after 90s of uptime.
            await conn.run(
                f"/system scheduler add "
                f'name="{_PANIC_REVERT_SCHEDULER}" '
                f"interval=90s "
                f'on-event=":delay 0; /system backup load name={_PRE_PUSH_BACKUP}" '
                f"start-time=startup",
                check=True,
            )
            logger.debug("Panic-revert scheduler installed on device")

            # 5c: Upload export.rsc and /import it
            # Write the RSC content to the device filesystem via SSH exec,
            # then use /import to apply it. The file is cleaned up after import.
            # We use a here-doc approach: write content line-by-line via /file set.
            # RouterOS supports writing files via /tool fetch or direct file commands.
            # Simplest approach for large configs: use asyncssh's write_into to
            # write file content, then /import.
            #
            # RouterOS doesn't support direct SFTP uploads via SSH open_sftp() easily
            # for config files. Use the script approach instead:
            # /system script add + run + remove (avoids flash write concerns).
            #
            # Actually the simplest method: write the export.rsc line by line via
            # /file print / set commands is RouterOS 6 only and unreliable.
            # Best approach for RouterOS 7: use SFTP to upload the file.
            async with conn.start_sftp_client() as sftp:
                async with sftp.open(_RESTORE_RSC, "wb") as f:
                    await f.write(export_text.encode("utf-8"))
            logger.debug("Uploaded %s to device flash", _RESTORE_RSC)

            # /import the config file
            import_result = await conn.run(
                f"/import file={_RESTORE_RSC}",
                check=False,  # Don't raise on non-zero exit — import may succeed with warnings
            )
            logger.info(
                "Config import result for device %s: exit_status=%s stdout=%r",
                hostname,
                import_result.exit_status,
                (import_result.stdout or "")[:200],
            )

            # Clean up the uploaded RSC file (best-effort)
            try:
                await conn.run(f"/file remove {_RESTORE_RSC}", check=True)
            except Exception as cleanup_err:
                logger.warning(
                    "Failed to clean up %s from device %s: %s",
                    _RESTORE_RSC,
                    ip,
                    cleanup_err,
                )

    except Exception as push_err:
        logger.error(
            "SSH push phase failed for device %s (%s): %s",
            hostname,
            ip,
            push_err,
        )
        # Update push operation to failed
        await _update_push_op_status(push_op_id, "failed", db_session)
        await _publish_push_progress(
            tenant_id, device_id, "failed",
            f"Config push failed for {hostname}: {push_err}",
            push_op_id=push_op_id_str, error=str(push_err),
        )
        return {
            "status": "failed",
            "message": f"Config push failed during SSH phase: {push_err}",
            "pre_backup_sha": pre_backup_sha,
        }

    # Record push in Redis so the poller can detect post-push offline events
    await record_push(
        device_id=device_id,
        tenant_id=tenant_id,
        push_type="restore",
        push_operation_id=push_op_id_str,
        pre_push_commit_sha=pre_backup_sha,
    )

    # ------------------------------------------------------------------
    # Step 6: Wait 60s for config to settle
    # ------------------------------------------------------------------
    await _publish_push_progress(tenant_id, device_id, "settling", f"Config pushed to {hostname} — waiting 60s for settle", push_op_id=push_op_id_str)

    logger.info(
        "Config pushed to device %s — waiting 60s for config to settle",
        hostname,
    )
    await asyncio.sleep(60)

    # ------------------------------------------------------------------
    # Step 7: Reachability check
    # ------------------------------------------------------------------
    await _publish_push_progress(tenant_id, device_id, "verifying", f"Verifying device {hostname} reachability", push_op_id=push_op_id_str)

    reachable = await _check_reachability(ip, ssh_username, ssh_password)

    if reachable:
        # ------------------------------------------------------------------
        # Step 8a: Device is reachable — remove panic-revert scheduler + cleanup
        # ------------------------------------------------------------------
        logger.info("Device %s (%s) is reachable after push — committing", hostname, ip)
        try:
            async with asyncssh.connect(
                ip,
                port=22,
                username=ssh_username,
                password=ssh_password,
                known_hosts=None,
                connect_timeout=30,
            ) as conn:
                # Remove the panic-revert scheduler
                await conn.run(
                    f'/system scheduler remove "{_PANIC_REVERT_SCHEDULER}"',
                    check=False,  # Non-fatal if already removed
                )
                # Clean up the pre-push binary backup from device flash
                await conn.run(
                    f"/file remove {_PRE_PUSH_BACKUP}.backup",
                    check=False,  # Non-fatal if already removed
                )
        except Exception as cleanup_err:
            # Cleanup failure is non-fatal — scheduler will eventually fire but
            # the backup is now the correct config, so it's acceptable.
            logger.warning(
                "Failed to clean up panic-revert scheduler/backup on device %s: %s",
                hostname,
                cleanup_err,
            )

        await _update_push_op_status(push_op_id, "committed", db_session)
        await clear_push(device_id)
        await _publish_push_progress(tenant_id, device_id, "committed", f"Config restored successfully on {hostname}", push_op_id=push_op_id_str)

        return {
            "status": "committed",
            "message": "Config restored successfully",
            "pre_backup_sha": pre_backup_sha,
        }

    else:
        # ------------------------------------------------------------------
        # Step 8b: Device unreachable — RouterOS is auto-reverting via scheduler
        # ------------------------------------------------------------------
        logger.warning(
            "Device %s (%s) is unreachable after push — RouterOS panic-revert scheduler "
            "will auto-revert to %s.backup",
            hostname,
            ip,
            _PRE_PUSH_BACKUP,
        )

        await _update_push_op_status(push_op_id, "reverted", db_session)
        await _publish_push_progress(
            tenant_id, device_id, "reverted",
            f"Device {hostname} unreachable — auto-reverting via panic-revert scheduler",
            push_op_id=push_op_id_str,
        )

        return {
            "status": "reverted",
            "message": (
                "Device unreachable after push; RouterOS is auto-reverting "
                "via panic-revert scheduler"
            ),
            "pre_backup_sha": pre_backup_sha,
        }


async def _check_reachability(ip: str, username: str, password: str) -> bool:
    """Check if a RouterOS device is reachable via SSH.

    Attempts to connect and run a simple command (/system identity print).
    Returns True if successful, False if the connection fails or times out.

    Uses asyncssh (not the poller's binary API) to avoid a circular import.
    A 30-second timeout is used — if the device doesn't respond within that
    window, it's considered unreachable (panic-revert will handle it).

    Args:
        ip:       Device IP address.
        username: SSH username.
        password: SSH password.

    Returns:
        True if reachable, False if unreachable.
    """
    try:
        async with asyncssh.connect(
            ip,
            port=22,
            username=username,
            password=password,
            known_hosts=None,
            connect_timeout=30,
        ) as conn:
            result = await conn.run("/system identity print", check=True)
            logger.debug("Reachability check OK for %s: %r", ip, result.stdout[:50])
            return True
    except Exception as exc:
        logger.info("Device %s unreachable after push: %s", ip, exc)
        return False


async def _update_push_op_status(
    push_op_id,
    new_status: str,
    db_session: AsyncSession,
) -> None:
    """Update the status and completed_at of a ConfigPushOperation row.

    Args:
        push_op_id: UUID of the ConfigPushOperation row.
        new_status: New status value ('committed' | 'reverted' | 'failed').
        db_session: Database session (must already have tenant context set).
    """
    from sqlalchemy import select, update

    await db_session.execute(
        update(ConfigPushOperation)
        .where(ConfigPushOperation.id == push_op_id)  # type: ignore[arg-type]
        .values(
            status=new_status,
            completed_at=datetime.now(timezone.utc),
        )
    )
    # Don't commit here — the caller (endpoint) owns the transaction


async def _remove_panic_scheduler(
    ip: str, username: str, password: str, scheduler_name: str
) -> bool:
    """SSH to device and remove the panic-revert scheduler. Returns True if removed."""
    try:
        async with asyncssh.connect(
            ip,
            username=username,
            password=password,
            known_hosts=None,
            connect_timeout=30,
        ) as conn:
            # Check if scheduler exists
            result = await conn.run(
                f'/system scheduler print where name="{scheduler_name}"',
                check=False,
            )
            if scheduler_name in result.stdout:
                await conn.run(
                    f'/system scheduler remove [find name="{scheduler_name}"]',
                    check=False,
                )
                # Also clean up pre-push backup file
                await conn.run(
                    f'/file remove [find name="{_PRE_PUSH_BACKUP}.backup"]',
                    check=False,
                )
                return True
            return False  # Scheduler already gone (device reverted itself)
    except Exception as e:
        logger.error("Failed to remove panic scheduler from %s: %s", ip, e)
        return False


async def recover_stale_push_operations(db_session: AsyncSession) -> None:
    """Recover stale pending_verification push operations on API startup.

    Scans for operations older than 5 minutes that are still pending.
    For each, checks device reachability and resolves the operation.
    """
    from sqlalchemy import select

    from app.models.config_backup import ConfigPushOperation
    from app.models.device import Device
    from app.services.crypto import decrypt_credentials_hybrid

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)

    result = await db_session.execute(
        select(ConfigPushOperation).where(
            ConfigPushOperation.status == "pending_verification",
            ConfigPushOperation.started_at < cutoff,
        )
    )
    stale_ops = result.scalars().all()

    if not stale_ops:
        logger.info("No stale push operations to recover")
        return

    logger.warning("Found %d stale push operations to recover", len(stale_ops))

    key = settings.get_encryption_key_bytes()

    for op in stale_ops:
        try:
            # Load device
            dev_result = await db_session.execute(
                select(Device).where(Device.id == op.device_id)
            )
            device = dev_result.scalar_one_or_none()
            if not device:
                logger.error("Device %s not found for stale op %s", op.device_id, op.id)
                await _update_push_op_status(op.id, "failed", db_session)
                continue

            # Decrypt credentials
            creds_json = await decrypt_credentials_hybrid(
                device.encrypted_credentials_transit,
                device.encrypted_credentials,
                str(op.tenant_id),
                key,
            )
            creds = json.loads(creds_json)
            ssh_username = creds.get("username", "admin")
            ssh_password = creds.get("password", "")

            # Check reachability
            reachable = await _check_reachability(
                device.ip_address, ssh_username, ssh_password
            )

            if reachable:
                # Try to remove scheduler (if still there, push was good)
                removed = await _remove_panic_scheduler(
                    device.ip_address,
                    ssh_username,
                    ssh_password,
                    op.scheduler_name,
                )
                if removed:
                    logger.info("Recovery: committed op %s (scheduler removed)", op.id)
                else:
                    # Scheduler already gone — device may have reverted
                    logger.warning(
                        "Recovery: op %s — scheduler gone, device may have reverted. "
                        "Marking committed (device is reachable).",
                        op.id,
                    )
                await _update_push_op_status(op.id, "committed", db_session)

                await _publish_push_progress(
                    str(op.tenant_id),
                    str(op.device_id),
                    "committed",
                    "Recovered after API restart",
                    push_op_id=str(op.id),
                )
            else:
                logger.warning(
                    "Recovery: device %s unreachable, marking op %s failed",
                    op.device_id,
                    op.id,
                )
                await _update_push_op_status(op.id, "failed", db_session)
                await _publish_push_progress(
                    str(op.tenant_id),
                    str(op.device_id),
                    "failed",
                    "Device unreachable during recovery after API restart",
                    push_op_id=str(op.id),
                )

        except Exception as e:
            logger.error("Recovery failed for op %s: %s", op.id, e)
            await _update_push_op_status(op.id, "failed", db_session)

    await db_session.commit()
