"""Tests for config snapshot NATS subscriber.

Tests the handle_config_snapshot handler function directly with mocked
NATS message, mocked AdminAsyncSessionLocal, and mocked OpenBaoService.
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
async def test_new_snapshot_encrypted_and_stored():
    """Test 1: New snapshot (no prior hash) is encrypted and stored."""
    from app.services.config_snapshot_subscriber import handle_config_snapshot

    payload = _valid_payload()
    msg = _make_msg(payload)

    mock_session = AsyncMock()
    # Dedup query returns no prior hash (first snapshot for device)
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_openbao = AsyncMock()
    mock_openbao.encrypt.return_value = "vault:v1:encrypted_data"

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
        return_value=mock_ctx,
    ), patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        await handle_config_snapshot(msg)

    # Should encrypt config_text
    mock_openbao.encrypt.assert_called_once_with(
        payload["tenant_id"],
        payload["config_text"].encode("utf-8"),
    )
    # Should INSERT (two execute calls: SELECT for dedup + INSERT)
    assert mock_session.execute.call_count == 2
    # Should commit
    mock_session.commit.assert_called_once()
    # Should ack
    msg.ack.assert_called_once()
    msg.nak.assert_not_called()


@pytest.mark.asyncio
async def test_duplicate_snapshot_skipped():
    """Test 2: Duplicate snapshot (hash matches latest) is skipped."""
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

    mock_openbao = AsyncMock()

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
        return_value=mock_ctx,
    ), patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        await handle_config_snapshot(msg)

    # Should NOT encrypt (duplicate)
    mock_openbao.encrypt.assert_not_called()
    # Should NOT insert (only the SELECT for dedup)
    assert mock_session.execute.call_count == 1
    mock_session.commit.assert_not_called()
    # Should ack (duplicate is normal, not an error)
    msg.ack.assert_called_once()
    msg.nak.assert_not_called()


@pytest.mark.asyncio
async def test_transit_encrypt_failure_causes_nak():
    """Test 3: Transit encrypt failure causes nak — plaintext never stored."""
    from app.services.config_snapshot_subscriber import handle_config_snapshot

    payload = _valid_payload()
    msg = _make_msg(payload)

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(return_value=mock_result)

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_openbao = AsyncMock()
    mock_openbao.encrypt.side_effect = Exception("Transit unavailable")

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
        return_value=mock_ctx,
    ), patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        await handle_config_snapshot(msg)

    # Should NOT commit (no INSERT)
    mock_session.commit.assert_not_called()
    # Should nak for NATS retry
    msg.nak.assert_called_once()
    msg.ack.assert_not_called()


@pytest.mark.asyncio
async def test_malformed_message_acked_and_discarded():
    """Test 4: Malformed message (missing required fields) is acked and discarded."""
    from app.services.config_snapshot_subscriber import handle_config_snapshot

    # Missing device_id and tenant_id
    payload = {"config_text": "some config", "sha256_hash": "a" * 64}
    msg = _make_msg(payload)

    mock_openbao = AsyncMock()

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
    ) as mock_session_cls, patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        await handle_config_snapshot(msg)

    # Should ack (discard malformed)
    msg.ack.assert_called_once()
    msg.nak.assert_not_called()
    # Should NOT attempt any DB or encrypt operations
    mock_openbao.encrypt.assert_not_called()


@pytest.mark.asyncio
async def test_orphan_device_acked_and_discarded():
    """Test 5: Orphan device_id (FK violation) is acked and discarded with warning."""
    from app.services.config_snapshot_subscriber import handle_config_snapshot
    from sqlalchemy.exc import IntegrityError

    payload = _valid_payload()
    msg = _make_msg(payload)

    mock_session = AsyncMock()
    # Dedup query returns no prior hash
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    # First execute (SELECT) succeeds, second (INSERT) raises IntegrityError
    mock_session.execute = AsyncMock(
        side_effect=[mock_result, IntegrityError("", {}, Exception("FK violation"))]
    )
    mock_session.rollback = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_openbao = AsyncMock()
    mock_openbao.encrypt.return_value = "vault:v1:encrypted_data"

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
        return_value=mock_ctx,
    ), patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        await handle_config_snapshot(msg)

    # Should ack (orphan device, discard)
    msg.ack.assert_called_once()
    msg.nak.assert_not_called()


@pytest.mark.asyncio
async def test_first_snapshot_for_device_always_stored():
    """Test 6: First snapshot for device (SELECT returns no rows) is always stored."""
    from app.services.config_snapshot_subscriber import handle_config_snapshot

    payload = _valid_payload()
    msg = _make_msg(payload)

    mock_session = AsyncMock()
    # Dedup query returns None (no prior snapshots)
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_openbao = AsyncMock()
    mock_openbao.encrypt.return_value = "vault:v1:first_snapshot_encrypted"

    with patch(
        "app.services.config_snapshot_subscriber.AdminAsyncSessionLocal",
        return_value=mock_ctx,
    ), patch(
        "app.services.config_snapshot_subscriber.OpenBaoTransitService",
        return_value=mock_openbao,
    ):
        await handle_config_snapshot(msg)

    # Should encrypt
    mock_openbao.encrypt.assert_called_once()
    # Should execute SELECT + INSERT
    assert mock_session.execute.call_count == 2
    # Should commit
    mock_session.commit.assert_called_once()
    # Should ack
    msg.ack.assert_called_once()
