"""Tests for config diff generation service.

Tests the generate_and_store_diff function with mocked DB sessions
and OpenBao Transit service.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from uuid import uuid4


def _mock_snapshot_row(snapshot_id, config_text):
    """Create a mock row for snapshot query results."""
    row = MagicMock()
    row._mapping = {"id": snapshot_id, "config_text": config_text}
    return row


@pytest.mark.asyncio
async def test_diff_generated_and_stored():
    """Test 1: Two different configs produce a unified diff and INSERT into router_config_diffs."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())
    old_snapshot_id = str(uuid4())

    old_config = "line1\nline2\nline3"
    new_config = "line1\nline2_modified\nline3"

    mock_session = AsyncMock()

    # Query 1: previous snapshot (returns old snapshot)
    prev_result = MagicMock()
    prev_result.fetchone.return_value = MagicMock(
        _mapping={"id": old_snapshot_id, "config_text": "vault:v1:old_encrypted"}
    )

    # Query 2: new snapshot config_text
    new_result = MagicMock()
    new_result.scalar_one.return_value = "vault:v1:new_encrypted"

    # Query 3: INSERT RETURNING id
    insert_result = MagicMock()
    diff_id = str(uuid4())
    insert_result.scalar_one.return_value = diff_id

    mock_session.execute = AsyncMock(side_effect=[prev_result, new_result, insert_result])
    mock_session.commit = AsyncMock()

    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(side_effect=[
        old_config.encode("utf-8"),
        new_config.encode("utf-8"),
    ])

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ), patch(
        "app.services.config_diff_service.parse_diff_changes",
        return_value=[],
    ):
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    # Should decrypt both configs
    assert mock_openbao.decrypt.call_count == 2
    # Should INSERT (3 executes: prev query, new query, INSERT RETURNING id)
    assert mock_session.execute.call_count == 3
    # Should commit
    mock_session.commit.assert_called_once()
    # Verify INSERT contains correct data
    insert_call = mock_session.execute.call_args_list[2]
    insert_params = insert_call[0][1]
    assert insert_params["old_snapshot_id"] == old_snapshot_id
    assert insert_params["new_snapshot_id"] == new_snapshot_id
    assert insert_params["lines_added"] == 1
    assert insert_params["lines_removed"] == 1
    assert "line2_modified" in insert_params["diff_text"]


