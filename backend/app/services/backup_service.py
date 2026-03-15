"""SSH-based config capture service for RouterOS devices.

This service handles:
1. capture_export()       — SSH to device, run /export compact, return stdout text
2. capture_binary_backup() — SSH to device, trigger /system backup save, SFTP-download result
3. run_backup()            — Orchestrate a full backup: capture + git commit + DB record

All functions are async (asyncssh is asyncio-native).

Security policy:
    known_hosts=None is intentional — RouterOS devices use self-signed SSH host keys
    that change on reset or key regeneration. This mirrors InsecureSkipVerify=true
    used in the poller's TLS connection. The threat model accepts device impersonation
    risk in exchange for operational simplicity (no pre-enrollment of host keys needed).
    See Pitfall 2 in 04-RESEARCH.md.

pygit2 calls are synchronous C bindings and MUST be wrapped in run_in_executor.
See Pitfall 3 in 04-RESEARCH.md.

Phase 30: ALL backups (manual, scheduled, pre-restore) are encrypted via OpenBao
Transit (Tier 2) before git commit. The server retains decrypt capability for
on-demand viewing. Raw files in git are ciphertext; the API decrypts on GET.
"""

import asyncio
import base64
import io
import json
import logging
from datetime import datetime, timezone

import asyncssh
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AdminAsyncSessionLocal, set_tenant_context
from app.models.config_backup import ConfigBackupRun
from app.models.device import Device
from app.services import git_store
from app.services.crypto import decrypt_credentials_hybrid

logger = logging.getLogger(__name__)

# Fixed backup file name on device flash — overwrites on each run so files
# don't accumulate. See Pitfall 4 in 04-RESEARCH.md.
_BACKUP_NAME = "portal-backup"


async def capture_export(
    ip: str,
    port: int = 22,
    username: str = "",
    password: str = "",
) -> str:
    """SSH to a RouterOS device and capture /export compact output.

    Args:
        ip:       Device IP address.
        port:     SSH port (default 22; RouterOS default is 22).
        username: SSH login username.
        password: SSH login password.

    Returns:
        The raw RSC text from /export compact (may include RouterOS header line).

    Raises:
        asyncssh.Error: On SSH connection or command execution failure.
    """
    async with asyncssh.connect(
        ip,
        port=port,
        username=username,
        password=password,
        known_hosts=None,  # RouterOS self-signed host keys — see module docstring
        connect_timeout=30,
    ) as conn:
        result = await conn.run("/export compact", check=True)
        return result.stdout


async def capture_binary_backup(
    ip: str,
    port: int = 22,
    username: str = "",
    password: str = "",
) -> bytes:
    """SSH to a RouterOS device, create a binary backup, SFTP-download it, then clean up.

    Uses a fixed backup name ({_BACKUP_NAME}.backup) so the file overwrites
    on subsequent runs, preventing flash storage accumulation.

    The cleanup (removing the file from device flash) runs in a try/finally
    block so cleanup failures don't mask the actual backup error but are
    logged for observability. See Pitfall 4 in 04-RESEARCH.md.

    Args:
        ip:       Device IP address.
        port:     SSH port (default 22).
        username: SSH login username.
        password: SSH login password.

    Returns:
        Raw bytes of the binary backup file.

    Raises:
        asyncssh.Error: On SSH connection, command, or SFTP failure.
    """
    async with asyncssh.connect(
        ip,
        port=port,
        username=username,
        password=password,
        known_hosts=None,
        connect_timeout=30,
    ) as conn:
        # Step 1: Trigger backup creation on device flash.
        await conn.run(
            f"/system backup save name={_BACKUP_NAME} dont-encrypt=yes",
            check=True,
        )

        buf = io.BytesIO()
        try:
            # Step 2: SFTP-download the backup file.
            async with conn.start_sftp_client() as sftp:
                async with sftp.open(f"{_BACKUP_NAME}.backup", "rb") as f:
                    buf.write(await f.read())
        finally:
            # Step 3: Remove backup file from device flash (best-effort cleanup).
            try:
                await conn.run(f"/file remove {_BACKUP_NAME}.backup", check=True)
            except Exception as cleanup_err:
                logger.warning(
                    "Failed to remove backup file from device %s: %s",
                    ip,
                    cleanup_err,
                )

        return buf.getvalue()


