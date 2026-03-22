"""Signal history service -- time-bucketed signal strength queries.

Uses raw SQL with TimescaleDB time_bucket() for efficient time-series aggregation.
All queries run via the app_user engine (RLS enforced).
"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.site_alert import SignalHistoryPoint, SignalHistoryResponse

# Mapping of range parameter to (time_bucket interval, lookback interval)
RANGE_CONFIG = {
    "24h": ("5 minutes", "24 hours"),
    "7d": ("1 hour", "7 days"),
    "30d": ("4 hours", "30 days"),
}


async def get_signal_history(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    mac_address: str,
    range: str = "7d",
) -> SignalHistoryResponse:
    """Query time-bucketed signal history for a specific client MAC on a device.

    Args:
        db: Database session (app_user with RLS).
        tenant_id: Tenant UUID for RLS context.
        device_id: Device UUID (the AP the client connects to).
        mac_address: Client MAC address to query history for.
        range: Time range -- "24h", "7d", or "30d".

    Returns:
        SignalHistoryResponse with time-bucketed signal avg/min/max.
    """
    bucket_interval, lookback = RANGE_CONFIG.get(range, RANGE_CONFIG["7d"])

    result = await db.execute(
        text("""
            SELECT
                time_bucket(:bucket_interval, wr.time) AS bucket,
                avg(wr.signal_strength)::int AS signal_avg,
                min(wr.signal_strength) AS signal_min,
                max(wr.signal_strength) AS signal_max
            FROM wireless_registrations wr
            WHERE wr.mac_address = :mac_address
              AND wr.device_id = :device_id
              AND wr.tenant_id = :tenant_id
              AND wr.time > now() - CAST(:lookback AS interval)
              AND wr.signal_strength IS NOT NULL
            GROUP BY bucket
            ORDER BY bucket
        """),
        {
            "bucket_interval": bucket_interval,
            "lookback": lookback,
            "mac_address": mac_address,
            "device_id": str(device_id),
            "tenant_id": str(tenant_id),
        },
    )
    rows = result.fetchall()

    items = [
        SignalHistoryPoint(
            timestamp=row.bucket,
            signal_avg=row.signal_avg,
            signal_min=row.signal_min,
            signal_max=row.signal_max,
        )
        for row in rows
    ]

    return SignalHistoryResponse(items=items, mac_address=mac_address, range=range)
