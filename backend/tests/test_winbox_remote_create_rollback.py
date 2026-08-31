"""Tests for rollback when creating a Remote WinBox session fails.

The block was already commented "Full rollback" but closed the tunnel and dropped
the Redis key without ever telling the worker. Anything that failed after the
worker had launched — the Redis write above all — left a live session holding a
display, a WS port, one of ten concurrency slots and an authenticated connection
to a customer's router, with no record of it anywhere.

Ordering is load-bearing: the worker session must die before the tunnel closes,
because the poller only reaps a tunnel once ActiveConns() reaches zero.
"""

import uuid

import httpx
import pytest
from fastapi import HTTPException

from app.routers import winbox_remote
from app.schemas.winbox_remote import RemoteWinboxCreateRequest
from app.services.winbox_remote import WorkerCapacityError, WorkerLaunchError

TENANT = uuid.uuid4()
DEVICE = uuid.uuid4()
USER = uuid.uuid4()

# The route is wrapped by the slowapi rate-limit decorator, which needs live app
# state. __wrapped__ is the handler itself.
create_session_handler = winbox_remote.create_winbox_remote_session.__wrapped__


class FakeRedis:
    """Empty keyspace: no duplicate sessions, rate limit always under the cap."""

    def __init__(self):
        self.data: dict[str, str] = {}

    async def scan(self, cursor="0", match="*", count=100):
        return "0", []

    async def get(self, key):
        return self.data.get(key)

    async def incr(self, key):
        return 1

    async def expire(self, key, ttl):
        return True

    async def setex(self, key, ttl, value):
        self.data[key] = value

    async def delete(self, key):
        self.data.pop(key, None)


class FakeUser:
    def __init__(self):
        self.user_id = USER
        self.tenant_id = TENANT
        self.is_super_admin = False


class FakeDevice:
    encrypted_credentials_transit = b"transit"
    encrypted_credentials = b"legacy"


@pytest.fixture
def harness(monkeypatch):
    """Drive the create path to the worker call, recording every rollback action."""
    calls: list[tuple[str, str]] = []
    redis = FakeRedis()

    async def fake_check_tenant_access(current_user, tenant_id, db):
        return None

    async def fake_get_device(db, tenant_id, device_id):
        return FakeDevice()

    async def fake_get_redis():
        return redis

    async def fake_decrypt(**kwargs):
        return '{"username": "admin", "password": "hunter2"}'

    async def fake_open_tunnel(device_id, tenant_id, user_id):
        return {"tunnel_id": "tun-1", "local_port": 49001}

    async def fake_close_tunnel(tunnel_id):
        calls.append(("close_tunnel", tunnel_id))

    async def fake_terminate(session_id):
        calls.append(("terminate", session_id))
        return True

    async def fake_log_action(*args, **kwargs):
        return None

    monkeypatch.setattr(winbox_remote, "_check_tenant_access", fake_check_tenant_access)
    monkeypatch.setattr(winbox_remote, "_get_device", fake_get_device)
    monkeypatch.setattr(winbox_remote, "_get_redis", fake_get_redis)
    monkeypatch.setattr(winbox_remote, "_open_tunnel", fake_open_tunnel)
    monkeypatch.setattr(winbox_remote, "_close_tunnel", fake_close_tunnel)
    monkeypatch.setattr(winbox_remote, "worker_terminate_session", fake_terminate)
    monkeypatch.setattr(winbox_remote, "log_action", fake_log_action)
    monkeypatch.setattr("app.services.crypto.decrypt_credentials_hybrid", fake_decrypt)

    return {"calls": calls, "redis": redis, "monkeypatch": monkeypatch}


async def run_create():
    """Invoke the handler with the request plumbing it actually reads."""

    class FakeRequest:
        headers = {"x-real-ip": "10.0.0.1"}
        client = None

    return await create_session_handler(
        tenant_id=TENANT,
        device_id=DEVICE,
        request=FakeRequest(),
        body=RemoteWinboxCreateRequest(),
        current_user=FakeUser(),
        db=object(),
    )


def worker_ok(session_id_box):
    """A worker create that succeeds and records the id it was given."""

    async def _create(session_id, **kwargs):
        session_id_box.append(session_id)
        return {
            "worker_session_id": session_id,
            "xpra_ws_port": 10100,
            "expires_at": "2026-08-30T12:10:00Z",
            "max_expires_at": "2026-08-30T14:00:00Z",
        }

    return _create


