"""
Config backup API endpoints.

All routes are tenant-scoped under:
    /api/tenants/{tenant_id}/devices/{device_id}/config/

Provides:
    - GET  /backups              — list backup timeline
    - POST /backups              — trigger manual backup
    - POST /checkpoint           — create a checkpoint (restore point)
    - GET  /backups/{sha}/export — retrieve export.rsc text
    - GET  /backups/{sha}/binary — download backup.bin
    - POST /preview-restore      — preview impact analysis before restore
    - POST /restore              — restore a config version (two-phase panic-revert)
    - POST /emergency-rollback   — rollback to most recent pre-push backup
    - GET  /schedules            — view effective backup schedule
    - PUT  /schedules            — create/update device-specific schedule override
    - POST /config-snapshot/trigger — trigger Go poller config snapshot via NATS

RLS is enforced via get_db() (app_user engine with tenant context).
RBAC: viewer = read-only (GET); operator and above = write (POST/PUT).
"""

import asyncio
import json
import logging
import uuid
from datetime import timezone, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rate_limit import limiter
from app.middleware.rbac import require_min_role, require_scope
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.config_backup import ConfigBackupRun, ConfigBackupSchedule
from app.config import settings
from app.models.device import Device
from app.services import backup_service, git_store
from app.services import restore_service
from app.services.crypto import decrypt_credentials_hybrid
from app.services.rsc_parser import parse_rsc, validate_rsc, compute_impact

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config-backups"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """
    Verify the current user is allowed to access the given tenant.

    - super_admin can access any tenant — re-sets DB tenant context to target tenant.
    - All other roles must match their own tenant_id.
    """
    if current_user.is_super_admin:
        from app.database import set_tenant_context
        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


# ---------------------------------------------------------------------------
# Request/Response schemas
# ---------------------------------------------------------------------------


class RestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    commit_sha: str


class ScheduleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cron_expression: str
    enabled: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/config/backups",
    summary="List backup timeline for a device",
    dependencies=[require_scope("config:read")],
)
async def list_backups(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return backup timeline for a device, newest first.

    Each entry includes: id, commit_sha, trigger_type, lines_added,
    lines_removed, and created_at.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        select(ConfigBackupRun)
        .where(
            ConfigBackupRun.device_id == device_id,  # type: ignore[arg-type]
            ConfigBackupRun.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
        .order_by(ConfigBackupRun.created_at.desc())
    )
    runs = result.scalars().all()

    return [
        {
            "id": str(run.id),
            "commit_sha": run.commit_sha,
            "trigger_type": run.trigger_type,
            "lines_added": run.lines_added,
            "lines_removed": run.lines_removed,
            "encryption_tier": run.encryption_tier,
            "created_at": run.created_at.isoformat(),
        }
        for run in runs
    ]


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config/backups",
    summary="Trigger a manual config backup",
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_scope("config:write")],
)
@limiter.limit("20/minute")
async def trigger_backup(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Trigger an immediate manual backup for a device.

    Captures export.rsc and backup.bin via SSH, commits to the tenant's
    git store, and records a ConfigBackupRun with trigger_type='manual'.
    Returns the backup metadata dict.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    try:
        result = await backup_service.run_backup(
            device_id=str(device_id),
            tenant_id=str(tenant_id),
            trigger_type="manual",
            db_session=db,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error(
            "Manual backup failed for device %s tenant %s: %s",
            device_id,
            tenant_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Backup failed: {exc}",
        ) from exc

    return result


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config/checkpoint",
    summary="Create a checkpoint (restore point) of the current config",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("5/minute")
async def create_checkpoint(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Create a checkpoint (restore point) of the current device config.

    Identical to a manual backup but tagged with trigger_type='checkpoint'.
    Checkpoints serve as named restore points that operators create before
    making risky changes, so they can easily roll back.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    try:
        result = await backup_service.run_backup(
            device_id=str(device_id),
            tenant_id=str(tenant_id),
            trigger_type="checkpoint",
            db_session=db,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error(
            "Checkpoint backup failed for device %s tenant %s: %s",
            device_id,
            tenant_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Checkpoint failed: {exc}",
        ) from exc

    return result


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/config/backups/{commit_sha}/export",
    summary="Get export.rsc text for a specific backup",
    response_class=Response,
    dependencies=[require_scope("config:read")],
)
async def get_export(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    commit_sha: str,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return the raw /export compact text for a specific backup version.

    For encrypted backups (encryption_tier != NULL), the Transit ciphertext
    stored in git is decrypted on-demand before returning plaintext.
    Legacy plaintext backups (encryption_tier = NULL) are returned as-is.

    Content-Type: text/plain
    """
    await _check_tenant_access(current_user, tenant_id, db)

    loop = asyncio.get_event_loop()
    try:
        content_bytes = await loop.run_in_executor(
            None,
            git_store.read_file,
            str(tenant_id),
            commit_sha,
            str(device_id),
            "export.rsc",
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Backup version not found: {exc}",
        ) from exc

    # Check if this backup is encrypted — decrypt via Transit if so
    result = await db.execute(
        select(ConfigBackupRun).where(
            ConfigBackupRun.commit_sha == commit_sha,
            ConfigBackupRun.device_id == device_id,
        )
    )
    backup_run = result.scalar_one_or_none()
    if backup_run and backup_run.encryption_tier:
        try:
            from app.services.crypto import decrypt_data_transit

            plaintext = await decrypt_data_transit(
                content_bytes.decode("utf-8"), str(tenant_id)
            )
            content_bytes = plaintext.encode("utf-8")
        except Exception as dec_err:
            logger.error(
                "Failed to decrypt export for device %s sha %s: %s",
                device_id, commit_sha, dec_err,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to decrypt backup content",
            ) from dec_err

    return Response(content=content_bytes, media_type="text/plain")


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/config/backups/{commit_sha}/binary",
    summary="Download backup.bin for a specific backup",
    response_class=Response,
    dependencies=[require_scope("config:read")],
)
async def get_binary(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    commit_sha: str,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Download the RouterOS binary backup file for a specific backup version.

    For encrypted backups, the Transit ciphertext is decrypted and the
    base64-encoded binary is decoded back to raw bytes before returning.
    Legacy plaintext backups are returned as-is.

    Content-Type: application/octet-stream (attachment download).
    """
    await _check_tenant_access(current_user, tenant_id, db)

    loop = asyncio.get_event_loop()
    try:
        content_bytes = await loop.run_in_executor(
            None,
            git_store.read_file,
            str(tenant_id),
            commit_sha,
            str(device_id),
            "backup.bin",
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Backup version not found: {exc}",
        ) from exc

    # Check if this backup is encrypted — decrypt via Transit if so
    result = await db.execute(
        select(ConfigBackupRun).where(
            ConfigBackupRun.commit_sha == commit_sha,
            ConfigBackupRun.device_id == device_id,
        )
    )
    backup_run = result.scalar_one_or_none()
    if backup_run and backup_run.encryption_tier:
        try:
            import base64 as b64

            from app.services.crypto import decrypt_data_transit

            # Transit ciphertext -> base64-encoded binary -> raw bytes
            b64_plaintext = await decrypt_data_transit(
                content_bytes.decode("utf-8"), str(tenant_id)
            )
            content_bytes = b64.b64decode(b64_plaintext)
        except Exception as dec_err:
            logger.error(
                "Failed to decrypt binary backup for device %s sha %s: %s",
                device_id, commit_sha, dec_err,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to decrypt backup content",
            ) from dec_err

    return Response(
        content=content_bytes,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="backup-{commit_sha[:8]}.bin"'
        },
    )


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config/preview-restore",
    summary="Preview the impact of restoring a config backup",
    dependencies=[require_scope("config:read")],
)
@limiter.limit("20/minute")
async def preview_restore(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: RestoreRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Preview the impact of restoring a config backup before executing.

    Reads the target config from the git backup, fetches the current config
    from the live device (falling back to the latest backup if unreachable),
    and returns a diff with categories, risk levels, warnings, and validation.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    loop = asyncio.get_event_loop()

    # 1. Read target export from git
    try:
        target_bytes = await loop.run_in_executor(
            None,
            git_store.read_file,
            str(tenant_id),
            body.commit_sha,
            str(device_id),
            "export.rsc",
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Backup export not found: {exc}",
        ) from exc

    target_text = target_bytes.decode("utf-8", errors="replace")

    # 2. Get current export from device (live) or fallback to latest backup
    current_text = ""
    try:
        result = await db.execute(
            select(Device).where(Device.id == device_id)  # type: ignore[arg-type]
        )
        device = result.scalar_one_or_none()
        if device and (device.encrypted_credentials_transit or device.encrypted_credentials):
            key = settings.get_encryption_key_bytes()
            creds_json = await decrypt_credentials_hybrid(
                device.encrypted_credentials_transit,
                device.encrypted_credentials,
                str(tenant_id),
                key,
            )
            import json
            creds = json.loads(creds_json)
            current_text = await backup_service.capture_export(
                device.ip_address,
                username=creds.get("username", "admin"),
                password=creds.get("password", ""),
            )
    except Exception:
        # Fallback to latest backup in git
        logger.debug(
            "Live export failed for device %s, falling back to latest backup",
            device_id,
        )
        latest = await db.execute(
            select(ConfigBackupRun)
            .where(
                ConfigBackupRun.device_id == device_id,  # type: ignore[arg-type]
            )
            .order_by(ConfigBackupRun.created_at.desc())
            .limit(1)
        )
        latest_run = latest.scalar_one_or_none()
        if latest_run:
            try:
                current_bytes = await loop.run_in_executor(
                    None,
                    git_store.read_file,
                    str(tenant_id),
                    latest_run.commit_sha,
                    str(device_id),
                    "export.rsc",
                )
                current_text = current_bytes.decode("utf-8", errors="replace")
            except Exception:
                current_text = ""

    # 3. Parse and analyze
    current_parsed = parse_rsc(current_text)
    target_parsed = parse_rsc(target_text)
    validation = validate_rsc(target_text)
    impact = compute_impact(current_parsed, target_parsed)

    return {
        "diff": impact["diff"],
        "categories": impact["categories"],
        "warnings": impact["warnings"],
        "validation": validation,
    }


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config/restore",
    summary="Restore a config version (two-phase push with panic-revert)",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("5/minute")
async def restore_config_endpoint(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: RestoreRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Restore a device config to a specific backup version.

    Implements two-phase push with panic-revert:
    1. Pre-backup is taken on device (mandatory before any push)
    2. RouterOS scheduler is installed as safety net (auto-reverts if unreachable)
    3. Config is pushed via /import
    4. Wait 60s for config to settle
    5. Reachability check — remove scheduler if device is reachable
    6. Return committed/reverted/failed status

    Returns: {"status": str, "message": str, "pre_backup_sha": str}
    """
    await _check_tenant_access(current_user, tenant_id, db)

    try:
        result = await restore_service.restore_config(
            device_id=str(device_id),
            tenant_id=str(tenant_id),
            commit_sha=body.commit_sha,
            db_session=db,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error(
            "Restore failed for device %s tenant %s commit %s: %s",
            device_id,
            tenant_id,
            body.commit_sha,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Restore failed: {exc}",
        ) from exc

    return result


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config/emergency-rollback",
    summary="Emergency rollback to most recent pre-push backup",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("5/minute")
async def emergency_rollback(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Emergency rollback: restore the most recent pre-push backup.

    Used when a device goes offline after a config push.
    Finds the latest 'pre-restore', 'checkpoint', or 'pre-template-push'
    backup and restores it via the two-phase panic-revert process.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        select(ConfigBackupRun)
        .where(
            ConfigBackupRun.device_id == device_id,  # type: ignore[arg-type]
            ConfigBackupRun.tenant_id == tenant_id,  # type: ignore[arg-type]
            ConfigBackupRun.trigger_type.in_(
                ["pre-restore", "checkpoint", "pre-template-push"]
            ),
        )
        .order_by(ConfigBackupRun.created_at.desc())
        .limit(1)
    )
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pre-push backup found for rollback",
        )

    try:
        restore_result = await restore_service.restore_config(
            device_id=str(device_id),
            tenant_id=str(tenant_id),
            commit_sha=backup.commit_sha,
            db_session=db,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error(
            "Emergency rollback failed for device %s tenant %s: %s",
            device_id,
            tenant_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Emergency rollback failed: {exc}",
        ) from exc

    return {
        **restore_result,
        "rolled_back_to": backup.commit_sha,
        "rolled_back_to_date": backup.created_at.isoformat(),
    }


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/config/schedules",
    summary="Get effective backup schedule for a device",
    dependencies=[require_scope("config:read")],
)
async def get_schedule(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the effective backup schedule for a device.

    Returns the device-specific override if it exists; falls back to the
    tenant-level default. If no schedule is configured, returns a synthetic
    default (2am UTC daily, enabled=True).
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Check for device-specific override first
    result = await db.execute(
        select(ConfigBackupSchedule).where(
            ConfigBackupSchedule.tenant_id == tenant_id,  # type: ignore[arg-type]
            ConfigBackupSchedule.device_id == device_id,  # type: ignore[arg-type]
        )
    )
    schedule = result.scalar_one_or_none()

    if schedule is None:
        # Fall back to tenant-level default
        result = await db.execute(
            select(ConfigBackupSchedule).where(
                ConfigBackupSchedule.tenant_id == tenant_id,  # type: ignore[arg-type]
                ConfigBackupSchedule.device_id.is_(None),  # type: ignore[union-attr]
            )
        )
        schedule = result.scalar_one_or_none()

    if schedule is None:
        # No schedule configured — return synthetic default
        return {
            "id": None,
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "cron_expression": "0 2 * * *",
            "enabled": True,
            "is_default": True,
        }

    is_device_specific = schedule.device_id is not None
    return {
        "id": str(schedule.id),
        "tenant_id": str(schedule.tenant_id),
        "device_id": str(schedule.device_id) if schedule.device_id else None,
        "cron_expression": schedule.cron_expression,
        "enabled": schedule.enabled,
        "is_default": not is_device_specific,
    }


@router.put(
    "/tenants/{tenant_id}/devices/{device_id}/config/schedules",
    summary="Create or update the device-specific backup schedule",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("20/minute")
async def update_schedule(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: ScheduleUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Create or update the device-specific backup schedule override.

    If no device-specific schedule exists, creates one. If one exists, updates
    its cron_expression and enabled fields.

    Returns the updated schedule.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Look for existing device-specific schedule
    result = await db.execute(
        select(ConfigBackupSchedule).where(
            ConfigBackupSchedule.tenant_id == tenant_id,  # type: ignore[arg-type]
            ConfigBackupSchedule.device_id == device_id,  # type: ignore[arg-type]
        )
    )
    schedule = result.scalar_one_or_none()

    if schedule is None:
        # Create new device-specific schedule
        schedule = ConfigBackupSchedule(
            tenant_id=tenant_id,
            device_id=device_id,
            cron_expression=body.cron_expression,
            enabled=body.enabled,
        )
        db.add(schedule)
    else:
        # Update existing schedule
        schedule.cron_expression = body.cron_expression
        schedule.enabled = body.enabled

    await db.flush()

    # Hot-reload the scheduler so changes take effect immediately
    from app.services.backup_scheduler import on_schedule_change
    await on_schedule_change(tenant_id, device_id)

    return {
        "id": str(schedule.id),
        "tenant_id": str(schedule.tenant_id),
        "device_id": str(schedule.device_id),
        "cron_expression": schedule.cron_expression,
        "enabled": schedule.enabled,
        "is_default": False,
    }


# ---------------------------------------------------------------------------
# Config Snapshot Trigger (Go poller via NATS request-reply)
# ---------------------------------------------------------------------------


async def _get_nats():
    """Get or create a NATS connection for config snapshot trigger requests.

    Reuses the same lazy-init pattern as routeros_proxy._get_nats().
    """
    from app.services.routeros_proxy import _get_nats as _proxy_get_nats
    return await _proxy_get_nats()


@router.post(
    "/tenants/{tenant_id}/devices/{device_id}/config-snapshot/trigger",
    summary="Trigger an immediate config snapshot via the Go poller",
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_scope("config:write")],
)
@limiter.limit("10/minute")
async def trigger_config_snapshot(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Trigger an immediate config snapshot for a device via the Go poller.

    Sends a NATS request to the poller's BackupResponder, which performs
    SSH config collection, normalization, hashing, and publishes the
    snapshot through the same ingestion pipeline as scheduled backups.

    Returns 201 on success with the snapshot's SHA256 hash.
    Returns 409 if a backup is already in progress for the device.
    Returns 502 if the poller reports a failure.
    Returns 504 if the request times out (backup may still complete).
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Verify device exists in this tenant.
    result = await db.execute(
        select(Device).where(
            Device.id == device_id,  # type: ignore[arg-type]
            Device.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found in tenant {tenant_id}",
        )

    # Send NATS request to Go poller.
    nc = await _get_nats()
    payload = {
        "device_id": str(device_id),
        "tenant_id": str(tenant_id),
    }

    import nats.errors

    try:
        reply = await nc.request(
            "config.backup.trigger",
            json.dumps(payload).encode(),
            timeout=90.0,
        )
    except nats.errors.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Backup request timed out -- the backup may still complete via the scheduled pipeline",
        )
    except Exception as exc:
        logger.error(
            "NATS request failed for config snapshot trigger device %s: %s",
            device_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to communicate with poller: {exc}",
        ) from exc

    reply_data = json.loads(reply.data)

    if reply_data.get("status") == "success":
        return {
            "status": "success",
            "sha256_hash": reply_data.get("sha256_hash"),
            "message": reply_data.get("message", "Config snapshot collected"),
        }

    if reply_data.get("status") == "locked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=reply_data.get("message", "backup already in progress"),
        )

    # status == "failed" or unknown
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=reply_data.get("error", "Backup failed"),
    )
