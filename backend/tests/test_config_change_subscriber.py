"""Tests for config change NATS subscriber."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import uuid4

from app.services.config_change_subscriber import handle_config_changed


@pytest.mark.asyncio
async def test_triggers_backup_on_config_change():
    """Config change event should trigger a backup."""
    event = {
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "old_timestamp": "2026-03-07 11:00:00",
        "new_timestamp": "2026-03-07 12:00:00",
    }

    with patch(
        "app.services.config_change_subscriber.backup_service.run_backup",
        new_callable=AsyncMock,
    ) as mock_backup, patch(
        "app.services.config_change_subscriber._last_backup_within_dedup_window",
        new_callable=AsyncMock,
        return_value=False,
    ):
        await handle_config_changed(event)

    mock_backup.assert_called_once()
    assert mock_backup.call_args[1]["trigger_type"] == "config-change"


@pytest.mark.asyncio
async def test_skips_backup_within_dedup_window():
    """Should skip backup if last backup was < 5 minutes ago."""
    event = {
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "old_timestamp": "2026-03-07 11:00:00",
        "new_timestamp": "2026-03-07 12:00:00",
    }

    with patch(
        "app.services.config_change_subscriber.backup_service.run_backup",
        new_callable=AsyncMock,
    ) as mock_backup, patch(
        "app.services.config_change_subscriber._last_backup_within_dedup_window",
        new_callable=AsyncMock,
        return_value=True,
    ):
        await handle_config_changed(event)

    mock_backup.assert_not_called()
