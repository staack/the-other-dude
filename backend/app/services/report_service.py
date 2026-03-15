"""Report generation service.

Generates PDF (via Jinja2 + weasyprint) and CSV reports for:
- Device inventory
- Metrics summary
- Alert history
- Change log (audit_logs if available, else config_backups fallback)

Phase 30 NOTE: Reports are currently ephemeral (generated on-demand per request,
never stored at rest). DATAENC-03 requires "report content is encrypted before
storage." Since no report storage exists yet, encryption will be applied when
report caching/storage is added. The generation pipeline is Transit-ready --
wrap the file_bytes with encrypt_data_transit() before any future INSERT.
"""

import csv
import io
import os
import time
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

import structlog
from jinja2 import Environment, FileSystemLoader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

# Jinja2 environment pointing at the templates directory
_TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
_jinja_env = Environment(
    loader=FileSystemLoader(_TEMPLATE_DIR),
    autoescape=True,
)


async def generate_report(
    db: AsyncSession,
    tenant_id: UUID,
    report_type: str,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    fmt: str = "pdf",
) -> tuple[bytes, str, str]:
    """Generate a report and return (file_bytes, content_type, filename).

    Args:
        db: RLS-enforced async session (tenant context already set).
        tenant_id: Tenant UUID for scoping.
        report_type: One of device_inventory, metrics_summary, alert_history, change_log.
        date_from: Start date for time-ranged reports.
        date_to: End date for time-ranged reports.
        fmt: Output format -- "pdf" or "csv".

    Returns:
        Tuple of (file_bytes, content_type, filename).
    """
    start = time.monotonic()

    # Fetch tenant name for the header
    tenant_name = await _get_tenant_name(db, tenant_id)

    # Dispatch to the appropriate handler
    handlers = {
        "device_inventory": _device_inventory,
        "metrics_summary": _metrics_summary,
        "alert_history": _alert_history,
        "change_log": _change_log,
    }
    handler = handlers[report_type]
    template_data = await handler(db, tenant_id, date_from, date_to)

    # Common template context
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    base_context = {
        "tenant_name": tenant_name,
        "generated_at": generated_at,
    }

    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    if fmt == "csv":
        file_bytes = _render_csv(report_type, template_data)
        content_type = "text/csv; charset=utf-8"
        filename = f"{report_type}_{timestamp_str}.csv"
    else:
        file_bytes = _render_pdf(report_type, {**base_context, **template_data})
        content_type = "application/pdf"
        filename = f"{report_type}_{timestamp_str}.pdf"

    elapsed = time.monotonic() - start
    logger.info(
        "report_generated",
        report_type=report_type,
        format=fmt,
        tenant_id=str(tenant_id),
        size_bytes=len(file_bytes),
        elapsed_seconds=round(elapsed, 2),
    )

    return file_bytes, content_type, filename


# ---------------------------------------------------------------------------
# Tenant name helper
# ---------------------------------------------------------------------------


async def _get_tenant_name(db: AsyncSession, tenant_id: UUID) -> str:
    """Fetch the tenant name by ID."""
    result = await db.execute(
        text("SELECT name FROM tenants WHERE id = CAST(:tid AS uuid)"),
        {"tid": str(tenant_id)},
    )
    row = result.fetchone()
    return row[0] if row else "Unknown Tenant"


# ---------------------------------------------------------------------------
# Report type handlers
# ---------------------------------------------------------------------------


async def _device_inventory(
    db: AsyncSession,
    tenant_id: UUID,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
) -> dict[str, Any]:
    """Gather device inventory data."""
    result = await db.execute(
        text("""
            SELECT d.hostname, d.ip_address, d.model, d.routeros_version,
                   d.status, d.last_seen, d.uptime_seconds,
                   COALESCE(
                       (SELECT string_agg(dg.name, ', ')
                        FROM device_group_memberships dgm
                        JOIN device_groups dg ON dg.id = dgm.group_id
                        WHERE dgm.device_id = d.id),
                       ''
                   ) AS groups
            FROM devices d
            ORDER BY d.hostname ASC
        """)
    )
    rows = result.fetchall()

    devices = []
    online_count = 0
    offline_count = 0
    unknown_count = 0

    for row in rows:
        status = row[4]
        if status == "online":
            online_count += 1
        elif status == "offline":
            offline_count += 1
        else:
            unknown_count += 1

        uptime_str = _format_uptime(row[6]) if row[6] else None
        last_seen_str = row[5].strftime("%Y-%m-%d %H:%M") if row[5] else None

        devices.append(
            {
                "hostname": row[0],
                "ip_address": row[1],
                "model": row[2],
                "routeros_version": row[3],
                "status": status,
                "last_seen": last_seen_str,
                "uptime": uptime_str,
                "groups": row[7] if row[7] else None,
            }
        )

    return {
        "report_title": "Device Inventory",
        "devices": devices,
        "total_devices": len(devices),
        "online_count": online_count,
        "offline_count": offline_count,
        "unknown_count": unknown_count,
    }


