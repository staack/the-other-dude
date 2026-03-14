"""Config template service: Jinja2 rendering, variable extraction, and multi-device push.

Provides:
- extract_variables: Parse template content to find all undeclared Jinja2 variables
- render_template: Render a template with device context and custom variables
- validate_variable: Type-check a variable value against its declared type
- push_to_devices: Sequential multi-device push with pause-on-failure
- push_single_device: Two-phase panic-revert push for a single device

The push logic follows the same two-phase pattern as restore_service but uses
separate scheduler and file names to avoid conflicts with restore operations.
"""

import asyncio
import io
import ipaddress
import json
import logging
import uuid
from datetime import datetime, timezone

import asyncssh
from jinja2 import meta
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select, text

from app.config import settings
from app.database import AdminAsyncSessionLocal
from app.models.config_template import TemplatePushJob
from app.models.device import Device

logger = logging.getLogger(__name__)

# Sandboxed Jinja2 environment prevents template injection
_env = SandboxedEnvironment()

# Names used on the RouterOS device during template push
_PANIC_REVERT_SCHEDULER = "the-other-dude-template-revert"
_PRE_PUSH_BACKUP = "portal-template-pre-push"
_TEMPLATE_RSC = "portal-template.rsc"


# ---------------------------------------------------------------------------
# Variable extraction & rendering
# ---------------------------------------------------------------------------


def extract_variables(template_content: str) -> list[str]:
    """Extract all undeclared variables from a Jinja2 template.

    Returns a sorted list of variable names, excluding the built-in 'device'
    variable which is auto-populated at render time.
    """
    ast = _env.parse(template_content)
    all_vars = meta.find_undeclared_variables(ast)
    # 'device' is a built-in variable, not user-provided
    return sorted(v for v in all_vars if v != "device")


def render_template(
    template_content: str,
    device: dict,
    custom_variables: dict[str, str],
) -> str:
    """Render a Jinja2 template with device context and custom variables.

    The 'device' variable is auto-populated from the device dict.
    Custom variables are user-provided at push time.

    Uses SandboxedEnvironment to prevent template injection.

    Args:
        template_content: Jinja2 template string.
        device: Device info dict with keys: hostname, ip_address, model.
        custom_variables: User-supplied variable values.

    Returns:
        Rendered template string.

    Raises:
        jinja2.TemplateSyntaxError: If template has syntax errors.
        jinja2.UndefinedError: If required variables are missing.
    """
    context = {
        "device": {
            "hostname": device.get("hostname", ""),
            "ip": device.get("ip_address", ""),
            "model": device.get("model", ""),
        },
        **custom_variables,
    }
    tpl = _env.from_string(template_content)
    return tpl.render(context)


def validate_variable(name: str, value: str, var_type: str) -> str | None:
    """Validate a variable value against its declared type.

    Returns None on success, or an error message string on failure.
    """
    if var_type == "string":
        return None  # any string is valid
    elif var_type == "ip":
        try:
            ipaddress.ip_address(value)
            return None
        except ValueError:
            return f"'{name}' must be a valid IP address"
    elif var_type == "subnet":
        try:
            ipaddress.ip_network(value, strict=False)
            return None
        except ValueError:
            return f"'{name}' must be a valid subnet (e.g., 192.168.1.0/24)"
    elif var_type == "integer":
        try:
            int(value)
            return None
        except ValueError:
            return f"'{name}' must be an integer"
    elif var_type == "boolean":
        if value.lower() in ("true", "false", "yes", "no", "1", "0"):
            return None
        return f"'{name}' must be a boolean (true/false)"
    return None  # unknown type, allow


# ---------------------------------------------------------------------------
# Multi-device push orchestration
# ---------------------------------------------------------------------------


async def push_to_devices(rollout_id: str) -> dict:
    """Execute sequential template push for all jobs in a rollout.

    Processes devices one at a time. If any device fails or reverts,
    remaining jobs stay pending (paused). Follows the same pattern as
    firmware upgrade_service.start_mass_upgrade.

    This runs as a background task (asyncio.create_task) after the
    API creates the push jobs and returns the rollout_id.
    """
    try:
        return await _run_push_rollout(rollout_id)
    except Exception as exc:
        logger.error(
            "Uncaught exception in template push rollout %s: %s",
            rollout_id, exc, exc_info=True,
        )
        return {"completed": 0, "failed": 1, "pending": 0}