async def run_backup(
    device_id: str,
    tenant_id: str,
    trigger_type: str,
    db_session: AsyncSession | None = None,
) -> dict:
    """Orchestrate a full config backup for a device.

    Steps:
    1. Load device from DB (ip_address, encrypted_credentials).
    2. Decrypt credentials using crypto.decrypt_credentials().
    3. Capture /export compact and binary backup concurrently via asyncio.gather().
    4. Compute line delta vs the most recent export.rsc in git (None for first backup).
    5. Commit both files to the tenant's bare git repo (run_in_executor for pygit2).
    6. Insert ConfigBackupRun record with commit SHA, trigger type, line deltas.
    7. Return summary dict.

    Args:
        device_id:    Device UUID as string.
        tenant_id:    Tenant UUID as string.
        trigger_type: 'scheduled' | 'manual' | 'pre-restore'
        db_session:   Optional AsyncSession with RLS context already set.
                      If None, uses AdminAsyncSessionLocal (for scheduler context).

    Returns:
        Dict: {"commit_sha": str, "trigger_type": str, "lines_added": int|None, "lines_removed": int|None}

    Raises:
        ValueError:    If device not found or missing credentials.
        asyncssh.Error: On SSH/SFTP failure.
    """
    loop = asyncio.get_event_loop()
    ts = datetime.now(timezone.utc).isoformat()

    # -----------------------------------------------------------------------
    # Step 1: Load device from DB
    # -----------------------------------------------------------------------
    if db_session is not None:
        session = db_session
        should_close = False
    else:
        # Scheduler context: use admin session (cross-tenant; RLS bypassed)
        session = AdminAsyncSessionLocal()
        should_close = True

    try:
        from sqlalchemy import select

        if should_close:
            # Admin session doesn't have RLS context — query directly.
            result = await session.execute(
                select(Device).where(
                    Device.id == device_id,  # type: ignore[arg-type]
                    Device.tenant_id == tenant_id,  # type: ignore[arg-type]
                )
            )
        else:
            result = await session.execute(
                select(Device).where(Device.id == device_id)  # type: ignore[arg-type]
            )

        device = result.scalar_one_or_none()
        if device is None:
            raise ValueError(f"Device {device_id!r} not found for tenant {tenant_id!r}")

        if not device.encrypted_credentials_transit and not device.encrypted_credentials:
            raise ValueError(
                f"Device {device_id!r} has no stored credentials — cannot perform backup"
            )

        # -----------------------------------------------------------------------
        # Step 2: Decrypt credentials (dual-read: Transit preferred, legacy fallback)
        # -----------------------------------------------------------------------
        key = settings.get_encryption_key_bytes()
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

        # -----------------------------------------------------------------------
        # Step 3: Capture export and binary backup concurrently
        # -----------------------------------------------------------------------
        logger.info(
            "Starting %s backup for device %s (%s) tenant %s",
            trigger_type,
            hostname,
            ip,
            tenant_id,
        )

        export_text, binary_backup = await asyncio.gather(
            capture_export(ip, username=ssh_username, password=ssh_password),
            capture_binary_backup(ip, username=ssh_username, password=ssh_password),
        )

        # -----------------------------------------------------------------------
        # Step 4: Compute line delta vs prior version
        # -----------------------------------------------------------------------
        lines_added: int | None = None
        lines_removed: int | None = None

        prior_commits = await loop.run_in_executor(
            None, git_store.list_device_commits, tenant_id, device_id
        )

        if prior_commits:
            try:
                prior_export_bytes = await loop.run_in_executor(
                    None,
                    git_store.read_file,
                    tenant_id,
                    prior_commits[0]["sha"],
                    device_id,
                    "export.rsc",
                )
                prior_text = prior_export_bytes.decode("utf-8", errors="replace")
                lines_added, lines_removed = await loop.run_in_executor(
                    None, git_store.compute_line_delta, prior_text, export_text
                )
            except Exception as delta_err:
                logger.warning(
                    "Failed to compute line delta for device %s: %s",
                    device_id,
                    delta_err,
                )
                # Keep lines_added/lines_removed as None on error — non-fatal
        else:
            # First backup: all lines are "added", none removed
            all_lines = len(export_text.splitlines())
            lines_added = all_lines
            lines_removed = 0

        # -----------------------------------------------------------------------
        # Step 5: Encrypt ALL backups via Transit (Tier 2: OpenBao Transit)
        # -----------------------------------------------------------------------
        encryption_tier: int | None = None
        git_export_content = export_text
        git_binary_content = binary_backup

        try:
            from app.services.crypto import encrypt_data_transit

            encrypted_export = await encrypt_data_transit(export_text, tenant_id)
            encrypted_binary = await encrypt_data_transit(
                base64.b64encode(binary_backup).decode(), tenant_id
            )
            # Transit ciphertext is text — store directly in git
            git_export_content = encrypted_export
            git_binary_content = encrypted_binary.encode("utf-8")
            encryption_tier = 2
            logger.info(
                "Tier 2 Transit encryption applied for %s backup of device %s",
                trigger_type,
                device_id,
            )
        except Exception as enc_err:
            # Transit unavailable — fall back to plaintext (non-fatal)
            logger.warning(
                "Transit encryption failed for %s backup of device %s, storing plaintext: %s",
                trigger_type,
                device_id,
                enc_err,
            )
            # Keep encryption_tier = None (plaintext fallback)

        # -----------------------------------------------------------------------
        # Step 6: Commit to git (wrapped in run_in_executor — pygit2 is sync C bindings)
        # -----------------------------------------------------------------------
        commit_message = f"{trigger_type}: {hostname} ({ip}) at {ts}"

        commit_sha = await loop.run_in_executor(
            None,
            git_store.commit_backup,
            tenant_id,
            device_id,
            git_export_content,
            git_binary_content,
            commit_message,
        )

        logger.info(
            "Committed backup for device %s to git SHA %s (tier=%s)",
            device_id,
            commit_sha[:8],
            encryption_tier,
        )

        # -----------------------------------------------------------------------
        # Step 7: Insert ConfigBackupRun record
        # -----------------------------------------------------------------------
        if not should_close:
            # RLS-scoped session from API context — record directly
            backup_run = ConfigBackupRun(
                device_id=device.id,
                tenant_id=device.tenant_id,
                commit_sha=commit_sha,
                trigger_type=trigger_type,
                lines_added=lines_added,
                lines_removed=lines_removed,
                encryption_tier=encryption_tier,
            )
            session.add(backup_run)
            await session.flush()
        else:
            # Admin session — set tenant context before insert so RLS policy is satisfied
            async with AdminAsyncSessionLocal() as admin_session:
                await set_tenant_context(admin_session, str(device.tenant_id))
                backup_run = ConfigBackupRun(
                    device_id=device.id,
                    tenant_id=device.tenant_id,
                    commit_sha=commit_sha,
                    trigger_type=trigger_type,
                    lines_added=lines_added,
                    lines_removed=lines_removed,
                    encryption_tier=encryption_tier,
                )
                admin_session.add(backup_run)
                await admin_session.commit()

        return {
            "commit_sha": commit_sha,
            "trigger_type": trigger_type,
            "lines_added": lines_added,
            "lines_removed": lines_removed,
        }

    finally:
        if should_close:
            await session.close()
