"""Config history timeline service.

Provides paginated query of config change entries for a device,
joining router_config_changes with router_config_diffs to include
diff metadata (lines_added, lines_removed, snapshot_id).
"""

import logging

from sqlalchemy import text

logger = logging.getLogger(__name__)


async def get_config_history(
    device_id: str,
    tenant_id: str,
    session,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Return paginated config change timeline for a device.

    Joins router_config_changes with router_config_diffs to get
    diff metadata alongside each change entry. Results are ordered
    by created_at DESC (newest first).

    Returns a list of dicts with: id, component, summary, created_at,
    diff_id, lines_added, lines_removed, snapshot_id.
    """
    result = await session.execute(
        text(
            "SELECT c.id, c.component, c.summary, c.created_at, "
            "d.id AS diff_id, d.lines_added, d.lines_removed, "
            "d.new_snapshot_id AS snapshot_id "
            "FROM router_config_changes c "
            "JOIN router_config_diffs d ON c.diff_id = d.id "
            "WHERE c.device_id = CAST(:device_id AS uuid) "
            "AND c.tenant_id = CAST(:tenant_id AS uuid) "
            "ORDER BY c.created_at DESC "
            "LIMIT :limit OFFSET :offset"
        ),
        {
            "device_id": device_id,
            "tenant_id": tenant_id,
            "limit": limit,
            "offset": offset,
        },
    )
    rows = result.fetchall()

    return [
        {
            "id": str(row._mapping["id"]),
            "component": row._mapping["component"],
            "summary": row._mapping["summary"],
            "created_at": row._mapping["created_at"].isoformat(),
            "diff_id": str(row._mapping["diff_id"]),
            "lines_added": row._mapping["lines_added"],
            "lines_removed": row._mapping["lines_removed"],
            "snapshot_id": str(row._mapping["snapshot_id"]),
        }
        for row in rows
    ]
