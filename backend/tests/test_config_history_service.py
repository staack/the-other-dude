"""Tests for config history timeline service.

Tests the get_config_history function with mocked DB sessions,
following the same AsyncMock pattern as test_config_diff_service.py.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from datetime import datetime, timezone


def _make_change_row(
    change_id, component, summary, created_at, diff_id, lines_added, lines_removed, snapshot_id
):
    """Create a mock row matching the JOIN query result."""
    row = MagicMock()
    row._mapping = {
        "id": change_id,
        "component": component,
        "summary": summary,
        "created_at": created_at,
        "diff_id": diff_id,
        "lines_added": lines_added,
        "lines_removed": lines_removed,
        "snapshot_id": snapshot_id,
    }
    return row


@pytest.mark.asyncio
async def test_returns_formatted_entries():
    """get_config_history returns entries with all expected fields."""
    from app.services.config_history_service import get_config_history

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    change_id = uuid4()
    diff_id = uuid4()
    snapshot_id = uuid4()
    ts = datetime(2026, 3, 12, 10, 0, 0, tzinfo=timezone.utc)

    mock_session = AsyncMock()
    result_mock = MagicMock()
    result_mock.fetchall.return_value = [
        _make_change_row(
            change_id, "ip/firewall/filter", "Added 1 rule", ts, diff_id, 3, 1, snapshot_id
        ),
    ]
    mock_session.execute = AsyncMock(return_value=result_mock)

    entries = await get_config_history(device_id, tenant_id, mock_session)

    assert len(entries) == 1
    entry = entries[0]
    assert entry["id"] == str(change_id)
    assert entry["component"] == "ip/firewall/filter"
    assert entry["summary"] == "Added 1 rule"
    assert entry["created_at"] == ts.isoformat()
    assert entry["diff_id"] == str(diff_id)
    assert entry["lines_added"] == 3
    assert entry["lines_removed"] == 1
    assert entry["snapshot_id"] == str(snapshot_id)


@pytest.mark.asyncio
async def test_empty_result_returns_empty_list():
    """get_config_history returns empty list when device has no changes."""
    from app.services.config_history_service import get_config_history

    mock_session = AsyncMock()
    result_mock = MagicMock()
    result_mock.fetchall.return_value = []
    mock_session.execute = AsyncMock(return_value=result_mock)

    entries = await get_config_history(str(uuid4()), str(uuid4()), mock_session)

    assert entries == []


@pytest.mark.asyncio
async def test_pagination_parameters_passed():
    """get_config_history passes limit and offset to the query."""
    from app.services.config_history_service import get_config_history

    mock_session = AsyncMock()
    result_mock = MagicMock()
    result_mock.fetchall.return_value = []
    mock_session.execute = AsyncMock(return_value=result_mock)

    await get_config_history(str(uuid4()), str(uuid4()), mock_session, limit=10, offset=20)

    # Verify the query params include limit and offset
    call_args = mock_session.execute.call_args
    query_params = call_args[0][1]
    assert query_params["limit"] == 10
    assert query_params["offset"] == 20


@pytest.mark.asyncio
async def test_ordering_desc_by_created_at():
    """get_config_history returns entries ordered by created_at DESC."""
    from app.services.config_history_service import get_config_history

    device_id = str(uuid4())
    tenant_id = str(uuid4())

    ts_newer = datetime(2026, 3, 12, 12, 0, 0, tzinfo=timezone.utc)
    ts_older = datetime(2026, 3, 12, 10, 0, 0, tzinfo=timezone.utc)

    mock_session = AsyncMock()
    result_mock = MagicMock()
    # Rows returned in DESC order (newest first) as SQL would return them
    result_mock.fetchall.return_value = [
        _make_change_row(uuid4(), "ip/address", "Changed IP", ts_newer, uuid4(), 1, 1, uuid4()),
        _make_change_row(uuid4(), "ip/firewall", "Added rule", ts_older, uuid4(), 2, 0, uuid4()),
    ]
    mock_session.execute = AsyncMock(return_value=result_mock)

    entries = await get_config_history(device_id, tenant_id, mock_session)

    assert len(entries) == 2
    # SQL query contains ORDER BY ... DESC; verify the query text
    call_args = mock_session.execute.call_args
    query_text = str(call_args[0][0])
    assert "DESC" in query_text.upper()


# ---------------------------------------------------------------------------
# Tests for get_snapshot
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_snapshot_returns_decrypted_content():
    """get_snapshot decrypts config_text via Transit and returns plaintext."""
    from unittest.mock import patch
    from app.services.config_history_service import get_snapshot

    snapshot_id = str(uuid4())
    device_id = str(uuid4())
    tenant_id = str(uuid4())
    ts = datetime(2026, 3, 12, 10, 0, 0, tzinfo=timezone.utc)
    sha = "abc123" * 10 + "abcd"

    mock_session = AsyncMock()
    result_mock = MagicMock()
    row = MagicMock()
    row._mapping = {
        "id": uuid4(),
        "config_text": "vault:v1:encrypted_data",
        "sha256_hash": sha,
        "collected_at": ts,
    }
    result_mock.fetchone.return_value = row
    mock_session.execute = AsyncMock(return_value=result_mock)

    plaintext_config = "/ip address\nadd address=10.0.0.1/24"
    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(return_value=plaintext_config.encode("utf-8"))

    with patch(
        "app.services.config_history_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        result = await get_snapshot(snapshot_id, device_id, tenant_id, mock_session)

    assert result is not None
    assert result["config_text"] == plaintext_config
    assert result["sha256_hash"] == sha
    assert result["collected_at"] == ts.isoformat()
    mock_openbao.decrypt.assert_called_once_with(tenant_id, "vault:v1:encrypted_data")
    mock_openbao.close.assert_called_once()


@pytest.mark.asyncio
async def test_get_snapshot_not_found_returns_none():
    """get_snapshot returns None when snapshot not found (wrong id/device/tenant)."""
    from app.services.config_history_service import get_snapshot

    mock_session = AsyncMock()
    result_mock = MagicMock()
    result_mock.fetchone.return_value = None
    mock_session.execute = AsyncMock(return_value=result_mock)

    result = await get_snapshot(str(uuid4()), str(uuid4()), str(uuid4()), mock_session)

    assert result is None


# ---------------------------------------------------------------------------
# Tests for get_snapshot_diff
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_snapshot_diff_returns_diff_text():
    """get_snapshot_diff returns diff data for the given snapshot."""
    from app.services.config_history_service import get_snapshot_diff

    snapshot_id = str(uuid4())
    device_id = str(uuid4())
    tenant_id = str(uuid4())
    diff_id = uuid4()
    old_snap = uuid4()
    new_snap = uuid4()
    ts = datetime(2026, 3, 12, 11, 0, 0, tzinfo=timezone.utc)

    mock_session = AsyncMock()
    result_mock = MagicMock()
    row = MagicMock()
    row._mapping = {
        "id": diff_id,
        "diff_text": "--- old\n+++ new\n@@ -1 +1 @@\n-line1\n+line2",
        "lines_added": 1,
        "lines_removed": 1,
        "old_snapshot_id": old_snap,
        "new_snapshot_id": new_snap,
        "created_at": ts,
    }
    result_mock.fetchone.return_value = row
    mock_session.execute = AsyncMock(return_value=result_mock)

    result = await get_snapshot_diff(snapshot_id, device_id, tenant_id, mock_session)

    assert result is not None
    assert result["id"] == str(diff_id)
    assert "line2" in result["diff_text"]
    assert result["lines_added"] == 1
    assert result["lines_removed"] == 1
    assert result["old_snapshot_id"] == str(old_snap)
    assert result["new_snapshot_id"] == str(new_snap)
    assert result["created_at"] == ts.isoformat()


@pytest.mark.asyncio
async def test_get_snapshot_diff_no_diff_returns_none():
    """get_snapshot_diff returns None when no diff exists (first snapshot)."""
    from app.services.config_history_service import get_snapshot_diff

    mock_session = AsyncMock()
    result_mock = MagicMock()
    result_mock.fetchone.return_value = None
    mock_session.execute = AsyncMock(return_value=result_mock)

    result = await get_snapshot_diff(str(uuid4()), str(uuid4()), str(uuid4()), mock_session)

    assert result is None
