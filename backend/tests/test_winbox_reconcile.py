"""Tests for two-directional Remote WinBox session reconciliation.

The property under test is the one that costs money when it is wrong: an orphaned
worker session pins one of ten concurrency slots and an authenticated TCP connection
to a customer router, so it must be reaped — but a session that is merely mid-create
must never be touched, because killing it drops a real user's live WinBox window.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from app.services import winbox_reconcile
from app.services.winbox_reconcile import (
    ORPHAN_MIN_AGE_SECONDS,
    _parse_created_at,
    reconcile_once,
)

PREFIX = "winbox-remote:"


class FakeRedis:
    """Just enough Redis for the sweep: SCAN over a dict, GET, EXISTS, DELETE."""

    def __init__(self, data: dict[str, str] | None = None):
        self.data = dict(data or {})
        self.deleted: list[str] = []

    async def scan(self, cursor="0", match="*", count=100):
        # One shot: every key, then a terminal cursor. The sweep must handle the
        # cursor being either "0" or 0, so return the string form here.
        if str(cursor) != "0":
            return "0", []
        prefix = match.rstrip("*")
        return "0", [k for k in self.data if k.startswith(prefix)]

    async def get(self, key):
        return self.data.get(key)

    async def exists(self, key):
        return 1 if key in self.data else 0

    async def delete(self, key):
        self.deleted.append(key)
        self.data.pop(key, None)


def redis_record(session_id: str, *, status: str = "active", tunnel_id: str = "t-1") -> str:
    return json.dumps(
        {
            "session_id": session_id,
            "status": status,
            "tunnel_id": tunnel_id,
            "device_id": "dev-1",
            "tenant_id": "ten-1",
        }
    )


def worker_session(session_id: str, *, age_seconds: float) -> dict:
    created = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
    return {
        "worker_session_id": session_id,
        "status": "running",
        "display": 100,
        "ws_port": 10100,
        "created_at": created.isoformat().replace("+00:00", "Z"),
    }


@pytest.fixture
def harness(monkeypatch):
    """Wire the sweep to fakes and record every worker call it makes."""
    calls = {"terminated": [], "get": []}
    redis = FakeRedis()
    worker_sessions: list[dict] = []

    async def fake_get_redis():
        return redis

    async def fake_list_sessions():
        return list(worker_sessions)

    async def fake_terminate(session_id):
        calls["terminated"].append(session_id)
        return True

    async def fake_get_session(session_id):
        calls["get"].append(session_id)
        # Pass A is not under test here; claim the worker still has everything so
        # it never deletes a record out from under pass B.
        return {"worker_session_id": session_id}

    async def fake_close_tunnel(tunnel_id):
        return None

    monkeypatch.setattr(winbox_reconcile, "_get_redis", fake_get_redis)
    monkeypatch.setattr(winbox_reconcile, "worker_list_sessions", fake_list_sessions)
    monkeypatch.setattr(winbox_reconcile, "worker_terminate_session", fake_terminate)
    monkeypatch.setattr(winbox_reconcile, "worker_get_session", fake_get_session)
    monkeypatch.setattr(winbox_reconcile, "_close_tunnel", fake_close_tunnel)

    return {
        "redis": redis,
        "worker_sessions": worker_sessions,
        "calls": calls,
    }


async def test_orphan_is_terminated_after_two_passes(harness):
    """A worker session with no Redis record dies on the second sweep, not the first."""
    harness["worker_sessions"].append(worker_session("orphan-1", age_seconds=600))

    state = await reconcile_once({})
    assert harness["calls"]["terminated"] == []
    assert "orphan-1" in state

    await reconcile_once(state)
    assert harness["calls"]["terminated"] == ["orphan-1"]


async def test_single_pass_never_terminates(harness):
    """One strike is not enough — this is the mid-create guard."""
    harness["worker_sessions"].append(worker_session("new-1", age_seconds=600))

    await reconcile_once({})

    assert harness["calls"]["terminated"] == []


async def test_young_session_is_not_terminated(harness):
    """Old enough to be seen twice, too young to be presumed orphaned."""
    sid = "young-1"
    harness["worker_sessions"].append(worker_session(sid, age_seconds=ORPHAN_MIN_AGE_SECONDS - 30))

    state = await reconcile_once({})
    state = await reconcile_once(state)

    assert harness["calls"]["terminated"] == []
    # Still watched, and still carrying its original first-seen time.
    assert sid in state


async def test_session_with_live_redis_key_is_never_touched(harness):
    """The only thing that matters: a session the API knows about is left alone."""
    sid = "live-1"
    harness["worker_sessions"].append(worker_session(sid, age_seconds=9999))
    harness["redis"].data[f"{PREFIX}{sid}"] = redis_record(sid)

    state = await reconcile_once({})
    state = await reconcile_once(state)
    state = await reconcile_once(state)

    assert harness["calls"]["terminated"] == []
    assert state == {}
    assert harness["redis"].deleted == []


async def test_redis_key_appearing_between_passes_cancels_the_strike(harness):
    """The mid-create window: worker first, Redis a moment later."""
    sid = "racing-1"
    harness["worker_sessions"].append(worker_session(sid, age_seconds=9999))

    state = await reconcile_once({})
    assert sid in state

    harness["redis"].data[f"{PREFIX}{sid}"] = redis_record(sid)
    state = await reconcile_once(state)

    assert harness["calls"]["terminated"] == []
    assert state == {}


async def test_failed_terminate_is_retried_on_the_next_pass(harness, monkeypatch):
    """A worker that refuses the DELETE must not buy the orphan a reprieve."""
    harness["worker_sessions"].append(worker_session("stubborn-1", age_seconds=600))
    attempts = []

    async def failing_terminate(session_id):
        attempts.append(session_id)
        raise RuntimeError("worker unreachable")

    monkeypatch.setattr(winbox_reconcile, "worker_terminate_session", failing_terminate)

    state = await reconcile_once({})
    state = await reconcile_once(state)
    assert attempts == ["stubborn-1"]

    await reconcile_once(state)
    assert attempts == ["stubborn-1", "stubborn-1"]


async def test_unparseable_created_at_falls_back_to_observed_age(harness):
    """No usable age from the worker: age out on how long we have watched it instead."""
    item = worker_session("no-age-1", age_seconds=9999)
    item["created_at"] = "not a timestamp"
    harness["worker_sessions"].append(item)

    state = await reconcile_once({})
    # Backdate our own first-seen so the observed window exceeds the floor.
    state["no-age-1"] -= ORPHAN_MIN_AGE_SECONDS + 1

    await reconcile_once(state)

    assert harness["calls"]["terminated"] == ["no-age-1"]


async def test_unparseable_created_at_still_respects_the_floor(harness):
    """Without an age from the worker, two strikes alone must not be enough."""
    item = worker_session("no-age-2", age_seconds=9999)
    item["created_at"] = ""
    harness["worker_sessions"].append(item)

    state = await reconcile_once({})
    await reconcile_once(state)

    assert harness["calls"]["terminated"] == []


async def test_worker_lost_session_still_cleans_redis(harness, monkeypatch):
    """Pass A must keep working: the record goes and the tunnel is closed."""
    closed = []

    async def missing_session(session_id):
        return None

    async def track_close(tunnel_id):
        closed.append(tunnel_id)

    monkeypatch.setattr(winbox_reconcile, "worker_get_session", missing_session)
    monkeypatch.setattr(winbox_reconcile, "_close_tunnel", track_close)
    harness["redis"].data[f"{PREFIX}lost-1"] = redis_record("lost-1", tunnel_id="tun-9")

    await reconcile_once({})

    assert closed == ["tun-9"]
    assert harness["redis"].deleted == [f"{PREFIX}lost-1"]


async def test_terminated_records_are_left_for_ttl(harness, monkeypatch):
    """A non-live record is not a reason to call the worker or delete anything."""

    async def unexpected(session_id):
        raise AssertionError("worker should not be queried for a terminated record")

    monkeypatch.setattr(winbox_reconcile, "worker_get_session", unexpected)
    harness["redis"].data[f"{PREFIX}done-1"] = redis_record("done-1", status="terminated")

    await reconcile_once({})

    assert harness["redis"].deleted == []


@pytest.mark.parametrize(
    "value",
    [
        "2026-08-30T12:00:00Z",
        "2026-08-30T12:00:00.123Z",
        "2026-08-30T12:00:00.123456789Z",  # Go emits up to nine fractional digits
        "2026-08-30T12:00:00+00:00",
        "2026-08-30T14:00:00.5+02:00",
    ],
)
def test_parse_created_at_accepts_go_timestamps(value):
    parsed = _parse_created_at(value)
    assert parsed is not None
    assert parsed.astimezone(timezone.utc).hour == 12


@pytest.mark.parametrize("value", ["", None, "yesterday", 12345, "2026-13-45T99:99:99Z"])
def test_parse_created_at_rejects_junk(value):
    assert _parse_created_at(value) is None
