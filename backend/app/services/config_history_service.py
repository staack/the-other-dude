"""Config history timeline service.

Provides paginated query of config change entries for a device,
joining router_config_changes with router_config_diffs to include
diff metadata (lines_added, lines_removed, snapshot_id).

Also provides single-snapshot retrieval (with Transit decrypt) and
diff retrieval by snapshot id.
"""

import logging

from sqlalchemy import text

from app.services.openbao_service import OpenBaoTransitService

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


async def get_snapshot(
    snapshot_id: str,
    device_id: str,
    tenant_id: str,
    session,
) -> dict | None:
    """Return decrypted config snapshot for a given snapshot, device, and tenant.

    Returns None if the snapshot does not exist or belongs to a different
    device/tenant (RLS prevents cross-tenant access).
    """
    result = await session.execute(
        text(
            "SELECT id, config_text, sha256_hash, collected_at "
            "FROM router_config_snapshots "
            "WHERE id = CAST(:snapshot_id AS uuid) "
            "AND device_id = CAST(:device_id AS uuid) "
            "AND tenant_id = CAST(:tenant_id AS uuid)"
        ),
        {
            "snapshot_id": snapshot_id,
            "device_id": device_id,
            "tenant_id": tenant_id,
        },
    )
    row = result.fetchone()
    if row is None:
        return None

    ciphertext = row._mapping["config_text"]

    openbao = OpenBaoTransitService()
    try:
        plaintext_bytes = await openbao.decrypt(tenant_id, ciphertext)
    finally:
        await openbao.close()

    return {
        "id": str(row._mapping["id"]),
        "config_text": plaintext_bytes.decode("utf-8"),
        "sha256_hash": row._mapping["sha256_hash"],
        "collected_at": row._mapping["collected_at"].isoformat(),
    }


async def get_snapshot_diff(
    snapshot_id: str,
    device_id: str,
    tenant_id: str,
    session,
) -> dict | None:
    """Return the diff associated with a snapshot (as the new_snapshot_id).

    Returns None if no diff exists for this snapshot (e.g., first snapshot).
    """
    result = await session.execute(
        text(
            "SELECT id, diff_text, lines_added, lines_removed, "
            "old_snapshot_id, new_snapshot_id, created_at "
            "FROM router_config_diffs "
            "WHERE new_snapshot_id = CAST(:snapshot_id AS uuid) "
            "AND device_id = CAST(:device_id AS uuid) "
            "AND tenant_id = CAST(:tenant_id AS uuid)"
        ),
        {
            "snapshot_id": snapshot_id,
            "device_id": device_id,
            "tenant_id": tenant_id,
        },
    )
    row = result.fetchone()
    if row is None:
        return None

    return {
        "id": str(row._mapping["id"]),
        "diff_text": row._mapping["diff_text"],
        "lines_added": row._mapping["lines_added"],
        "lines_removed": row._mapping["lines_removed"],
        "old_snapshot_id": str(row._mapping["old_snapshot_id"]),
        "new_snapshot_id": str(row._mapping["new_snapshot_id"]),
        "created_at": row._mapping["created_at"].isoformat(),
    }