async def _run_push_rollout(rollout_id: str) -> dict:
    """Internal rollout implementation."""
    # Load all jobs for this rollout
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT j.id::text, j.status, d.hostname
                FROM template_push_jobs j
                JOIN devices d ON d.id = j.device_id
                WHERE j.rollout_id = CAST(:rollout_id AS uuid)
                ORDER BY j.created_at ASC
            """),
            {"rollout_id": rollout_id},
        )
        jobs = result.fetchall()

    if not jobs:
        logger.warning("No jobs found for template push rollout %s", rollout_id)
        return {"completed": 0, "failed": 0, "pending": 0}

    completed = 0
    failed = False

    for job_id, current_status, hostname in jobs:
        if current_status != "pending":
            if current_status == "committed":
                completed += 1
            continue

        logger.info(
            "Template push rollout %s: pushing to device %s (job %s)",
            rollout_id, hostname, job_id,
        )

        await push_single_device(job_id)

        # Check resulting status
        async with AdminAsyncSessionLocal() as session:
            result = await session.execute(
                text("SELECT status FROM template_push_jobs WHERE id = CAST(:id AS uuid)"),
                {"id": job_id},
            )
            row = result.fetchone()

        if row and row[0] == "committed":
            completed += 1
        elif row and row[0] in ("failed", "reverted"):
            failed = True
            logger.error(
                "Template push rollout %s paused: device %s %s",
                rollout_id, hostname, row[0],
            )
            break

    # Count remaining pending jobs
    remaining = sum(1 for _, s, _ in jobs if s == "pending") - completed - (1 if failed else 0)

    return {
        "completed": completed,
        "failed": 1 if failed else 0,
        "pending": max(0, remaining),
    }


async def push_single_device(job_id: str) -> None:
    """Push rendered template content to a single device.

    Implements the two-phase panic-revert pattern:
    1. Pre-backup (mandatory)
    2. Install panic-revert scheduler on device
    3. Write template content as RSC file via SFTP
    4. /import the RSC file
    5. Wait 60s for config to settle
    6. Reachability check -> committed or reverted

    All errors are caught and recorded in the job row.
    """
    try:
        await _run_single_push(job_id)
    except Exception as exc:
        logger.error(
            "Uncaught exception in template push job %s: %s",
            job_id, exc, exc_info=True,
        )
        await _update_job(job_id, status="failed", error_message=f"Unexpected error: {exc}")


async def _run_single_push(job_id: str) -> None:
    """Internal single-device push implementation."""

    # Step 1: Load job and device info
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT j.id, j.device_id, j.tenant_id, j.rendered_content,
                       d.ip_address, d.hostname, d.encrypted_credentials,
                       d.encrypted_credentials_transit
                FROM template_push_jobs j
                JOIN devices d ON d.id = j.device_id
                WHERE j.id = CAST(:job_id AS uuid)
            """),
            {"job_id": job_id},
        )
        row = result.fetchone()

    if not row:
        logger.error("Template push job %s not found", job_id)
        return

    (
        _, device_id, tenant_id, rendered_content,
        ip_address, hostname, encrypted_credentials,
        encrypted_credentials_transit,
    ) = row

    device_id = str(device_id)
    tenant_id = str(tenant_id)
    hostname = hostname or ip_address

    # Step 2: Update status to pushing
    await _update_job(job_id, status="pushing", started_at=datetime.now(timezone.utc))

    # Step 3: Decrypt credentials (dual-read: Transit preferred, legacy fallback)
    if not encrypted_credentials_transit and not encrypted_credentials:
        await _update_job(job_id, status="failed", error_message="Device has no stored credentials")
        return

    try:
        from app.services.crypto import decrypt_credentials_hybrid
        key = settings.get_encryption_key_bytes()
        creds_json = await decrypt_credentials_hybrid(
            encrypted_credentials_transit, encrypted_credentials, tenant_id, key,
        )
        creds = json.loads(creds_json)
        ssh_username = creds.get("username", "")
        ssh_password = creds.get("password", "")
    except Exception as cred_err:
        await _update_job(
            job_id, status="failed",
            error_message=f"Failed to decrypt credentials: {cred_err}",
        )
        return

    # Step 4: Mandatory pre-push backup
    logger.info("Running mandatory pre-push backup for device %s (%s)", hostname, ip_address)
    try:
        from app.services import backup_service
        backup_result = await backup_service.run_backup(
            device_id=device_id,
            tenant_id=tenant_id,
            trigger_type="pre-template-push",
        )
        backup_sha = backup_result["commit_sha"]
        await _update_job(job_id, pre_push_backup_sha=backup_sha)
        logger.info("Pre-push backup complete: %s", backup_sha[:8])
    except Exception as backup_err:
        logger.error("Pre-push backup failed for %s: %s", hostname, backup_err)
        await _update_job(
            job_id, status="failed",
            error_message=f"Pre-push backup failed: {backup_err}",
        )
        return

    # Step 5: SSH to device - install panic-revert, push config
    logger.info(
        "Pushing template to device %s (%s): installing panic-revert and uploading config",
        hostname, ip_address,
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
            # 5a: Create binary backup on device as revert point
            await conn.run(
                f"/system backup save name={_PRE_PUSH_BACKUP} dont-encrypt=yes",
                check=True,
            )
            logger.debug("Pre-push binary backup saved on device as %s.backup", _PRE_PUSH_BACKUP)

            # 5b: Install panic-revert RouterOS scheduler
            await conn.run(
                f"/system scheduler add "
                f'name="{_PANIC_REVERT_SCHEDULER}" '
                f"interval=90s "
                f'on-event=":delay 0; /system backup load name={_PRE_PUSH_BACKUP}" '
                f"start-time=startup",
                check=True,
            )
            logger.debug("Panic-revert scheduler installed on device")

            # 5c: Upload rendered template as RSC file via SFTP
            async with conn.start_sftp_client() as sftp:
                async with sftp.open(_TEMPLATE_RSC, "wb") as f:
                    await f.write(rendered_content.encode("utf-8"))
            logger.debug("Uploaded %s to device flash", _TEMPLATE_RSC)

            # 5d: /import the config file
            import_result = await conn.run(
                f"/import file={_TEMPLATE_RSC}",
                check=False,
            )
            logger.info(
                "Template import result for device %s: exit_status=%s stdout=%r",
                hostname, import_result.exit_status,
                (import_result.stdout or "")[:200],
            )

            # 5e: Clean up the uploaded RSC file (best-effort)
            try:
                await conn.run(f"/file remove {_TEMPLATE_RSC}", check=True)
            except Exception as cleanup_err:
                logger.warning(
                    "Failed to clean up %s from device %s: %s",
                    _TEMPLATE_RSC, ip_address, cleanup_err,
                )

    except Exception as push_err:
        logger.error(
            "SSH push phase failed for device %s (%s): %s",
            hostname, ip_address, push_err,
        )
        await _update_job(
            job_id, status="failed",
            error_message=f"Config push failed during SSH phase: {push_err}",
        )
        return

    # Step 6: Wait 60s for config to settle
    logger.info("Template pushed to device %s - waiting 60s for config to settle", hostname)
    await asyncio.sleep(60)

    # Step 7: Reachability check
    reachable = await _check_reachability(ip_address, ssh_username, ssh_password)

    if reachable:
        # Step 8a: Device is reachable - remove panic-revert scheduler + cleanup
        logger.info("Device %s (%s) is reachable after push - committing", hostname, ip_address)
        try:
            async with asyncssh.connect(
                ip_address, port=22,
                username=ssh_username, password=ssh_password,
                known_hosts=None, connect_timeout=30,
            ) as conn:
                await conn.run(
                    f'/system scheduler remove "{_PANIC_REVERT_SCHEDULER}"',
                    check=False,
                )
                await conn.run(
                    f"/file remove {_PRE_PUSH_BACKUP}.backup",
                    check=False,
                )
        except Exception as cleanup_err:
            logger.warning(
                "Failed to clean up panic-revert scheduler/backup on device %s: %s",
                hostname, cleanup_err,
            )

        await _update_job(
            job_id, status="committed",
            completed_at=datetime.now(timezone.utc),
        )
    else:
        # Step 8b: Device unreachable - RouterOS is auto-reverting
        logger.warning(
            "Device %s (%s) is unreachable after push - panic-revert scheduler "
            "will auto-revert to %s.backup",
            hostname, ip_address, _PRE_PUSH_BACKUP,
        )
        await _update_job(
            job_id, status="reverted",
            error_message="Device unreachable after push; auto-reverted via panic-revert scheduler",
            completed_at=datetime.now(timezone.utc),
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _check_reachability(ip: str, username: str, password: str) -> bool:
    """Check if a RouterOS device is reachable via SSH."""
    try:
        async with asyncssh.connect(
            ip, port=22,
            username=username, password=password,
            known_hosts=None, connect_timeout=30,
        ) as conn:
            result = await conn.run("/system identity print", check=True)
            logger.debug("Reachability check OK for %s: %r", ip, result.stdout[:50])
            return True
    except Exception as exc:
        logger.info("Device %s unreachable after push: %s", ip, exc)
        return False


async def _update_job(job_id: str, **kwargs) -> None:
    """Update TemplatePushJob fields via raw SQL (background task, no RLS)."""
    sets = []
    params: dict = {"job_id": job_id}

    for key, value in kwargs.items():
        param_name = f"v_{key}"
        if value is None and key in ("error_message", "started_at", "completed_at", "pre_push_backup_sha"):
            sets.append(f"{key} = NULL")
        else:
            sets.append(f"{key} = :{param_name}")
            params[param_name] = value

    if not sets:
        return

    async with AdminAsyncSessionLocal() as session:
        await session.execute(
            text(f"""
                UPDATE template_push_jobs
                SET {', '.join(sets)}
                WHERE id = CAST(:job_id AS uuid)
            """),
            params,
        )
        await session.commit()
