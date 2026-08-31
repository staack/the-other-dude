"""A committed template push must be recorded so the poller can auto-rollback.

The offline-after-push safety net (poller/internal/poller/worker.go:186) only fires
if a `push:recent:` key exists in Redis. Only restore_service wrote one, so template
rollouts — the highest-volume push path — had no rollback and no alert.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.config import settings
from app.services.template_service import _run_single_push


class _ConnectResult:
    """asyncssh.connect() is both awaitable and an async context manager."""

    def __init__(self, conn):
        self._conn = conn

    def __await__(self):
        async def _c():
            return self._conn

        return _c().__await__()

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *_):
        return False


def _async_cm(value):
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=value)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_committed_template_push_is_recorded_for_rollback():
    job_id = str(uuid4())
    device_id = uuid4()
    tenant_id = uuid4()
    backup_sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

    row = (
        uuid4(),  # job id
        device_id,
        tenant_id,
        "/system identity set name=test",  # rendered_content
        "192.0.2.10",  # ip_address
        "test-router",  # hostname
        b"legacy-blob",  # encrypted_credentials
        None,  # encrypted_credentials_transit
    )
    result = MagicMock()
    result.fetchone.return_value = row
    session = AsyncMock()
    session.execute = AsyncMock(return_value=result)

    conn = MagicMock()
    conn.run = AsyncMock()
    sftp_file = MagicMock()
    sftp_file.write = AsyncMock()
    sftp = MagicMock()
    sftp.open = MagicMock(return_value=_async_cm(sftp_file))
    conn.start_sftp_client = MagicMock(return_value=_async_cm(sftp))

    safe_session = MagicMock()
    safe_session.import_rsc = AsyncMock(return_value="config imported")
    safe_session.commit = AsyncMock()

    with (
        patch(
            "app.services.template_service.AdminAsyncSessionLocal",
            return_value=_async_cm(session),
        ),
        patch("app.services.template_service._update_job", new_callable=AsyncMock),
        patch(
            "app.services.crypto.decrypt_credentials_hybrid",
            new_callable=AsyncMock,
            return_value='{"username": "admin", "password": "pw"}',
        ),
        patch.object(type(settings), "get_encryption_key_bytes", return_value=b"0" * 32),
        patch(
            "app.services.backup_service.run_backup",
            new_callable=AsyncMock,
            return_value={"commit_sha": backup_sha},
        ),
        patch(
            "app.services.template_service.asyncssh.connect",
            MagicMock(return_value=_ConnectResult(conn)),
        ),
        patch(
            "app.services.template_service.SafeModeSession",
            MagicMock(return_value=_async_cm(safe_session)),
        ),
        patch("app.services.template_service.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.services.template_service._check_reachability",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch("app.services.push_tracker.record_push", new_callable=AsyncMock) as mock_record_push,
    ):
        await _run_single_push(job_id)

    safe_session.commit.assert_awaited_once()
    mock_record_push.assert_awaited_once()
    kwargs = mock_record_push.await_args.kwargs
    assert kwargs["push_type"] == "template"
    assert kwargs["device_id"] == str(device_id)
    assert kwargs["tenant_id"] == str(tenant_id)
    assert kwargs["pre_push_commit_sha"] == backup_sha
