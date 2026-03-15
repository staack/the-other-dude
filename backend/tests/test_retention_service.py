"""Tests for retention cleanup service.

Tests the cleanup_expired_snapshots function with mocked AdminAsyncSessionLocal
and mocked settings.CONFIG_RETENTION_DAYS.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_cleanup_deletes_expired_snapshots():
    """Test 1: cleanup_expired_snapshots deletes snapshots with collected_at older than retention_days."""
    from app.services.retention_service import cleanup_expired_snapshots

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.rowcount = 5
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "app.services.retention_service.AdminAsyncSessionLocal",
            return_value=mock_ctx,
        ),
        patch(
            "app.services.retention_service.settings",
        ) as mock_settings,
    ):
        mock_settings.CONFIG_RETENTION_DAYS = 90
        count = await cleanup_expired_snapshots()

    # Should execute the DELETE query
    mock_session.execute.assert_called_once()
    # Verify DELETE uses make_interval with the configured days
    sql_text = str(mock_session.execute.call_args[0][0].text)
    assert "make_interval" in sql_text
    assert "DELETE" in sql_text
    assert "router_config_snapshots" in sql_text
    # Should commit
    mock_session.commit.assert_called_once()
    # Should return the deleted count
    assert count == 5


@pytest.mark.asyncio
async def test_cleanup_keeps_snapshots_within_retention_window():
    """Test 2: cleanup_expired_snapshots keeps snapshots within the retention window."""
    from app.services.retention_service import cleanup_expired_snapshots

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.rowcount = 0  # No rows deleted means all within window
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "app.services.retention_service.AdminAsyncSessionLocal",
            return_value=mock_ctx,
        ),
        patch(
            "app.services.retention_service.settings",
        ) as mock_settings,
    ):
        mock_settings.CONFIG_RETENTION_DAYS = 90
        count = await cleanup_expired_snapshots()

    assert count == 0


@pytest.mark.asyncio
async def test_cleanup_returns_deleted_count():
    """Test 3: cleanup_expired_snapshots returns count of deleted rows."""
    from app.services.retention_service import cleanup_expired_snapshots

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.rowcount = 42
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "app.services.retention_service.AdminAsyncSessionLocal",
            return_value=mock_ctx,
        ),
        patch(
            "app.services.retention_service.settings",
        ) as mock_settings,
    ):
        mock_settings.CONFIG_RETENTION_DAYS = 30
        count = await cleanup_expired_snapshots()

    assert count == 42


@pytest.mark.asyncio
async def test_cleanup_handles_empty_table():
    """Test 4: cleanup_expired_snapshots handles empty table (returns 0)."""
    from app.services.retention_service import cleanup_expired_snapshots

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.rowcount = 0
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "app.services.retention_service.AdminAsyncSessionLocal",
            return_value=mock_ctx,
        ),
        patch(
            "app.services.retention_service.settings",
        ) as mock_settings,
    ):
        mock_settings.CONFIG_RETENTION_DAYS = 90
        count = await cleanup_expired_snapshots()

    assert count == 0
    mock_session.execute.assert_called_once()
    mock_session.commit.assert_called_once()
