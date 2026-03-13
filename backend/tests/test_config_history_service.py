"""Tests for config history timeline service.

Tests the get_config_history function with mocked DB sessions,
following the same AsyncMock pattern as test_config_diff_service.py.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from datetime import datetime, timezone


def _make_change_row(change_id, component, summary, created_at, diff_id, lines_added, lines_removed, snapshot_id):
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
        _make_change_row(change_id, "ip/firewall/filter", "Added 1 rule", ts, diff_id, 3, 1, snapshot_id),
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
