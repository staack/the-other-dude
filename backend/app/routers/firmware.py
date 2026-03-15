"""Firmware API endpoints for version overview, cache management, preferred channel,
and firmware upgrade orchestration.

Tenant-scoped routes under /api/tenants/{tenant_id}/firmware/*.
Global routes under /api/firmware/* for version listing and admin actions.
"""

import asyncio
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.rate_limit import limiter
from app.middleware.rbac import require_scope
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.services.audit_service import log_action

router = APIRouter(tags=["firmware"])


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    if current_user.is_super_admin:
        await set_tenant_context(db, str(tenant_id))
    elif current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant",
        )


class PreferredChannelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preferred_channel: str  # "stable", "long-term", "testing"


class FirmwareDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    architecture: str
    channel: str
    version: str


# =========================================================================
# TENANT-SCOPED ENDPOINTS
# =========================================================================


@router.get(
    "/tenants/{tenant_id}/firmware/overview",
    summary="Get firmware status for all devices in tenant",
    dependencies=[require_scope("firmware:write")],
)
async def get_firmware_overview(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    from app.services.firmware_service import get_firmware_overview as _get_overview

    return await _get_overview(str(tenant_id))


@router.patch(
    "/tenants/{tenant_id}/devices/{device_id}/preferred-channel",
    summary="Set preferred firmware channel for a device",
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("20/minute")
async def set_device_preferred_channel(
    request: Request,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    body: PreferredChannelRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _check_tenant_access(current_user, tenant_id, db)

    if body.preferred_channel not in ("stable", "long-term", "testing"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="preferred_channel must be one of: stable, long-term, testing",
        )

    result = await db.execute(
        text("""
            UPDATE devices SET preferred_channel = :channel, updated_at = NOW()
            WHERE id = :device_id
            RETURNING id
        """),
        {"channel": body.preferred_channel, "device_id": str(device_id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Device not found")
    await db.commit()
    return {"status": "ok", "preferred_channel": body.preferred_channel}


@router.patch(
    "/tenants/{tenant_id}/device-groups/{group_id}/preferred-channel",
    summary="Set preferred firmware channel for a device group",
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("20/minute")
async def set_group_preferred_channel(
    request: Request,
    tenant_id: uuid.UUID,
    group_id: uuid.UUID,
    body: PreferredChannelRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _check_tenant_access(current_user, tenant_id, db)

    if body.preferred_channel not in ("stable", "long-term", "testing"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="preferred_channel must be one of: stable, long-term, testing",
        )

    result = await db.execute(
        text("""
            UPDATE device_groups SET preferred_channel = :channel
            WHERE id = :group_id
            RETURNING id
        """),
        {"channel": body.preferred_channel, "group_id": str(group_id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Device group not found")
    await db.commit()
    return {"status": "ok", "preferred_channel": body.preferred_channel}


# =========================================================================
# GLOBAL ENDPOINTS (firmware versions are not tenant-scoped)
# =========================================================================


@router.get(
    "/firmware/versions",
    summary="List all known firmware versions from cache",
)
async def list_firmware_versions(
    architecture: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    filters = []
    params: dict[str, Any] = {}

    if architecture:
        filters.append("architecture = :arch")
        params["arch"] = architecture
    if channel:
        filters.append("channel = :channel")
        params["channel"] = channel

    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    result = await db.execute(
        text(f"""
            SELECT id, architecture, channel, version, npk_url,
                   npk_local_path, npk_size_bytes, checked_at
            FROM firmware_versions
            {where}
            ORDER BY architecture, channel, checked_at DESC
        """),
        params,
    )

    return [
        {
            "id": str(row[0]),
            "architecture": row[1],
            "channel": row[2],
            "version": row[3],
            "npk_url": row[4],
            "npk_local_path": row[5],
            "npk_size_bytes": row[6],
            "checked_at": row[7].isoformat() if row[7] else None,
        }
        for row in result.fetchall()
    ]


@router.post(
    "/firmware/check",
    summary="Trigger immediate firmware version check (super admin only)",
)
async def trigger_firmware_check(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    if not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin only")

    from app.services.firmware_service import check_latest_versions

    results = await check_latest_versions()
    return {"status": "ok", "versions_discovered": len(results), "versions": results}


@router.get(
    "/firmware/cache",
    summary="List locally cached NPK files (super admin only)",
)
async def list_firmware_cache(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict[str, Any]]:
    if not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin only")

    from app.services.firmware_service import get_cached_firmware

    return await get_cached_firmware()


@router.post(
    "/firmware/download",
    summary="Download a specific NPK to local cache (super admin only)",
)
async def download_firmware(
    body: FirmwareDownloadRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    if not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin only")

    from app.services.firmware_service import download_firmware as _download

    path = await _download(body.architecture, body.channel, body.version)
    return {"status": "ok", "path": path}


# =========================================================================
# UPGRADE ENDPOINTS
# =========================================================================


class UpgradeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str
    target_version: str
    architecture: str
    channel: str = "stable"
    confirmed_major_upgrade: bool = False
    scheduled_at: Optional[str] = None  # ISO datetime or None for immediate


class MassUpgradeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_ids: list[str]
    target_version: str
    channel: str = "stable"
    confirmed_major_upgrade: bool = False
    scheduled_at: Optional[str] = None


@router.post(
    "/tenants/{tenant_id}/firmware/upgrade",
    summary="Start or schedule a single device firmware upgrade",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("20/minute")
async def start_firmware_upgrade(
    request: Request,
    tenant_id: uuid.UUID,
    body: UpgradeRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    if current_user.role == "viewer":
        raise HTTPException(403, "Viewers cannot initiate upgrades")

    # Look up device architecture if not provided
    architecture = body.architecture
    if not architecture:
        dev_result = await db.execute(
            text("SELECT architecture FROM devices WHERE id = CAST(:id AS uuid)"),
            {"id": body.device_id},
        )
        dev_row = dev_result.fetchone()
        if not dev_row or not dev_row[0]:
            raise HTTPException(422, "Device architecture unknown — cannot upgrade")
        architecture = dev_row[0]

    # Create upgrade job
    job_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO firmware_upgrade_jobs
                (id, tenant_id, device_id, target_version, architecture, channel,
                 status, confirmed_major_upgrade, scheduled_at)
            VALUES
                (CAST(:id AS uuid), CAST(:tenant_id AS uuid), CAST(:device_id AS uuid),
                 :target_version, :architecture, :channel,
                 :status, :confirmed, :scheduled_at)
        """),
        {
            "id": job_id,
            "tenant_id": str(tenant_id),
            "device_id": body.device_id,
            "target_version": body.target_version,
            "architecture": architecture,
            "channel": body.channel,
            "status": "scheduled" if body.scheduled_at else "pending",
            "confirmed": body.confirmed_major_upgrade,
            "scheduled_at": body.scheduled_at,
        },
    )
    await db.commit()

    # Schedule or start immediately
    if body.scheduled_at:
        from app.services.upgrade_service import schedule_upgrade

        schedule_upgrade(job_id, datetime.fromisoformat(body.scheduled_at))
    else:
        from app.services.upgrade_service import start_upgrade

        asyncio.create_task(start_upgrade(job_id))

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "firmware_upgrade",
            resource_type="firmware",
            resource_id=job_id,
            device_id=uuid.UUID(body.device_id),
            details={"target_version": body.target_version, "channel": body.channel},
        )
    except Exception:
        pass

    return {"status": "accepted", "job_id": job_id}


@router.post(
    "/tenants/{tenant_id}/firmware/mass-upgrade",
    summary="Start or schedule a mass firmware upgrade for multiple devices",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("5/minute")
async def start_mass_firmware_upgrade(
    request: Request,
    tenant_id: uuid.UUID,
    body: MassUpgradeRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    if current_user.role == "viewer":
        raise HTTPException(403, "Viewers cannot initiate upgrades")

    rollout_group_id = str(uuid.uuid4())
    jobs = []

    for device_id in body.device_ids:
        # Look up architecture per device
        dev_result = await db.execute(
            text("SELECT architecture FROM devices WHERE id = CAST(:id AS uuid)"),
            {"id": device_id},
        )
        dev_row = dev_result.fetchone()
        architecture = dev_row[0] if dev_row and dev_row[0] else "unknown"

        job_id = str(uuid.uuid4())
        await db.execute(
            text("""
                INSERT INTO firmware_upgrade_jobs
                    (id, tenant_id, device_id, rollout_group_id,
                     target_version, architecture, channel,
                     status, confirmed_major_upgrade, scheduled_at)
                VALUES
                    (CAST(:id AS uuid), CAST(:tenant_id AS uuid),
                     CAST(:device_id AS uuid), CAST(:group_id AS uuid),
                     :target_version, :architecture, :channel,
                     :status, :confirmed, :scheduled_at)
            """),
            {
                "id": job_id,
                "tenant_id": str(tenant_id),
                "device_id": device_id,
                "group_id": rollout_group_id,
                "target_version": body.target_version,
                "architecture": architecture,
                "channel": body.channel,
                "status": "scheduled" if body.scheduled_at else "pending",
                "confirmed": body.confirmed_major_upgrade,
                "scheduled_at": body.scheduled_at,
            },
        )
        jobs.append({"job_id": job_id, "device_id": device_id, "architecture": architecture})

    await db.commit()

    # Schedule or start immediately
    if body.scheduled_at:
        from app.services.upgrade_service import schedule_mass_upgrade

        schedule_mass_upgrade(rollout_group_id, datetime.fromisoformat(body.scheduled_at))
    else:
        from app.services.upgrade_service import start_mass_upgrade

        asyncio.create_task(start_mass_upgrade(rollout_group_id))

    return {
        "status": "accepted",
        "rollout_group_id": rollout_group_id,
        "jobs": jobs,
    }


@router.get(
    "/tenants/{tenant_id}/firmware/upgrades",
    summary="List firmware upgrade jobs for tenant",
    dependencies=[require_scope("firmware:write")],
)
async def list_upgrade_jobs(
    tenant_id: uuid.UUID,
    upgrade_status: Optional[str] = Query(None, alias="status"),
    device_id: Optional[str] = Query(None),
    rollout_group_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    filters = ["1=1"]
    params: dict[str, Any] = {}

    if upgrade_status:
        filters.append("j.status = :status")
        params["status"] = upgrade_status
    if device_id:
        filters.append("j.device_id = CAST(:device_id AS uuid)")
        params["device_id"] = device_id
    if rollout_group_id:
        filters.append("j.rollout_group_id = CAST(:group_id AS uuid)")
        params["group_id"] = rollout_group_id

    where = " AND ".join(filters)
    offset = (page - 1) * per_page

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM firmware_upgrade_jobs j WHERE {where}"),
        params,
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        text(f"""
            SELECT j.id, j.device_id, j.rollout_group_id,
                   j.target_version, j.architecture, j.channel,
                   j.status, j.pre_upgrade_backup_sha, j.scheduled_at,
                   j.started_at, j.completed_at, j.error_message,
                   j.confirmed_major_upgrade, j.created_at,
                   d.hostname AS device_hostname
            FROM firmware_upgrade_jobs j
            LEFT JOIN devices d ON d.id = j.device_id
            WHERE {where}
            ORDER BY j.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": per_page, "offset": offset},
    )

    items = [
        {
            "id": str(row[0]),
            "device_id": str(row[1]),
            "rollout_group_id": str(row[2]) if row[2] else None,
            "target_version": row[3],
            "architecture": row[4],
            "channel": row[5],
            "status": row[6],
            "pre_upgrade_backup_sha": row[7],
            "scheduled_at": row[8].isoformat() if row[8] else None,
            "started_at": row[9].isoformat() if row[9] else None,
            "completed_at": row[10].isoformat() if row[10] else None,
            "error_message": row[11],
            "confirmed_major_upgrade": row[12],
            "created_at": row[13].isoformat() if row[13] else None,
            "device_hostname": row[14],
        }
        for row in result.fetchall()
    ]

    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.get(
    "/tenants/{tenant_id}/firmware/upgrades/{job_id}",
    summary="Get single upgrade job detail",
    dependencies=[require_scope("firmware:write")],
)
async def get_upgrade_job(
    tenant_id: uuid.UUID,
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT j.id, j.device_id, j.rollout_group_id,
                   j.target_version, j.architecture, j.channel,
                   j.status, j.pre_upgrade_backup_sha, j.scheduled_at,
                   j.started_at, j.completed_at, j.error_message,
                   j.confirmed_major_upgrade, j.created_at,
                   d.hostname AS device_hostname
            FROM firmware_upgrade_jobs j
            LEFT JOIN devices d ON d.id = j.device_id
            WHERE j.id = CAST(:job_id AS uuid)
        """),
        {"job_id": str(job_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Upgrade job not found")

    return {
        "id": str(row[0]),
        "device_id": str(row[1]),
        "rollout_group_id": str(row[2]) if row[2] else None,
        "target_version": row[3],
        "architecture": row[4],
        "channel": row[5],
        "status": row[6],
        "pre_upgrade_backup_sha": row[7],
        "scheduled_at": row[8].isoformat() if row[8] else None,
        "started_at": row[9].isoformat() if row[9] else None,
        "completed_at": row[10].isoformat() if row[10] else None,
        "error_message": row[11],
        "confirmed_major_upgrade": row[12],
        "created_at": row[13].isoformat() if row[13] else None,
        "device_hostname": row[14],
    }


@router.get(
    "/tenants/{tenant_id}/firmware/rollouts/{rollout_group_id}",
    summary="Get mass rollout status with all jobs",
    dependencies=[require_scope("firmware:write")],
)
async def get_rollout_status(
    tenant_id: uuid.UUID,
    rollout_group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT j.id, j.device_id, j.status, j.target_version,
                   j.architecture, j.error_message, j.started_at,
                   j.completed_at, d.hostname
            FROM firmware_upgrade_jobs j
            LEFT JOIN devices d ON d.id = j.device_id
            WHERE j.rollout_group_id = CAST(:group_id AS uuid)
            ORDER BY j.created_at ASC
        """),
        {"group_id": str(rollout_group_id)},
    )
    rows = result.fetchall()

    if not rows:
        raise HTTPException(404, "Rollout group not found")

    # Compute summary
    total = len(rows)
    completed = sum(1 for r in rows if r[2] == "completed")
    failed = sum(1 for r in rows if r[2] == "failed")
    paused = sum(1 for r in rows if r[2] == "paused")
    pending = sum(1 for r in rows if r[2] in ("pending", "scheduled"))

    # Find currently running device
    active_statuses = {"downloading", "uploading", "rebooting", "verifying"}
    current_device = None
    for r in rows:
        if r[2] in active_statuses:
            current_device = r[8] or str(r[1])
            break

    jobs = [
        {
            "id": str(r[0]),
            "device_id": str(r[1]),
            "status": r[2],
            "target_version": r[3],
            "architecture": r[4],
            "error_message": r[5],
            "started_at": r[6].isoformat() if r[6] else None,
            "completed_at": r[7].isoformat() if r[7] else None,
            "device_hostname": r[8],
        }
        for r in rows
    ]

    return {
        "rollout_group_id": str(rollout_group_id),
        "total": total,
        "completed": completed,
        "failed": failed,
        "paused": paused,
        "pending": pending,
        "current_device": current_device,
        "jobs": jobs,
    }


@router.post(
    "/tenants/{tenant_id}/firmware/upgrades/{job_id}/cancel",
    summary="Cancel a scheduled or pending upgrade",
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("20/minute")
async def cancel_upgrade_endpoint(
    request: Request,
    tenant_id: uuid.UUID,
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _check_tenant_access(current_user, tenant_id, db)

    if current_user.role == "viewer":
        raise HTTPException(403, "Viewers cannot cancel upgrades")

    from app.services.upgrade_service import cancel_upgrade

    await cancel_upgrade(str(job_id))
    return {"status": "ok", "message": "Upgrade cancelled"}


@router.post(
    "/tenants/{tenant_id}/firmware/upgrades/{job_id}/retry",
    summary="Retry a failed upgrade",
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("20/minute")
async def retry_upgrade_endpoint(
    request: Request,
    tenant_id: uuid.UUID,
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _check_tenant_access(current_user, tenant_id, db)

    if current_user.role == "viewer":
        raise HTTPException(403, "Viewers cannot retry upgrades")

    from app.services.upgrade_service import retry_failed_upgrade

    await retry_failed_upgrade(str(job_id))
    return {"status": "ok", "message": "Upgrade retry started"}


@router.post(
    "/tenants/{tenant_id}/firmware/rollouts/{rollout_group_id}/resume",
    summary="Resume a paused mass rollout",
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("20/minute")
async def resume_rollout_endpoint(
    request: Request,
    tenant_id: uuid.UUID,
    rollout_group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _check_tenant_access(current_user, tenant_id, db)

    if current_user.role == "viewer":
        raise HTTPException(403, "Viewers cannot resume rollouts")

    from app.services.upgrade_service import resume_mass_upgrade

    await resume_mass_upgrade(str(rollout_group_id))
    return {"status": "ok", "message": "Rollout resumed"}


@router.post(
    "/tenants/{tenant_id}/firmware/rollouts/{rollout_group_id}/abort",
    summary="Abort remaining devices in a paused rollout",
    dependencies=[require_scope("firmware:write")],
)
@limiter.limit("5/minute")
async def abort_rollout_endpoint(
    request: Request,
    tenant_id: uuid.UUID,
    rollout_group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    if current_user.role == "viewer":
        raise HTTPException(403, "Viewers cannot abort rollouts")

    from app.services.upgrade_service import abort_mass_upgrade

    aborted = await abort_mass_upgrade(str(rollout_group_id))
    return {"status": "ok", "aborted_count": aborted}
