"""DELETE /api/settings/winbox-sessions must terminate the worker sessions it
deletes, not just forget them (Phase 22 criterion 9).

Historically the endpoint deleted every winbox-remote:* Redis key without
telling the worker, so live sessions kept their concurrency slots and their
authenticated router connections while the operator was told "ok, deleted N".
The background reconciliation would eventually sweep them up, but a
synchronous admin "clear everything" must actually clear everything.
"""

import httpx
import pytest

from app.routers import settings as settings_router
from app.services import winbox_remote


class FakeRedis:
    """Just enough of redis.asyncio for the endpoint: scan_iter + delete."""

    def __init__(self, keys):
        self.keys = list(keys)
        self.deleted = []
        self.closed = False

    async def scan_iter(self, match=None, count=None):
        prefix = match.rstrip("*")
        for k in self.keys:
            if k.startswith(prefix):
                yield k

    async def delete(self, *keys):
        self.deleted.extend(keys)
        return len(keys)

    async def aclose(self):
        self.closed = True


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis(
        ["winbox-remote:dev1:sess-a", "winbox-remote:dev2:sess-b", "winbox-remote-rate:user1"]
    )
    monkeypatch.setattr(
        settings_router.aioredis, "from_url", lambda url, decode_responses=True: fake
    )
    return fake


async def test_clear_terminates_worker_sessions_before_deleting_keys(monkeypatch, fake_redis):
    calls = []

    async def fake_list():
        return [{"worker_session_id": "sess-a"}, {"worker_session_id": "sess-b"}]

    async def fake_terminate(session_id):
        calls.append(f"terminate:{session_id}")
        return True

    orig_delete = fake_redis.delete

    async def recording_delete(*keys):
        calls.append("redis-delete")
        return await orig_delete(*keys)

    monkeypatch.setattr(winbox_remote, "list_sessions", fake_list)
    monkeypatch.setattr(winbox_remote, "terminate_session", fake_terminate)
    fake_redis.delete = recording_delete

    resp = await settings_router.clear_winbox_sessions(user=object())

    assert resp["status"] == "ok"
    assert resp["deleted"] == 3
    assert resp["worker_terminated"] == 2
    assert resp["worker_terminate_failed"] == 0
    assert "terminate:sess-a" in calls and "terminate:sess-b" in calls
    # Terminations must come first: if the process dies mid-way, Redis still
    # knows about the sessions and reconciliation can finish the job.
    assert calls.index("redis-delete") > max(
        calls.index("terminate:sess-a"), calls.index("terminate:sess-b")
    )
    assert fake_redis.closed


async def test_clear_still_deletes_keys_when_worker_unreachable(monkeypatch, fake_redis):
    async def fake_list():
        raise httpx.ConnectError("worker down")

    monkeypatch.setattr(winbox_remote, "list_sessions", fake_list)

    resp = await settings_router.clear_winbox_sessions(user=object())

    assert resp["deleted"] == 3
    assert resp["worker_unreachable"] is True
    assert resp["worker_terminated"] == 0


async def test_clear_continues_when_one_terminate_fails(monkeypatch, fake_redis):
    async def fake_list():
        return [{"worker_session_id": s} for s in ("s1", "s2", "s3")]

    async def fake_terminate(session_id):
        if session_id == "s2":
            raise httpx.ReadTimeout("boom")
        return True

    monkeypatch.setattr(winbox_remote, "list_sessions", fake_list)
    monkeypatch.setattr(winbox_remote, "terminate_session", fake_terminate)

    resp = await settings_router.clear_winbox_sessions(user=object())

    assert resp["worker_terminated"] == 2
    assert resp["worker_terminate_failed"] == 1
    assert resp["deleted"] == 3