async def test_redis_write_failure_terminates_the_worker_session(harness):
    """The core leak: the worker launched, the record never landed."""
    launched: list[str] = []
    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", worker_ok(launched))

    async def failing_save(session_id, data, ttl=14400):
        raise RuntimeError("redis down")

    harness["monkeypatch"].setattr(winbox_remote, "_save_session_to_redis", failing_save)

    with pytest.raises(HTTPException) as exc_info:
        await run_create()

    assert exc_info.value.status_code == 503
    assert ("terminate", launched[0]) in harness["calls"]


async def test_worker_session_is_terminated_before_the_tunnel_closes(harness):
    """The poller only reaps a tunnel once ActiveConns() hits zero."""
    launched: list[str] = []
    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", worker_ok(launched))

    async def failing_save(session_id, data, ttl=14400):
        raise RuntimeError("redis down")

    harness["monkeypatch"].setattr(winbox_remote, "_save_session_to_redis", failing_save)

    with pytest.raises(HTTPException):
        await run_create()

    kinds = [kind for kind, _ in harness["calls"]]
    assert kinds.index("terminate") < kinds.index("close_tunnel")


async def test_timeout_is_treated_as_maybe_launched(harness):
    """We never got a response, but the worker may have finished the launch."""
    seen: list[str] = []

    async def timing_out(session_id, **kwargs):
        seen.append(session_id)
        raise httpx.ReadTimeout("worker took too long")

    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", timing_out)

    with pytest.raises(HTTPException) as exc_info:
        await run_create()

    assert exc_info.value.status_code == 503
    assert ("terminate", seen[0]) in harness["calls"]


async def test_dropped_connection_is_also_ambiguous(harness):
    """A protocol error mid-response is ambiguous in exactly the same way."""
    seen: list[str] = []

    async def dropped(session_id, **kwargs):
        seen.append(session_id)
        raise httpx.RemoteProtocolError("server disconnected")

    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", dropped)

    with pytest.raises(HTTPException):
        await run_create()

    assert ("terminate", seen[0]) in harness["calls"]


async def test_capacity_refusal_does_not_call_terminate(harness):
    """The worker said no before launching — there is nothing to clean up."""

    async def no_capacity(session_id, **kwargs):
        raise WorkerCapacityError("capacity")

    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", no_capacity)

    with pytest.raises(HTTPException) as exc_info:
        await run_create()

    assert exc_info.value.status_code == 503
    assert [kind for kind, _ in harness["calls"]] == ["close_tunnel"]


async def test_launch_error_terminates_defensively(harness):
    """The worker attempted a launch; do not trust it to have cleaned up."""
    seen: list[str] = []

    async def launch_failed(session_id, **kwargs):
        seen.append(session_id)
        raise WorkerLaunchError("Worker returned 500")

    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", launch_failed)

    with pytest.raises(HTTPException):
        await run_create()

    kinds = [kind for kind, _ in harness["calls"]]
    assert kinds == ["terminate", "close_tunnel"]


async def test_failed_terminate_does_not_mask_the_original_error(harness):
    """A rollback that throws would hide why the create failed."""
    launched: list[str] = []
    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", worker_ok(launched))

    async def failing_save(session_id, data, ttl=14400):
        raise RuntimeError("redis down")

    async def failing_terminate(session_id):
        raise httpx.ConnectError("worker unreachable")

    harness["monkeypatch"].setattr(winbox_remote, "_save_session_to_redis", failing_save)
    harness["monkeypatch"].setattr(winbox_remote, "worker_terminate_session", failing_terminate)

    with pytest.raises(HTTPException) as exc_info:
        await run_create()

    # The caller still gets the create failure, not the terminate failure.
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Session creation failed"
    # And the tunnel was still closed despite the terminate blowing up.
    assert ("close_tunnel", "tun-1") in harness["calls"]


async def test_successful_create_never_terminates(harness):
    """The obvious regression guard: do not roll back a session that worked."""
    launched: list[str] = []
    harness["monkeypatch"].setattr(winbox_remote, "worker_create_session", worker_ok(launched))

    resp = await run_create()

    assert str(resp.session_id) == launched[0]
    assert harness["calls"] == []
    assert harness["redis"].data  # the record was written


async def test_rollback_helper_never_raises(monkeypatch):
    """_rollback_worker_session is called mid-exception; it must not add one."""

    async def boom(session_id):
        raise RuntimeError("worker on fire")

    monkeypatch.setattr(winbox_remote, "worker_terminate_session", boom)

    await winbox_remote._rollback_worker_session("some-session")
