"""
Metrics API endpoints for querying TimescaleDB hypertables.

All device-scoped routes are tenant-scoped under
/api/tenants/{tenant_id}/devices/{device_id}/metrics/*.
Fleet summary endpoints are under /api/tenants/{tenant_id}/fleet/summary
and /api/fleet/summary (super_admin cross-tenant).

RLS is enforced via get_db() — the app_user engine applies tenant filtering
automatically based on the SET LOCAL app.current_tenant context.

All endpoints require authentication (get_current_user) and enforce
tenant access via _check_tenant_access.
"""

import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.tenant_context import CurrentUser, get_current_user

router = APIRouter(tags=["metrics"])


def _bucket_for_range(start: datetime, end: datetime) -> timedelta:
    """
    Select an appropriate time_bucket size based on the requested time range.

    Shorter ranges get finer granularity; longer ranges get coarser buckets
    to keep result sets manageable.

    Returns a timedelta because asyncpg requires a Python timedelta (not a
    string interval literal) when binding the first argument of time_bucket().
    """
    delta = end - start
    hours = delta.total_seconds() / 3600
    if hours <= 1:
        return timedelta(minutes=1)
    elif hours <= 6:
        return timedelta(minutes=5)
    elif hours <= 24:
        return timedelta(minutes=15)
    elif hours <= 168:  # 7 days
        return timedelta(hours=1)
    elif hours <= 720:  # 30 days
        return timedelta(hours=6)
    else:
        return timedelta(days=1)


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """
    Verify the current user is allowed to access the given tenant.

    - super_admin can access any tenant — re-sets DB tenant context to target tenant.
    - All other roles must match their own tenant_id.
    """
    if current_user.is_super_admin:
        # Re-set tenant context to the target tenant so RLS allows the operation
        from app.database import set_tenant_context
        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