async def _metrics_summary(
    db: AsyncSession,
    tenant_id: UUID,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
) -> dict[str, Any]:
    """Gather metrics summary data grouped by device."""
    result = await db.execute(
        text("""
            SELECT d.hostname,
                   AVG(hm.cpu_load) AS avg_cpu,
                   MAX(hm.cpu_load) AS peak_cpu,
                   AVG(CASE WHEN hm.total_memory > 0
                       THEN 100.0 * (hm.total_memory - hm.free_memory) / hm.total_memory
                       END) AS avg_mem,
                   MAX(CASE WHEN hm.total_memory > 0
                       THEN 100.0 * (hm.total_memory - hm.free_memory) / hm.total_memory
                       END) AS peak_mem,
                   AVG(CASE WHEN hm.total_disk > 0
                       THEN 100.0 * (hm.total_disk - hm.free_disk) / hm.total_disk
                       END) AS avg_disk,
                   AVG(hm.temperature) AS avg_temp,
                   COUNT(*) AS data_points
            FROM health_metrics hm
            JOIN devices d ON d.id = hm.device_id
            WHERE hm.time >= :date_from
              AND hm.time <= :date_to
            GROUP BY d.id, d.hostname
            ORDER BY avg_cpu DESC NULLS LAST
        """),
        {
            "date_from": date_from,
            "date_to": date_to,
        },
    )
    rows = result.fetchall()

    devices = []
    for row in rows:
        devices.append(
            {
                "hostname": row[0],
                "avg_cpu": float(row[1]) if row[1] is not None else None,
                "peak_cpu": float(row[2]) if row[2] is not None else None,
                "avg_mem": float(row[3]) if row[3] is not None else None,
                "peak_mem": float(row[4]) if row[4] is not None else None,
                "avg_disk": float(row[5]) if row[5] is not None else None,
                "avg_temp": float(row[6]) if row[6] is not None else None,
                "data_points": row[7],
            }
        )

    return {
        "report_title": "Metrics Summary",
        "devices": devices,
        "date_from": date_from.strftime("%Y-%m-%d") if date_from else "",
        "date_to": date_to.strftime("%Y-%m-%d") if date_to else "",
    }


async def _alert_history(
    db: AsyncSession,
    tenant_id: UUID,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
) -> dict[str, Any]:
    """Gather alert history data."""
    result = await db.execute(
        text("""
            SELECT ae.fired_at, ae.resolved_at, ae.severity, ae.status,
                   ae.message, d.hostname,
                   EXTRACT(EPOCH FROM (ae.resolved_at - ae.fired_at)) AS duration_secs
            FROM alert_events ae
            LEFT JOIN devices d ON d.id = ae.device_id
            WHERE ae.fired_at >= :date_from
              AND ae.fired_at <= :date_to
            ORDER BY ae.fired_at DESC
        """),
        {
            "date_from": date_from,
            "date_to": date_to,
        },
    )
    rows = result.fetchall()

    alerts = []
    critical_count = 0
    warning_count = 0
    info_count = 0
    resolved_durations: list[float] = []

    for row in rows:
        severity = row[2]
        if severity == "critical":
            critical_count += 1
        elif severity == "warning":
            warning_count += 1
        else:
            info_count += 1

        duration_secs = float(row[6]) if row[6] is not None else None
        if duration_secs is not None:
            resolved_durations.append(duration_secs)

        alerts.append(
            {
                "fired_at": row[0].strftime("%Y-%m-%d %H:%M") if row[0] else "-",
                "hostname": row[5],
                "severity": severity,
                "status": row[3],
                "message": row[4],
                "duration": _format_duration(duration_secs) if duration_secs is not None else None,
            }
        )

    mttr_minutes = None
    mttr_display = None
    if resolved_durations:
        avg_secs = sum(resolved_durations) / len(resolved_durations)
        mttr_minutes = round(avg_secs / 60, 1)
        mttr_display = _format_duration(avg_secs)

    return {
        "report_title": "Alert History",
        "alerts": alerts,
        "total_alerts": len(alerts),
        "critical_count": critical_count,
        "warning_count": warning_count,
        "info_count": info_count,
        "mttr_minutes": mttr_minutes,
        "mttr_display": mttr_display,
        "date_from": date_from.strftime("%Y-%m-%d") if date_from else "",
        "date_to": date_to.strftime("%Y-%m-%d") if date_to else "",
    }


