"""Tests for push rollback NATS subscriber."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import uuid4

from app.services.push_rollback_subscriber import (
    handle_push_rollback,
    handle_push_alert,
)


@pytest.mark.asyncio
async def test_rollback_triggers_restore():
    """Push rollback should call restore_config with the pre-push commit SHA."""
    event = {
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "push_operation_id": str(uuid4()),
        "pre_push_commit_sha": "abc1234",
    }

    mock_session = AsyncMock()
    mock_cm = AsyncMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "app.services.push_rollback_subscriber.restore_service.restore_config",
            new_callable=AsyncMock,
            return_value={"status": "committed"},
        ) as mock_restore,
        patch(
            "app.services.push_rollback_subscriber.AdminAsyncSessionLocal",
            return_value=mock_cm,
        ),
    ):
        await handle_push_rollback(event)

    mock_restore.assert_called_once()
    call_kwargs = mock_restore.call_args[1]
    assert call_kwargs["device_id"] == event["device_id"]
    assert call_kwargs["tenant_id"] == event["tenant_id"]
    assert call_kwargs["commit_sha"] == "abc1234"
    assert call_kwargs["db_session"] is mock_session


@pytest.mark.asyncio
async def test_rollback_missing_fields_skips():
    """Rollback with missing fields should log warning and return."""
    event = {"device_id": str(uuid4())}  # missing tenant_id and commit_sha

    with patch(
        "app.services.push_rollback_subscriber.restore_service.restore_config",
        new_callable=AsyncMock,
    ) as mock_restore:
        await handle_push_rollback(event)

    mock_restore.assert_not_called()


@pytest.mark.asyncio
async def test_rollback_failure_creates_alert():
    """When restore_config raises, an alert should be created."""
    event = {
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "pre_push_commit_sha": "abc1234",
    }

    mock_session = AsyncMock()
    mock_cm = AsyncMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "app.services.push_rollback_subscriber.restore_service.restore_config",
            new_callable=AsyncMock,
            side_effect=RuntimeError("SSH failed"),
        ),
        patch(
            "app.services.push_rollback_subscriber.AdminAsyncSessionLocal",
            return_value=mock_cm,
        ),
        patch(
            "app.services.push_rollback_subscriber._create_push_alert",
            new_callable=AsyncMock,
        ) as mock_alert,
    ):
        await handle_push_rollback(event)

    mock_alert.assert_called_once_with(
        event["device_id"],
        event["tenant_id"],
        "template (auto-rollback failed)",
    )


@pytest.mark.asyncio
async def test_alert_creates_alert_record():
    """Editor push alert should create a high-priority alert."""
    event = {
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "push_type": "editor",
    }

    with patch(
        "app.services.push_rollback_subscriber._create_push_alert",
        new_callable=AsyncMock,
    ) as mock_alert:
        await handle_push_alert(event)

    mock_alert.assert_called_once_with(
        event["device_id"],
        event["tenant_id"],
        "editor",
    )


@pytest.mark.asyncio
async def test_alert_missing_fields_skips():
    """Alert with missing fields should skip."""
    event = {"device_id": str(uuid4())}  # missing tenant_id

    with patch(
        "app.services.push_rollback_subscriber._create_push_alert",
        new_callable=AsyncMock,
    ) as mock_alert:
        await handle_push_alert(event)

    mock_alert.assert_not_called()


@pytest.mark.asyncio
async def test_alert_defaults_to_editor_push_type():
    """Alert without push_type should default to 'editor'."""
    event = {
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        # no push_type
    }

    with patch(
        "app.services.push_rollback_subscriber._create_push_alert",
        new_callable=AsyncMock,
    ) as mock_alert:
        await handle_push_alert(event)

    mock_alert.assert_called_once_with(
        event["device_id"],
        event["tenant_id"],
        "editor",
    )
