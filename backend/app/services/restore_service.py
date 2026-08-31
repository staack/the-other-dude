"""Two-phase config push with safe-mode rollback for RouterOS devices.

This module implements the safety mechanism for config restoration:

Phase 1 — Push:
  1. Pre-backup (mandatory) — snapshot current config before any changes
  2. Save a binary backup to device flash as a manual restore point
  3. Upload the target config and /import it inside a RouterOS safe-mode
     session (see app/services/safe_mode.py)

Phase 2 — Verification (settle window):
  4. Wait for the config to settle (scheduled processes restart, etc.)
  5. Reachability check on a NEW connection, independent of the safe-mode one
  6a. Reachable — release safe mode, keeping the changes; mark committed
  6b. Unreachable — drop the safe-mode session; RouterOS reverts by itself,
      without rebooting; mark operation reverted

Why safe mode and not a scheduler:
  Earlier versions installed a RouterOS scheduler
  (``start-time=startup interval=90s`` running ``/system backup load``) as the
  "panic revert". Measured on real hardware, that scheduler fires on a lattice
  anchored to device boot time, so the gap between installing it and its first
  fire is whatever is left of the current 90-second slot — anywhere from a
  moment to 90 seconds. The push flow waited 60 seconds before it even began
  verifying, so it usually lost the race, and ``/system backup load`` reverts
  *and reboots*. A completely successful push would reboot the customer's
  router. Nothing in that mechanism ever checked reachability, despite the
  comments and documentation claiming it did. Safe mode replaces it: it is
  conditioned on the actual loss of the session, and it never reboots.

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
from app.models.config_backup import ConfigPushOperation
from app.models.device import Device
from app.services import backup_service, git_store
from app.services.event_publisher import publish_event
from app.services.push_tracker import record_push, clear_push
from app.services.safe_mode import (
    SAFE_MODE_USERNAME_SUFFIX,
    SafeModeOverflowRisk,
    SafeModeSession,
)

logger = logging.getLogger(__name__)

# Name of the pre-push binary backup saved on device flash. This is a manual
# restore point only — nothing on the device is armed to load it automatically.
_PRE_PUSH_BACKUP = "portal-pre-push"
# Seconds to let the pushed config settle before verifying reachability.
_SETTLE_SECONDS = 60
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
        raise ValueError(f"Device {device_id!r} has no stored credentials — cannot perform restore")

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
    await _publish_push_progress(
        tenant_id, device_id, "started", f"Config restore started for {hostname}"
    )

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
    await _publish_push_progress(
        tenant_id, device_id, "backing_up", f"Creating pre-restore backup for {hostname}"
    )

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
        # Retained for schema compatibility; no scheduler is installed any more.
        scheduler_name=None,
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
    # Step 5: SSH to device — push config under safe mode
    # ------------------------------------------------------------------
    push_op_id_str = str(push_op_id)
    await _publish_push_progress(
        tenant_id, device_id, "pushing", f"Pushing config to {hostname}", push_op_id=push_op_id_str
    )

    logger.info(
        "Pushing config to device %s (%s): uploading config and applying under safe mode",
        hostname,
        ip,
    )

    try:
        # 5a: Create a binary backup on device flash as a manual restore point.
        #     Nothing is armed against it: it exists so an operator can restore
        #     by hand if they need to, not as an automatic trigger. The previous
        #     implementation installed a RouterOS scheduler pointed at this
        #     backup, which rebooted the device on a timer whether or not the
        #     push had succeeded. See app/services/safe_mode.py for the
        #     hardware measurements that condemned it.
        async with asyncssh.connect(
            ip,
            port=22,
            username=ssh_username,
            password=ssh_password,
            known_hosts=None,  # RouterOS self-signed host keys — see module docstring
            connect_timeout=30,
        ) as conn:
            await conn.run(
                f"/system backup save name={_PRE_PUSH_BACKUP} dont-encrypt=yes",
                check=True,
            )
            logger.debug("Pre-push binary backup saved on device as %s.backup", _PRE_PUSH_BACKUP)

            # 5b: Upload the .rsc. Writing a file is not a config action, so
            #     doing it outside safe mode keeps the undo buffer for the
            #     import itself.
            async with conn.start_sftp_client() as sftp:
                async with sftp.open(_RESTORE_RSC, "wb") as f:
                    await f.write(export_text.encode("utf-8"))
            logger.debug("Uploaded %s to device flash", _RESTORE_RSC)

        # 5c: Apply the config inside a RouterOS safe-mode session.
        #
        #     This is the rollback. Safe mode reverts every change made in the
        #     session if the session is lost, and keeps them only when we
        #     explicitly release it. The event that would break the device —
        #     the pushed config severing the management path — is the same
        #     event that drops this session, so the guarantee is conditioned on
        #     actual reachability rather than on a timer. It also does not
        #     reboot the device.
        safe_conn = await asyncssh.connect(
            ip,
            port=22,
            username=ssh_username + SAFE_MODE_USERNAME_SUFFIX,
            password=ssh_password,
            known_hosts=None,
            connect_timeout=30,
        )
    except Exception as push_err:
        logger.error(
            "SSH push phase failed for device %s (%s): %s",
            hostname,
            ip,
            push_err,
        )
        await _update_push_op_status(push_op_id, "failed", db_session)
        await _publish_push_progress(
            tenant_id,
            device_id,
            "failed",
            f"Config push failed for {hostname}: {push_err}",
            push_op_id=push_op_id_str,
            error=str(push_err),
        )
        return {
            "status": "failed",
            "message": f"Config push failed during SSH phase: {push_err}",
            "pre_backup_sha": pre_backup_sha,
        }

    committed = False
    revert_reason: str | None = None
    try:
        async with SafeModeSession(safe_conn) as session:
            try:
                import_output = await session.import_rsc(export_text, filename=_RESTORE_RSC)
            except SafeModeOverflowRisk as overflow_err:
                # Too many actions for safe mode to undo. Leaving the block
                # without committing drops the session, so nothing that was
                # applied survives.
                logger.error(
                    "Refusing unprotected push to device %s (%s): %s",
                    hostname,
                    ip,
                    overflow_err,
                )
                await _update_push_op_status(push_op_id, "failed", db_session)
                await _publish_push_progress(
                    tenant_id,
                    device_id,
                    "failed",
                    f"Config push refused for {hostname}: {overflow_err}",
                    push_op_id=push_op_id_str,
                    error=str(overflow_err),
                )
                return {
                    "status": "failed",
                    "message": str(overflow_err),
                    "pre_backup_sha": pre_backup_sha,
                }

            logger.info(
                "Config import result for device %s: %r",
                hostname,
                import_output[-200:],
            )

            # Record push in Redis so the poller can detect post-push offline events
            await record_push(
                device_id=device_id,
                tenant_id=tenant_id,
                push_type="restore",
                push_operation_id=push_op_id_str,
                pre_push_commit_sha=pre_backup_sha,
            )

            # --------------------------------------------------------------
            # Step 6: Settle, then verify over an INDEPENDENT connection
            # --------------------------------------------------------------
            # The check must not reuse the safe-mode connection: that
            # connection is already established, so it would keep reporting
            # success even if the device had become unreachable to anything
            # new. Dialling a fresh connection is what actually proves the
            # management path still works.
            await _publish_push_progress(
                tenant_id,
                device_id,
                "settling",
                f"Config pushed to {hostname} — waiting {_SETTLE_SECONDS}s for settle",
                push_op_id=push_op_id_str,
            )
            await asyncio.sleep(_SETTLE_SECONDS)

            await _publish_push_progress(
                tenant_id,
                device_id,
                "verifying",
                f"Verifying device {hostname} reachability",
                push_op_id=push_op_id_str,
            )
            reachable = await _check_reachability(ip, ssh_username, ssh_password)

            if reachable:
                try:
                    await session.commit()
                    committed = True
                except Exception as commit_err:
                    # The safe-mode session died before we could release it.
                    # RouterOS has already reverted; report that honestly
                    # rather than claiming a commit that did not happen.
                    revert_reason = f"safe-mode session lost before commit: {commit_err}"
            else:
                revert_reason = "device did not answer a new connection after the push"
    except Exception as session_err:
        revert_reason = f"safe-mode session failed: {session_err}"

    if not committed:
        # ------------------------------------------------------------------
        # Reverted: the safe-mode session ended without a commit, so RouterOS
        # restored the pre-push config by itself. No reboot was involved.
        # ------------------------------------------------------------------
        logger.warning(
            "Config push to device %s (%s) was rolled back by RouterOS safe mode: %s",
            hostname,
            ip,
            revert_reason,
        )
        await _update_push_op_status(push_op_id, "reverted", db_session)
        await clear_push(device_id)
        await _publish_push_progress(
            tenant_id,
            device_id,
            "reverted",
            f"Config push to {hostname} rolled back automatically ({revert_reason})",
            push_op_id=push_op_id_str,
        )
        return {
            "status": "reverted",
            "message": (
                "Config push was rolled back automatically by RouterOS safe mode "
                f"({revert_reason}). The device was not rebooted."
            ),
            "pre_backup_sha": pre_backup_sha,
        }

    # ----------------------------------------------------------------------
    # Committed: tidy up the files we left on device flash. Best-effort — a
    # leftover file is inert, unlike the scheduler this replaced.
    # ----------------------------------------------------------------------
    logger.info("Device %s (%s) reachable after push — committed", hostname, ip)
    try:
        async with asyncssh.connect(
            ip,
            port=22,
            username=ssh_username,
            password=ssh_password,
            known_hosts=None,
            connect_timeout=30,
        ) as conn:
            await conn.run(f"/file remove {_RESTORE_RSC}", check=False)
            await conn.run(f"/file remove {_PRE_PUSH_BACKUP}.backup", check=False)
    except Exception as cleanup_err:
        logger.warning(
            "Failed to clean up push artefacts on device %s: %s",
            hostname,
            cleanup_err,
        )

    await _update_push_op_status(push_op_id, "committed", db_session)
    await clear_push(device_id)
    await _publish_push_progress(
        tenant_id,
        device_id,
        "committed",
        f"Config restored successfully on {hostname}",
        push_op_id=push_op_id_str,
    )

    return {
        "status": "committed",
        "message": "Config restored successfully",
        "pre_backup_sha": pre_backup_sha,
    }


async def _check_reachability(ip: str, username: str, password: str) -> bool:
    """Check if a RouterOS device is reachable via SSH.

    Attempts to connect and run a simple command (/system identity print).
    Returns True if successful, False if the connection fails or times out.

    Uses asyncssh (not the poller's binary API) to avoid a circular import.
    A 30-second timeout is used — if the device doesn't respond within that
    window, it's considered unreachable and the safe-mode session is dropped,
    which makes RouterOS revert the push.

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
    from sqlalchemy import update

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
    """Remove a legacy panic-revert scheduler left behind by an older version.

    No push installs a scheduler any more — safe mode replaced it. This exists
    purely so that a device pushed to by a pre-safe-mode build, whose push
    operation is still pending when this build starts up, gets disarmed rather
    than left holding a timer that reboots it.

    Returns:
        True if a scheduler was found and removed, False otherwise.
    """
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
            dev_result = await db_session.execute(select(Device).where(Device.id == op.device_id))
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
            reachable = await _check_reachability(device.ip_address, ssh_username, ssh_password)

            if reachable:
                if op.scheduler_name:
                    # Legacy op from a pre-safe-mode build: the device is still
                    # holding a scheduler that will reboot it. Disarm it first —
                    # this is the urgent part of recovery.
                    removed = await _remove_panic_scheduler(
                        device.ip_address,
                        ssh_username,
                        ssh_password,
                        op.scheduler_name,
                    )
                    logger.info(
                        "Recovery: op %s — legacy panic-revert scheduler %s",
                        op.id,
                        "removed" if removed else "already gone",
                    )
                    await _update_push_op_status(op.id, "committed", db_session)
                    status, note = "committed", "Recovered after API restart"
                else:
                    # Safe-mode era. A push only reaches 'committed' by
                    # explicitly releasing safe mode. This operation never got
                    # that far, so whatever interrupted it also dropped the
                    # safe-mode session, and RouterOS reverted the change. The
                    # device being reachable now is consistent with that — it is
                    # reachable on its ORIGINAL config.
                    logger.warning(
                        "Recovery: op %s was interrupted before commit — "
                        "safe mode will have reverted the push",
                        op.id,
                    )
                    await _update_push_op_status(op.id, "reverted", db_session)
                    status, note = (
                        "reverted",
                        "Push interrupted before commit — safe mode reverted it",
                    )

                await _publish_push_progress(
                    str(op.tenant_id),
                    str(op.device_id),
                    status,
                    note,
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