async def _change_log(
    db: AsyncSession,
    tenant_id: UUID,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
) -> dict[str, Any]:
    """Gather change log data -- try audit_logs table first, fall back to config_backups."""
    # Check if audit_logs table exists (17-01 may not have run yet)
    has_audit_logs = await _table_exists(db, "audit_logs")

    if has_audit_logs:
        return await _change_log_from_audit(db, date_from, date_to)
    else:
        return await _change_log_from_backups(db, date_from, date_to)


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    """Check if a table exists in the database."""
    result = await db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = :table_name
            )
        """),
        {"table_name": table_name},
    )
    return bool(result.scalar())


async def _change_log_from_audit(
    db: AsyncSession,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
) -> dict[str, Any]:
    """Build change log from audit_logs table."""
    result = await db.execute(
        text("""
            SELECT al.created_at, u.name AS user_name, al.action,
                   d.hostname, al.resource_type,
                   al.details
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            LEFT JOIN devices d ON d.id = al.device_id
            WHERE al.created_at >= :date_from
              AND al.created_at <= :date_to
            ORDER BY al.created_at DESC
        """),
        {
            "date_from": date_from,
            "date_to": date_to,
        },
    )
    rows = result.fetchall()

    entries = []
    for row in rows:
        entries.append(
            {
                "timestamp": row[0].strftime("%Y-%m-%d %H:%M") if row[0] else "-",
                "user": row[1],
                "action": row[2],
                "device": row[3],
                "details": row[4] or row[5] or "",
            }
        )

    return {
        "report_title": "Change Log",
        "entries": entries,
        "total_entries": len(entries),
        "data_source": "Audit Logs",
        "date_from": date_from.strftime("%Y-%m-%d") if date_from else "",
        "date_to": date_to.strftime("%Y-%m-%d") if date_to else "",
    }


async def _change_log_from_backups(
    db: AsyncSession,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
) -> dict[str, Any]:
    """Build change log from config_backups + alert_events as fallback."""
    # Config backups as change events
    backup_result = await db.execute(
        text("""
            SELECT cb.created_at, 'system' AS user_name, 'config_backup' AS action,
                   d.hostname, cb.trigger_type AS details
            FROM config_backups cb
            JOIN devices d ON d.id = cb.device_id
            WHERE cb.created_at >= :date_from
              AND cb.created_at <= :date_to
        """),
        {
            "date_from": date_from,
            "date_to": date_to,
        },
    )
    backup_rows = backup_result.fetchall()

    # Alert events as change events
    alert_result = await db.execute(
        text("""
            SELECT ae.fired_at, 'system' AS user_name,
                   ae.severity || '_alert' AS action,
                   d.hostname, ae.message AS details
            FROM alert_events ae
            LEFT JOIN devices d ON d.id = ae.device_id
            WHERE ae.fired_at >= :date_from
              AND ae.fired_at <= :date_to
        """),
        {
            "date_from": date_from,
            "date_to": date_to,
        },
    )
    alert_rows = alert_result.fetchall()

    # Merge and sort by timestamp descending
    entries = []
    for row in backup_rows:
        entries.append(
            {
                "timestamp": row[0].strftime("%Y-%m-%d %H:%M") if row[0] else "-",
                "user": row[1],
                "action": row[2],
                "device": row[3],
                "details": row[4] or "",
            }
        )
    for row in alert_rows:
        entries.append(
            {
                "timestamp": row[0].strftime("%Y-%m-%d %H:%M") if row[0] else "-",
                "user": row[1],
                "action": row[2],
                "device": row[3],
                "details": row[4] or "",
            }
        )

    # Sort by timestamp string descending
    entries.sort(key=lambda e: e["timestamp"], reverse=True)

    return {
        "report_title": "Change Log",
        "entries": entries,
        "total_entries": len(entries),
        "data_source": "Backups + Alerts",
        "date_from": date_from.strftime("%Y-%m-%d") if date_from else "",
        "date_to": date_to.strftime("%Y-%m-%d") if date_to else "",
    }


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------


def _render_pdf(report_type: str, context: dict[str, Any]) -> bytes:
    """Render HTML template and convert to PDF via weasyprint."""
    import weasyprint

    template = _jinja_env.get_template(f"reports/{report_type}.html")
    html_str = template.render(**context)
    pdf_bytes = weasyprint.HTML(string=html_str).write_pdf()
    return pdf_bytes


def _render_csv(report_type: str, data: dict[str, Any]) -> bytes:
    """Render report data as CSV bytes."""
    output = io.StringIO()
    writer = csv.writer(output)

    if report_type == "device_inventory":
        writer.writerow(
            [
                "Hostname",
                "IP Address",
                "Model",
                "RouterOS Version",
                "Status",
                "Last Seen",
                "Uptime",
                "Groups",
            ]
        )
        for d in data.get("devices", []):
            writer.writerow(
                [
                    d["hostname"],
                    d["ip_address"],
                    d["model"] or "",
                    d["routeros_version"] or "",
                    d["status"],
                    d["last_seen"] or "",
                    d["uptime"] or "",
                    d["groups"] or "",
                ]
            )

    elif report_type == "metrics_summary":
        writer.writerow(
            [
                "Hostname",
                "Avg CPU %",
                "Peak CPU %",
                "Avg Memory %",
                "Peak Memory %",
                "Avg Disk %",
                "Avg Temp",
                "Data Points",
            ]
        )
        for d in data.get("devices", []):
            writer.writerow(
                [
                    d["hostname"],
                    f"{d['avg_cpu']:.1f}" if d["avg_cpu"] is not None else "",
                    f"{d['peak_cpu']:.1f}" if d["peak_cpu"] is not None else "",
                    f"{d['avg_mem']:.1f}" if d["avg_mem"] is not None else "",
                    f"{d['peak_mem']:.1f}" if d["peak_mem"] is not None else "",
                    f"{d['avg_disk']:.1f}" if d["avg_disk"] is not None else "",
                    f"{d['avg_temp']:.1f}" if d["avg_temp"] is not None else "",
                    d["data_points"],
                ]
            )

    elif report_type == "alert_history":
        writer.writerow(
            [
                "Timestamp",
                "Device",
                "Severity",
                "Message",
                "Status",
                "Duration",
            ]
        )
        for a in data.get("alerts", []):
            writer.writerow(
                [
                    a["fired_at"],
                    a["hostname"] or "",
                    a["severity"],
                    a["message"] or "",
                    a["status"],
                    a["duration"] or "",
                ]
            )

    elif report_type == "change_log":
        writer.writerow(
            [
                "Timestamp",
                "User",
                "Action",
                "Device",
                "Details",
            ]
        )
        for e in data.get("entries", []):
            writer.writerow(
                [
                    e["timestamp"],
                    e["user"] or "",
                    e["action"],
                    e["device"] or "",
                    e["details"] or "",
                ]
            )

    return output.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# Formatting utilities
# ---------------------------------------------------------------------------


def _format_uptime(seconds: int) -> str:
    """Format uptime seconds as human-readable string."""
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    if days > 0:
        return f"{days}d {hours}h {minutes}m"
    elif hours > 0:
        return f"{hours}h {minutes}m"
    else:
        return f"{minutes}m"


def _format_duration(seconds: float) -> str:
    """Format a duration in seconds as a human-readable string."""
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds // 60)}m {int(seconds % 60)}s"
    elif seconds < 86400:
        hours = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        return f"{hours}h {mins}m"
    else:
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        return f"{days}d {hours}h"
