"""SSE streams must release their NATS connection when the client goes away.

GitHub issue #18: every browser reconnect leaked one NATS connection because
the stream's cleanup ran inside a cancelled anyio scope and never reached
``close()``.  Two gunicorn workers hit the 1024 descriptor limit in a day.

These tests use a fake NATS client so no broker is needed.  The ASGI test
drives the real router endpoint and the real ``EventSourceResponse``.
"""

import asyncio
import uuid
from unittest.mock import AsyncMock

import nats.errors
import pytest
from starlette.requests import Request

from app.routers import sse as sse_router
from app.services import sse_manager
from app.services.sse_manager import SSEConnectionManager


class FakeSubscription:
    def __init__(self) -> None:
        self.unsubscribed = False

    async def next_msg(self, timeout: float):
        await asyncio.sleep(timeout)
        raise nats.errors.TimeoutError

    async def unsubscribe(self) -> None:
        await asyncio.sleep(0)
        self.unsubscribed = True


class FakeJetStream:
    def __init__(self) -> None:
        self.subscriptions: list[FakeSubscription] = []

    async def subscribe(self, subject, stream=None, ordered_consumer=False):
        sub = FakeSubscription()
        self.subscriptions.append(sub)
        return sub


class FakeNATS:
    """Mimics the parts of nats.aio.client.Client the SSE manager touches.

    Every coroutine yields to the loop at least once so a cancelled caller
    behaves the way it does against the real socket-backed client.
    """

    def __init__(self, jetstream_error: Exception | None = None) -> None:
        self.closed = False
        self.connected = True
        self.close_calls = 0
        self.js = FakeJetStream()
        self._jetstream_error = jetstream_error

    @property
    def is_connected(self) -> bool:
        return self.connected and not self.closed

    @property
    def is_closed(self) -> bool:
        return self.closed

    def jetstream(self):
        if self._jetstream_error is not None:
            raise self._jetstream_error
        return self.js

    async def close(self) -> None:
        self.close_calls += 1
        await asyncio.sleep(0)
        self.closed = True

    async def drain(self) -> None:
        await asyncio.sleep(0)
        await self.close()


def _install_fake_nats(monkeypatch, fake: FakeNATS) -> None:
    async def fake_connect(*args, **kwargs):
        return fake

    monkeypatch.setattr(sse_manager.nats, "connect", fake_connect)


def _manager_pending_tasks() -> list[asyncio.Task]:
    """Tasks owned by SSEConnectionManager that are still running."""
    return [
        t
        for t in asyncio.all_tasks()
        if not t.done() and "SSEConnectionManager" in t.get_coro().__qualname__
    ]


@pytest.mark.asyncio
async def test_client_disconnect_closes_nats_connection(monkeypatch):
    """Dropping the HTTP connection must close the stream's NATS connection."""
    fake = FakeNATS()
    _install_fake_nats(monkeypatch, fake)
    tenant_id = uuid.uuid4()
    monkeypatch.setattr(
        sse_router,
        "_validate_sse_token",
        AsyncMock(return_value={"role": "admin", "tenant_id": str(tenant_id), "user_id": "u"}),
    )
    scope = {
        "type": "http",
        "method": "GET",
        "path": f"/api/tenants/{tenant_id}/events/stream",
        "headers": [],
        "query_string": b"",
    }
    response = await sse_router.event_stream(Request(scope), tenant_id, token="t")

    messages = [{"type": "http.request"}]

    async def receive():
        if messages:
            return messages.pop()
        await asyncio.sleep(0.2)
        return {"type": "http.disconnect"}

    async def send(message):
        pass

    await response(scope, receive, send)
    await asyncio.sleep(0.1)

    assert fake.closed, "NATS connection left open after client disconnect"
    assert _manager_pending_tasks() == [], "SSE pump task still running after disconnect"


@pytest.mark.asyncio
async def test_disconnect_completes_when_caller_is_cancelled(monkeypatch):
    """A cancelled caller (anyio cancel scope) must not abort the teardown."""
    fake = FakeNATS()
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    task = asyncio.create_task(manager.disconnect())
    # anyio keeps re-delivering cancellation at every checkpoint; emulate that.
    for _ in range(5):
        await asyncio.sleep(0)
        task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await asyncio.sleep(0.05)

    assert fake.closed, "NATS connection left open when disconnect() was cancelled"
    assert _manager_pending_tasks() == []


@pytest.mark.asyncio
async def test_connect_failure_after_nats_connect_closes_connection(monkeypatch):
    """If setup fails after the socket is open, the socket must not leak."""
    fake = FakeNATS(jetstream_error=RuntimeError("jetstream unavailable"))
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()

    with pytest.raises(RuntimeError, match="jetstream unavailable"):
        await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    assert fake.closed, "NATS connection left open after connect() failed"


@pytest.mark.asyncio
async def test_broker_loss_ends_stream_and_closes_connection(monkeypatch):
    """When NATS drops, the stream must end so the browser reconnects.

    The pump stops reading once the broker connection is gone.  If the stream
    kept sending heartbeats the browser would stay "connected" and never see
    another event.
    """
    fake = FakeNATS()
    _install_fake_nats(monkeypatch, fake)
    tenant_id = uuid.uuid4()
    monkeypatch.setattr(
        sse_router,
        "_validate_sse_token",
        AsyncMock(return_value={"role": "admin", "tenant_id": str(tenant_id), "user_id": "u"}),
    )
    scope = {
        "type": "http",
        "method": "GET",
        "path": f"/api/tenants/{tenant_id}/events/stream",
        "headers": [],
        "query_string": b"",
    }
    response = await sse_router.event_stream(Request(scope), tenant_id, token="t")

    messages = [{"type": "http.request"}]

    async def receive():
        if messages:
            return messages.pop()
        await asyncio.sleep(30)  # the client never disconnects on its own
        return {"type": "http.disconnect"}

    async def send(message):
        pass

    async def drop_broker():
        await asyncio.sleep(0.2)
        fake.connected = False

    asyncio.create_task(drop_broker())
    await asyncio.wait_for(response(scope, receive, send), timeout=5)
    await asyncio.sleep(0.1)

    assert fake.closed
    assert _manager_pending_tasks() == []