@pytest.mark.asyncio
async def test_first_snapshot_no_diff():
    """Test 2: First snapshot (no previous) skips diff generation gracefully."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())

    mock_session = AsyncMock()

    # Query 1: previous snapshot returns None
    prev_result = MagicMock()
    prev_result.fetchone.return_value = None

    mock_session.execute = AsyncMock(return_value=prev_result)
    mock_session.commit = AsyncMock()

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=AsyncMock(),
    ):
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    # Should only query for previous snapshot, then return
    assert mock_session.execute.call_count == 1
    mock_session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_decrypt_failure_logs_and_returns():
    """Test 3: Transit decrypt failure logs warning, does NOT raise."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())
    old_snapshot_id = str(uuid4())

    mock_session = AsyncMock()

    # Query 1: previous snapshot exists
    prev_result = MagicMock()
    prev_result.fetchone.return_value = MagicMock(
        _mapping={"id": old_snapshot_id, "config_text": "vault:v1:old_encrypted"}
    )

    # Query 2: new snapshot config_text
    new_result = MagicMock()
    new_result.scalar_one.return_value = "vault:v1:new_encrypted"

    mock_session.execute = AsyncMock(side_effect=[prev_result, new_result])
    mock_session.commit = AsyncMock()

    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(side_effect=Exception("Transit unavailable"))

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        # Should NOT raise
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    # Should not commit (no INSERT happened)
    mock_session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_line_counts_correct():
    """Test 4: lines_added/lines_removed counts are correct."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())
    old_snapshot_id = str(uuid4())

    # 2 lines removed, 3 lines added
    old_config = "line1\nremoved1\nremoved2\nline4"
    new_config = "line1\nadded1\nadded2\nadded3\nline4"

    mock_session = AsyncMock()

    prev_result = MagicMock()
    prev_result.fetchone.return_value = MagicMock(
        _mapping={"id": old_snapshot_id, "config_text": "vault:v1:old"}
    )
    new_result = MagicMock()
    new_result.scalar_one.return_value = "vault:v1:new"
    insert_result = MagicMock()
    insert_result.scalar_one.return_value = str(uuid4())

    mock_session.execute = AsyncMock(side_effect=[prev_result, new_result, insert_result])
    mock_session.commit = AsyncMock()

    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(side_effect=[
        old_config.encode("utf-8"),
        new_config.encode("utf-8"),
    ])

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ), patch(
        "app.services.config_diff_service.parse_diff_changes",
        return_value=[],
    ):
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    insert_params = mock_session.execute.call_args_list[2][0][1]
    assert insert_params["lines_added"] == 3
    assert insert_params["lines_removed"] == 2


@pytest.mark.asyncio
async def test_empty_diff_skips_insert():
    """Test 5: Identical content (empty diff) skips INSERT."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())
    old_snapshot_id = str(uuid4())

    same_config = "line1\nline2\nline3"

    mock_session = AsyncMock()

    prev_result = MagicMock()
    prev_result.fetchone.return_value = MagicMock(
        _mapping={"id": old_snapshot_id, "config_text": "vault:v1:old"}
    )
    new_result = MagicMock()
    new_result.scalar_one.return_value = "vault:v1:new"

    mock_session.execute = AsyncMock(side_effect=[prev_result, new_result])
    mock_session.commit = AsyncMock()

    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(side_effect=[
        same_config.encode("utf-8"),
        same_config.encode("utf-8"),
    ])

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    # Only 2 queries (prev + new), no INSERT
    assert mock_session.execute.call_count == 2
    mock_session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_change_parser_called_and_changes_stored():
    """Test 6: After diff INSERT, parse_diff_changes is called and results stored in router_config_changes."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())
    old_snapshot_id = str(uuid4())
    diff_id = str(uuid4())

    old_config = "/ip firewall filter\nadd chain=input action=accept"
    new_config = "/ip firewall filter\nadd chain=input action=accept\nadd chain=forward action=drop"

    mock_session = AsyncMock()

    prev_result = MagicMock()
    prev_result.fetchone.return_value = MagicMock(
        _mapping={"id": old_snapshot_id, "config_text": "vault:v1:old"}
    )
    new_result = MagicMock()
    new_result.scalar_one.return_value = "vault:v1:new"
    insert_result = MagicMock()
    insert_result.scalar_one.return_value = diff_id

    # Allow unlimited execute calls (diff INSERT + change INSERTs)
    change_insert_result = MagicMock()
    mock_session.execute = AsyncMock(
        side_effect=[prev_result, new_result, insert_result, change_insert_result]
    )
    mock_session.commit = AsyncMock()

    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(side_effect=[
        old_config.encode("utf-8"),
        new_config.encode("utf-8"),
    ])

    mock_changes = [
        {"component": "ip/firewall/filter", "summary": "Added 1 firewall filter rule", "raw_line": "+add chain=forward action=drop"},
    ]

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ), patch(
        "app.services.config_diff_service.parse_diff_changes",
        return_value=mock_changes,
    ) as mock_parser:
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    # parse_diff_changes called with the diff text
    mock_parser.assert_called_once()
    # 4 execute calls: prev query, new query, diff INSERT, change INSERT
    assert mock_session.execute.call_count == 4
    # 2 commits: one for diff, one for changes
    assert mock_session.commit.call_count == 2
    # Verify change INSERT params
    change_call = mock_session.execute.call_args_list[3]
    change_params = change_call[0][1]
    assert change_params["diff_id"] == diff_id
    assert change_params["component"] == "ip/firewall/filter"
    assert change_params["summary"] == "Added 1 firewall filter rule"


@pytest.mark.asyncio
async def test_change_parser_error_does_not_block_diff():
    """Test 7: parse_diff_changes error does not prevent diff from being stored."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())
    old_snapshot_id = str(uuid4())
    diff_id = str(uuid4())

    old_config = "line1\nline2"
    new_config = "line1\nline2_modified"

    mock_session = AsyncMock()

    prev_result = MagicMock()
    prev_result.fetchone.return_value = MagicMock(
        _mapping={"id": old_snapshot_id, "config_text": "vault:v1:old"}
    )
    new_result = MagicMock()
    new_result.scalar_one.return_value = "vault:v1:new"
    insert_result = MagicMock()
    insert_result.scalar_one.return_value = diff_id

    mock_session.execute = AsyncMock(side_effect=[prev_result, new_result, insert_result])
    mock_session.commit = AsyncMock()

    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(side_effect=[
        old_config.encode("utf-8"),
        new_config.encode("utf-8"),
    ])

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ), patch(
        "app.services.config_diff_service.parse_diff_changes",
        side_effect=Exception("Parser exploded"),
    ):
        # Should NOT raise
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    # Diff INSERT still happened (3 executes)
    assert mock_session.execute.call_count == 3
    # Diff commit still happened
    mock_session.commit.assert_called_once()