# ---------------------------------------------------------------------------
# Health metrics
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/metrics/health",
    summary="Time-bucketed health metrics (CPU, memory, disk, temperature)",
)
async def device_health_metrics(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    start: datetime = Query(..., description="Start of time range (ISO format)"),
    end: datetime = Query(..., description="End of time range (ISO format)"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Return time-bucketed CPU, memory, disk, and temperature metrics for a device.

    Bucket size adapts automatically to the requested time range.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    bucket = _bucket_for_range(start, end)

    result = await db.execute(
        text("""
            SELECT
                time_bucket(:bucket, time) AS bucket,
                avg(cpu_load)::smallint AS avg_cpu,
                max(cpu_load)::smallint AS max_cpu,
                avg(CASE WHEN total_memory > 0
                    THEN round((1 - free_memory::float / total_memory) * 100)
                    ELSE NULL END)::smallint AS avg_mem_pct,
                avg(CASE WHEN total_disk > 0
                    THEN round((1 - free_disk::float / total_disk) * 100)
                    ELSE NULL END)::smallint AS avg_disk_pct,
                avg(temperature)::smallint AS avg_temp
            FROM health_metrics
            WHERE device_id = :device_id
              AND time >= :start AND time < :end
            GROUP BY bucket
            ORDER BY bucket ASC
        """),
        {"bucket": bucket, "device_id": str(device_id), "start": start, "end": end},
    )
    rows = result.mappings().all()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Interface traffic metrics
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/metrics/interfaces",
    summary="Time-bucketed interface bandwidth metrics (bps from cumulative byte deltas)",
)
async def device_interface_metrics(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    start: datetime = Query(..., description="Start of time range (ISO format)"),
    end: datetime = Query(..., description="End of time range (ISO format)"),
    interface: Optional[str] = Query(None, description="Filter to a specific interface name"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Return time-bucketed interface traffic metrics for a device.

    Bandwidth (bps) is computed from raw cumulative byte counters using
    SQL LAG() window functions — no poller-side state is required.
    Counter wraps (rx_bytes < prev_rx) are treated as NULL to avoid
    incorrect spikes.
    """
    await _check_tenant_access(current_user, tenant_id, db)
    bucket = _bucket_for_range(start, end)

    # Build interface filter clause conditionally.
    # The interface name is passed as a bind parameter — never interpolated
    # into the SQL string — so this is safe from SQL injection.
    interface_filter = "AND interface = :interface" if interface else ""

    sql = f"""
        WITH ordered AS (
            SELECT
                time,
                interface,
                rx_bytes,
                tx_bytes,
                LAG(rx_bytes) OVER (PARTITION BY interface ORDER BY time) AS prev_rx,
                LAG(tx_bytes) OVER (PARTITION BY interface ORDER BY time) AS prev_tx,
                EXTRACT(EPOCH FROM time - LAG(time) OVER (PARTITION BY interface ORDER BY time)) AS dt
            FROM interface_metrics
            WHERE device_id = :device_id
              AND time >= :start AND time < :end
              {interface_filter}
        ),
        with_bps AS (
            SELECT
                time,
                interface,
                rx_bytes,
                tx_bytes,
                CASE WHEN rx_bytes >= prev_rx AND dt > 0
                    THEN ((rx_bytes - prev_rx) * 8 / dt)::bigint
                    ELSE NULL END AS rx_bps,
                CASE WHEN tx_bytes >= prev_tx AND dt > 0
                    THEN ((tx_bytes - prev_tx) * 8 / dt)::bigint
                    ELSE NULL END AS tx_bps
            FROM ordered
            WHERE prev_rx IS NOT NULL
        )
        SELECT
            time_bucket(:bucket, time) AS bucket,
            interface,
            avg(rx_bps)::bigint AS avg_rx_bps,
            avg(tx_bps)::bigint AS avg_tx_bps,
            max(rx_bps)::bigint AS max_rx_bps,
            max(tx_bps)::bigint AS max_tx_bps
        FROM with_bps
        WHERE rx_bps IS NOT NULL
        GROUP BY bucket, interface
        ORDER BY interface, bucket ASC
    """

    params: dict[str, Any] = {
        "bucket": bucket,
        "device_id": str(device_id),
        "start": start,
        "end": end,
    }
    if interface:
        params["interface"] = interface

    result = await db.execute(text(sql), params)
    rows = result.mappings().all()
    return [dict(row) for row in rows]


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/metrics/interfaces/list",
    summary="List distinct interface names for a device",
)
async def device_interface_list(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    """Return distinct interface names seen in interface_metrics for a device."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT DISTINCT interface
            FROM interface_metrics
            WHERE device_id = :device_id
            ORDER BY interface
        """),
        {"device_id": str(device_id)},
    )
    rows = result.scalars().all()
    return list(rows)


# ---------------------------------------------------------------------------
# Wireless metrics
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/metrics/wireless",
    summary="Time-bucketed wireless metrics (clients, signal, CCQ)",
)
async def device_wireless_metrics(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    start: datetime = Query(..., description="Start of time range (ISO format)"),
    end: datetime = Query(..., description="End of time range (ISO format)"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return time-bucketed wireless metrics per interface for a device."""
    await _check_tenant_access(current_user, tenant_id, db)
    bucket = _bucket_for_range(start, end)

    result = await db.execute(
        text("""
            SELECT
                time_bucket(:bucket, time) AS bucket,
                interface,
                avg(client_count)::smallint AS avg_clients,
                max(client_count)::smallint AS max_clients,
                avg(avg_signal)::smallint AS avg_signal,
                avg(ccq)::smallint AS avg_ccq,
                max(frequency) AS frequency
            FROM wireless_metrics
            WHERE device_id = :device_id
              AND time >= :start AND time < :end
            GROUP BY bucket, interface
            ORDER BY interface, bucket ASC
        """),
        {"bucket": bucket, "device_id": str(device_id), "start": start, "end": end},
    )
    rows = result.mappings().all()
    return [dict(row) for row in rows]


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/metrics/wireless/latest",
    summary="Latest wireless stats per interface (not time-bucketed)",
)
async def device_wireless_latest(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return the most recent wireless reading per interface for a device."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT DISTINCT ON (interface)
                interface, client_count, avg_signal, ccq, frequency, time
            FROM wireless_metrics
            WHERE device_id = :device_id
            ORDER BY interface, time DESC
        """),
        {"device_id": str(device_id)},
    )
    rows = result.mappings().all()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Sparkline
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/metrics/sparkline",
    summary="Last 12 health readings for sparkline display",
)
async def device_sparkline(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Return the last 12 CPU readings (in chronological order) for sparkline
    display in the fleet table.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT cpu_load, time
            FROM (
                SELECT cpu_load, time
                FROM health_metrics
                WHERE device_id = :device_id
                ORDER BY time DESC
                LIMIT 12
            ) sub
            ORDER BY time ASC
        """),
        {"device_id": str(device_id)},
    )
    rows = result.mappings().all()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Fleet summary
# ---------------------------------------------------------------------------

_FLEET_SUMMARY_SQL = """
    SELECT
        d.id, d.hostname, d.ip_address, d.status, d.model, d.last_seen,
        d.uptime_seconds, d.last_cpu_load, d.last_memory_used_pct,
        d.latitude, d.longitude,
        d.tenant_id, t.name AS tenant_name
    FROM devices d
    JOIN tenants t ON d.tenant_id = t.id
    ORDER BY t.name, d.hostname
"""


@router.get(
    "/tenants/{tenant_id}/fleet/summary",
    summary="Fleet summary for a tenant (latest metrics per device)",
)
async def fleet_summary(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Return fleet summary for a single tenant.

    Queries the devices table (not hypertables) for speed.
    RLS filters to only devices belonging to the tenant automatically.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(text(_FLEET_SUMMARY_SQL))
    rows = result.mappings().all()
    return [dict(row) for row in rows]


@router.get(
    "/fleet/summary",
    summary="Cross-tenant fleet summary (super_admin only)",
)
async def fleet_summary_all(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Return fleet summary across ALL tenants.

    Requires super_admin role. The RLS policy for super_admin returns all
    rows across all tenants, so the same SQL query works without modification.
    This avoids the N+1 problem of fetching per-tenant summaries in a loop.
    """
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin required",
        )

    result = await db.execute(text(_FLEET_SUMMARY_SQL))
    rows = result.mappings().all()
    return [dict(row) for row in rows]
