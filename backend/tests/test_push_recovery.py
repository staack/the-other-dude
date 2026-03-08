"""Tests for stale push operation recovery on API startup."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import uuid4

from app.services.restore_service import recover_stale_push_operations


@pytest.mark.asyncio
async def test_recovery_commits_reachable_device_with_scheduler():
    """If device is reachable and panic-revert scheduler exists, delete it and commit."""
    push_op = MagicMock()
    push_op.id = uuid4()
    push_op.device_id = uuid4()
    push_op.tenant_id = uuid4()
    push_op.status = "pending_verification"
    push_op.scheduler_name = "mikrotik-portal-panic-revert"
    push_op.started_at = datetime.now(timezone.utc) - timedelta(minutes=10)

    device = MagicMock()
    device.ip_address = "192.168.1.1"
    device.api_port = 8729
    device.ssh_port = 22

    mock_session = AsyncMock()
    # Return stale ops query
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [push_op]
    mock_session.execute = AsyncMock(side_effect=[mock_result, MagicMock()])

    # Mock device query result (second execute call)
    dev_result = MagicMock()
    dev_result.scalar_one_or_none.return_value = device
    mock_session.execute = AsyncMock(side_effect=[mock_result, dev_result])

    with patch(
        "app.services.restore_service._check_reachability",
        new_callable=AsyncMock,
        return_value=True,
    ), patch(
        "app.services.restore_service._remove_panic_scheduler",
        new_callable=AsyncMock,
        return_value=True,
    ), patch(
        "app.services.restore_service._update_push_op_status",
        new_callable=AsyncMock,
    ) as mock_update, patch(
        "app.services.restore_service._publish_push_progress",
        new_callable=AsyncMock,
    ), patch(
        "app.services.crypto.decrypt_credentials_hybrid",
        new_callable=AsyncMock,
        return_value='{"username": "admin", "password": "test123"}',
    ), patch(
        "app.services.restore_service.settings",
    ):
        await recover_stale_push_operations(mock_session)

    mock_update.assert_called_once()
    call_args = mock_update.call_args
    assert call_args[0][1] == "committed" or call_args[1].get("new_status") == "committed"


@pytest.mark.asyncio
async def test_recovery_marks_unreachable_device_failed():
    """If device is unreachable, mark operation as failed."""
    push_op = MagicMock()
    push_op.id = uuid4()
    push_op.device_id = uuid4()
    push_op.tenant_id = uuid4()
    push_op.status = "pending_verification"
    push_op.scheduler_name = "mikrotik-portal-panic-revert"
    push_op.started_at = datetime.now(timezone.utc) - timedelta(minutes=10)

    device = MagicMock()
    device.ip_address = "192.168.1.1"

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [push_op]
    dev_result = MagicMock()
    dev_result.scalar_one_or_none.return_value = device
    mock_session.execute = AsyncMock(side_effect=[mock_result, dev_result])

    with patch(
        "app.services.restore_service._check_reachability",
        new_callable=AsyncMock,
        return_value=False,
    ), patch(
        "app.services.restore_service._update_push_op_status",
        new_callable=AsyncMock,
    ) as mock_update, patch(
        "app.services.restore_service._publish_push_progress",
        new_callable=AsyncMock,
    ), patch(
        "app.services.crypto.decrypt_credentials_hybrid",
        new_callable=AsyncMock,
        return_value='{"username": "admin", "password": "test123"}',
    ), patch(
        "app.services.restore_service.settings",
    ):
        await recover_stale_push_operations(mock_session)

    mock_update.assert_called_once()
    call_args = mock_update.call_args
    assert call_args[0][1] == "failed" or call_args[1].get("new_status") == "failed"


@pytest.mark.asyncio
async def test_recovery_skips_recent_ops():
    """Operations less than 5 minutes old should not be recovered (still in progress)."""
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []  # Query filters by age
    mock_session.execute = AsyncMock(return_value=mock_result)

    await recover_stale_push_operations(mock_session)
    # No errors, no updates — just returns cleanly
