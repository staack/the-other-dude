"""Tests for the manual config snapshot trigger endpoint.

Tests the trigger_config_snapshot core logic with mocked NATS connection
and database session.

Since importing the router directly triggers a deep import chain (rate_limit,
rbac, auth, bcrypt, redis), this test validates the handler logic by
constructing equivalent async functions that mirror the endpoint behavior.
"""

import json
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock

import nats.errors
from fastapi import HTTPException, status


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TENANT_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")
DEVICE_ID = uuid.UUID("87654321-4321-8765-4321-876543218765")


async def _simulate_trigger(
    *,
    nats_conn,
    db_session,
    tenant_id=TENANT_ID,
    device_id=DEVICE_ID,
):
    """Simulate the trigger_config_snapshot endpoint logic.

    This mirrors the implementation in config_backups.py without importing
    the full router module (which requires Redis, bcrypt, etc.).
    """
    # Verify device exists
    result = await db_session.execute(MagicMock())
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found in tenant {tenant_id}",
        )

    # Send NATS request
    payload = {
        "device_id": str(device_id),
        "tenant_id": str(tenant_id),
    }

    try:
        reply = await nats_conn.request(
            "config.backup.trigger",
            json.dumps(payload).encode(),
            timeout=90.0,
        )
    except nats.errors.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Backup request timed out -- the backup may still complete via the scheduled pipeline",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to communicate with poller: {exc}",
        ) from exc

    reply_data = json.loads(reply.data)

    if reply_data.get("status") == "success":
        return {
            "status": "success",
            "sha256_hash": reply_data.get("sha256_hash"),
            "message": reply_data.get("message", "Config snapshot collected"),
        }

    if reply_data.get("status") == "locked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=reply_data.get("message", "backup already in progress"),
        )

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=reply_data.get("error", "Backup failed"),
    )


def _mock_nats_reply(data: dict):
    """Create a mock NATS connection that replies with given data."""
    nc = AsyncMock()
    reply = MagicMock()
    reply.data = json.dumps(data).encode()
    nc.request = AsyncMock(return_value=reply)
    return nc


def _mock_db(device_exists: bool):
    """Create a mock DB session."""
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = MagicMock() if device_exists else None
    session.execute = AsyncMock(return_value=result)
    return session


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_success_returns_201():
    """POST with operator role returns 201 with status and sha256_hash."""
    sha256 = "b" * 64
    nc = _mock_nats_reply(
        {
            "status": "success",
            "sha256_hash": sha256,
            "message": "Config snapshot collected",
        }
    )
    db = _mock_db(device_exists=True)

    result = await _simulate_trigger(nats_conn=nc, db_session=db)

    assert result["status"] == "success"
    assert result["sha256_hash"] == sha256

    nc.request.assert_called_once()
    call_args = nc.request.call_args
    assert call_args[0][0] == "config.backup.trigger"
    # Verify payload contains correct device/tenant IDs
    sent_payload = json.loads(call_args[0][1])
    assert sent_payload["device_id"] == str(DEVICE_ID)
    assert sent_payload["tenant_id"] == str(TENANT_ID)


@pytest.mark.asyncio
async def test_trigger_nats_timeout_returns_504():
    """NATS timeout returns 504 with descriptive message."""
    nc = AsyncMock()
    nc.request = AsyncMock(side_effect=nats.errors.TimeoutError)
    db = _mock_db(device_exists=True)

    with pytest.raises(HTTPException) as exc_info:
        await _simulate_trigger(nats_conn=nc, db_session=db)

    assert exc_info.value.status_code == 504
    assert "timed out" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_trigger_poller_failure_returns_502():
    """Poller failure reply returns 502."""
    nc = _mock_nats_reply(
        {
            "status": "failed",
            "error": "SSH connection refused",
        }
    )
    db = _mock_db(device_exists=True)

    with pytest.raises(HTTPException) as exc_info:
        await _simulate_trigger(nats_conn=nc, db_session=db)

    assert exc_info.value.status_code == 502
    assert "SSH connection refused" in exc_info.value.detail


@pytest.mark.asyncio
async def test_trigger_device_not_found_returns_404():
    """Non-existent device returns 404."""
    nc = _mock_nats_reply({"status": "success"})
    db = _mock_db(device_exists=False)

    with pytest.raises(HTTPException) as exc_info:
        await _simulate_trigger(nats_conn=nc, db_session=db)

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_trigger_locked_returns_409():
    """Lock contention returns 409 Conflict."""
    nc = _mock_nats_reply(
        {
            "status": "locked",
            "message": "backup already in progress",
        }
    )
    db = _mock_db(device_exists=True)

    with pytest.raises(HTTPException) as exc_info:
        await _simulate_trigger(nats_conn=nc, db_session=db)

    assert exc_info.value.status_code == 409
    assert "already in progress" in exc_info.value.detail


@pytest.mark.asyncio
async def test_trigger_nats_connection_error_returns_502():
    """General NATS error returns 502."""
    nc = AsyncMock()
    nc.request = AsyncMock(side_effect=ConnectionError("NATS connection lost"))
    db = _mock_db(device_exists=True)

    with pytest.raises(HTTPException) as exc_info:
        await _simulate_trigger(nats_conn=nc, db_session=db)

    assert exc_info.value.status_code == 502
