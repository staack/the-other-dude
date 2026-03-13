"""Tests for the manual config snapshot trigger endpoint.

Tests POST /api/tenants/{tid}/devices/{did}/config-snapshot/trigger
with mocked NATS connection and database.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import nats.errors


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TENANT_ID = str(uuid4())
DEVICE_ID = str(uuid4())
TRIGGER_URL = f"/api/tenants/{TENANT_ID}/devices/{DEVICE_ID}/config-snapshot/trigger"


def _mock_nats_success(sha256_hash="a" * 64):
    """Return a mock NATS connection that replies with success."""
    nc = AsyncMock()
    reply = MagicMock()
    reply.data = json.dumps({
        "status": "success",
        "sha256_hash": sha256_hash,
        "message": "Config snapshot collected",
    }).encode()
    nc.request = AsyncMock(return_value=reply)
    return nc


def _mock_nats_locked():
    """Return a mock NATS connection that replies with locked status."""
    nc = AsyncMock()
    reply = MagicMock()
    reply.data = json.dumps({
        "status": "locked",
        "message": "backup already in progress",
    }).encode()
    nc.request = AsyncMock(return_value=reply)
    return nc


def _mock_nats_failed():
    """Return a mock NATS connection that replies with failure."""
    nc = AsyncMock()
    reply = MagicMock()
    reply.data = json.dumps({
        "status": "failed",
        "error": "SSH connection refused",
    }).encode()
    nc.request = AsyncMock(return_value=reply)
    return nc


def _mock_nats_timeout():
    """Return a mock NATS connection that raises TimeoutError."""
    nc = AsyncMock()
    nc.request = AsyncMock(side_effect=nats.errors.TimeoutError)
    return nc


def _mock_db_device_exists():
    """Return a mock DB session where the device exists."""
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = MagicMock()  # device exists
    mock_session.execute = AsyncMock(return_value=mock_result)
    return mock_session


def _mock_db_device_missing():
    """Return a mock DB session where the device does not exist."""
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None  # device not found
    mock_session.execute = AsyncMock(return_value=mock_result)
    return mock_session


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_success_returns_201():
    """POST with operator role returns 201 with status and sha256_hash."""
    from app.routers.config_backups import trigger_config_snapshot

    sha256 = "b" * 64
    mock_nc = _mock_nats_success(sha256)
    mock_db = _mock_db_device_exists()
    mock_request = MagicMock()

    mock_user = MagicMock()
    mock_user.is_super_admin = False
    mock_user.tenant_id = TENANT_ID

    with patch("app.routers.config_backups._get_nats", return_value=mock_nc):
        result = await trigger_config_snapshot(
            request=mock_request,
            tenant_id=TENANT_ID,
            device_id=DEVICE_ID,
            current_user=mock_user,
            _role=mock_user,
            db=mock_db,
        )

    assert result["status"] == "success"
    assert result["sha256_hash"] == sha256

    # Verify NATS request was made to correct subject
    mock_nc.request.assert_called_once()
    call_args = mock_nc.request.call_args
    assert call_args[0][0] == "config.backup.trigger"


@pytest.mark.asyncio
async def test_trigger_nats_timeout_returns_504():
    """NATS timeout returns 504 with descriptive message."""
    from app.routers.config_backups import trigger_config_snapshot
    from fastapi import HTTPException

    mock_nc = _mock_nats_timeout()
    mock_db = _mock_db_device_exists()
    mock_request = MagicMock()

    mock_user = MagicMock()
    mock_user.is_super_admin = False
    mock_user.tenant_id = TENANT_ID

    with patch("app.routers.config_backups._get_nats", return_value=mock_nc):
        with pytest.raises(HTTPException) as exc_info:
            await trigger_config_snapshot(
                request=mock_request,
                tenant_id=TENANT_ID,
                device_id=DEVICE_ID,
                current_user=mock_user,
                _role=mock_user,
                db=mock_db,
            )

    assert exc_info.value.status_code == 504


@pytest.mark.asyncio
async def test_trigger_poller_failure_returns_502():
    """Poller failure reply returns 502."""
    from app.routers.config_backups import trigger_config_snapshot
    from fastapi import HTTPException

    mock_nc = _mock_nats_failed()
    mock_db = _mock_db_device_exists()
    mock_request = MagicMock()

    mock_user = MagicMock()
    mock_user.is_super_admin = False
    mock_user.tenant_id = TENANT_ID

    with patch("app.routers.config_backups._get_nats", return_value=mock_nc):
        with pytest.raises(HTTPException) as exc_info:
            await trigger_config_snapshot(
                request=mock_request,
                tenant_id=TENANT_ID,
                device_id=DEVICE_ID,
                current_user=mock_user,
                _role=mock_user,
                db=mock_db,
            )

    assert exc_info.value.status_code == 502


@pytest.mark.asyncio
async def test_trigger_device_not_found_returns_404():
    """Non-existent device returns 404."""
    from app.routers.config_backups import trigger_config_snapshot
    from fastapi import HTTPException

    mock_nc = _mock_nats_success()
    mock_db = _mock_db_device_missing()
    mock_request = MagicMock()

    mock_user = MagicMock()
    mock_user.is_super_admin = False
    mock_user.tenant_id = TENANT_ID

    with patch("app.routers.config_backups._get_nats", return_value=mock_nc):
        with pytest.raises(HTTPException) as exc_info:
            await trigger_config_snapshot(
                request=mock_request,
                tenant_id=TENANT_ID,
                device_id=DEVICE_ID,
                current_user=mock_user,
                _role=mock_user,
                db=mock_db,
            )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_trigger_locked_returns_409():
    """Lock contention returns 409 Conflict."""
    from app.routers.config_backups import trigger_config_snapshot
    from fastapi import HTTPException

    mock_nc = _mock_nats_locked()
    mock_db = _mock_db_device_exists()
    mock_request = MagicMock()

    mock_user = MagicMock()
    mock_user.is_super_admin = False
    mock_user.tenant_id = TENANT_ID

    with patch("app.routers.config_backups._get_nats", return_value=mock_nc):
        with pytest.raises(HTTPException) as exc_info:
            await trigger_config_snapshot(
                request=mock_request,
                tenant_id=TENANT_ID,
                device_id=DEVICE_ID,
                current_user=mock_user,
                _role=mock_user,
                db=mock_db,
            )

    assert exc_info.value.status_code == 409
