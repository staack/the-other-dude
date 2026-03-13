"""Tests for audit event emission from config backup operations.

Verifies that log_action is called with the correct action strings
during snapshot creation, deduplication, diff generation, and manual
backup trigger.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


def _make_msg(payload: dict) -> MagicMock:
    """Build a mock NATS message with .data, .ack(), .nak() methods."""
    msg = MagicMock()
    msg.data = json.dumps(payload).encode("utf-8")
    msg.ack = AsyncMock()
    msg.nak = AsyncMock()
    return msg


def _valid_payload(**overrides) -> dict:
    """Return a valid config snapshot payload with optional overrides."""
    base = {
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "routeros_version": "7.16.2",
        "collected_at": "2026-03-13T02:00:00Z",
        "sha256_hash": "a" * 64,
        "config_text": "/ip address print\n# router config",
        "normalization_version": 1,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_snapshot_created_audit_event():
    """handle_config_snapshot calls log_action with action='config_snapshot_created' on new snapshot."""
    from app.services.config_snapshot_subscriber import handle_config_snapshot

    payload = _valid_payload()
    msg = _make_msg(payload)

    mock_session = AsyncMock()
    # Dedup query returns no prior hash
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    # INSERT RETURNING id
    insert_result = MagicMock()
    insert_result.scalar_one.return_value = str(uuid4())
    mock_session.execute = AsyncMock(side_effect=[mock_result, insert_result])
    mock_session.commit = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_openbao = AsyncMock()
    mock_openbao.encrypt.return_value = "vault:v1:encrypted_data"

    mock_log_action = AsyncMock()

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
        return_value=mock_ctx,
    ), patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=mock_openbao,
    ), patch(
        "app.services.config_snapshot_subscriber.generate_and_store_diff",
        new_callable=AsyncMock,
    ), patch(
        "app.services.config_snapshot_subscriber.log_action",
        mock_log_action,
    ):
        await handle_config_snapshot(msg)

    # log_action should have been called with config_snapshot_created
    actions = [call.kwargs.get("action", call.args[4] if len(call.args) > 4 else None)
               for call in mock_log_action.call_args_list]
    assert "config_snapshot_created" in actions


@pytest.mark.asyncio
async def test_snapshot_skipped_duplicate_audit_event():
    """handle_config_snapshot calls log_action with action='config_snapshot_skipped_duplicate' on dedup."""
    from app.services.config_snapshot_subscriber import handle_config_snapshot

    payload = _valid_payload(sha256_hash="b" * 64)
    msg = _make_msg(payload)

    mock_session = AsyncMock()
    # Dedup query returns matching hash
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = "b" * 64
    mock_session.execute = AsyncMock(return_value=mock_result)

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_log_action = AsyncMock()

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
        return_value=mock_ctx,
    ), patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=AsyncMock(),
    ), patch(
        "app.services.config_snapshot_subscriber.log_action",
        mock_log_action,
    ):
        await handle_config_snapshot(msg)

    # log_action should have been called with config_snapshot_skipped_duplicate
    actions = [call.kwargs.get("action", call.args[4] if len(call.args) > 4 else None)
               for call in mock_log_action.call_args_list]
    assert "config_snapshot_skipped_duplicate" in actions


@pytest.mark.asyncio
async def test_diff_generated_audit_event():
    """generate_and_store_diff calls log_action with action='config_diff_generated' after diff stored."""
    from app.services.config_diff_service import generate_and_store_diff

    device_id = str(uuid4())
    tenant_id = str(uuid4())
    new_snapshot_id = str(uuid4())
    old_snapshot_id = str(uuid4())
    diff_id = str(uuid4())

    old_config = "line1\nline2\nline3"
    new_config = "line1\nline2_modified\nline3"

    mock_session = AsyncMock()

    prev_result = MagicMock()
    prev_result.fetchone.return_value = MagicMock(
        _mapping={"id": old_snapshot_id, "config_text": "vault:v1:old_encrypted"}
    )
    new_result = MagicMock()
    new_result.scalar_one.return_value = "vault:v1:new_encrypted"
    insert_result = MagicMock()
    insert_result.scalar_one.return_value = diff_id

    mock_session.execute = AsyncMock(side_effect=[prev_result, new_result, insert_result])
    mock_session.commit = AsyncMock()

    mock_openbao = AsyncMock()
    mock_openbao.decrypt = AsyncMock(side_effect=[
        old_config.encode("utf-8"),
        new_config.encode("utf-8"),
    ])

    mock_log_action = AsyncMock()

    with patch(
        "app.services.config_diff_service.OpenBaoTransitService",
        return_value=mock_openbao,
    ), patch(
        "app.services.config_diff_service.parse_diff_changes",
        return_value=[],
    ), patch(
        "app.services.audit_service.log_action",
        mock_log_action,
    ):
        await generate_and_store_diff(device_id, tenant_id, new_snapshot_id, mock_session)

    # log_action should have been called with config_diff_generated
    mock_log_action.assert_called_once()
    call_kwargs = mock_log_action.call_args
    # Check action argument (positional or keyword)
    assert call_kwargs.kwargs.get("action") == "config_diff_generated"


@pytest.mark.asyncio
async def test_manual_trigger_audit_event():
    """trigger_config_snapshot calls log_action with action='config_backup_manual_trigger' on success."""
    import app.routers.config_backups as cb_module
    from app.middleware.rate_limit import limiter

    mock_db = AsyncMock()
    mock_device = MagicMock()
    mock_device.id = uuid4()

    # Device exists query
    device_result = MagicMock()
    device_result.scalar_one_or_none.return_value = mock_device
    mock_db.execute = AsyncMock(return_value=device_result)

    mock_current_user = MagicMock()
    mock_current_user.user_id = uuid4()
    mock_current_user.tenant_id = uuid4()
    mock_current_user.is_super_admin = False

    mock_request = MagicMock()
    mock_request.client = MagicMock()
    mock_request.client.host = "127.0.0.1"

    tenant_id = mock_current_user.tenant_id
    device_id = mock_device.id

    # Mock NATS reply
    reply_data = {"status": "success", "sha256_hash": "c" * 64, "message": "collected"}
    mock_reply = MagicMock()
    mock_reply.data = json.dumps(reply_data).encode()

    mock_nc = AsyncMock()
    mock_nc.request = AsyncMock(return_value=mock_reply)

    mock_log_action = AsyncMock()

    # Disable rate limiter for this test
    original_enabled = limiter.enabled
    limiter.enabled = False
    try:
        with patch.object(
            cb_module, "_get_nats", return_value=mock_nc,
        ), patch.object(
            cb_module, "_check_tenant_access", new_callable=AsyncMock,
        ), patch(
            "app.services.audit_service.log_action",
            mock_log_action,
        ):
            result = await cb_module.trigger_config_snapshot(
                request=mock_request,
                tenant_id=tenant_id,
                device_id=device_id,
                current_user=mock_current_user,
                _role=mock_current_user,
                db=mock_db,
            )
    finally:
        limiter.enabled = original_enabled

    assert result["status"] == "success"
    mock_log_action.assert_called_once()
    call_kwargs = mock_log_action.call_args
    assert call_kwargs.args[3] == "config_backup_manual_trigger"
