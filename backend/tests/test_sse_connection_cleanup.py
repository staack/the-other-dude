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
import nats.js.errors
import pytest
from fastapi import HTTPException
from nats.js.api import DeliverPolicy
from starlette.requests import Request

from app.routers import sse as sse_router
from app.services import sse_manager
from app.services.sse_manager import SSEConnectionManager


class FakeMsg:
    def __init__(self, data: bytes, subject: str = "device.status.x") -> None:
        self.data = data
        self.subject = subject
        self.metadata = None
        self.acked = False

    async def ack(self) -> None:
        self.acked = True


class FakeSubscription:
    def __init__(
        self,
        nc: "FakeNATS",
        error: Exception | None = None,
        messages: list[FakeMsg] | None = None,
    ) -> None:
        self._nc = nc
        self._error = error
        self._messages = list(messages or [])

    async def next_msg(self, timeout: float):
        if self._error is not None:
            raise self._error
        if self._messages:
            await asyncio.sleep(0)
            return self._messages.pop(0)
        await asyncio.sleep(timeout)
        if self._nc.closed:
            raise nats.errors.ConnectionClosedError
        raise nats.errors.TimeoutError

    async def unsubscribe(self) -> None:
        await asyncio.sleep(0)
        self.unsubscribed = True


class FakeJetStream:
    def __init__(
        self,
        subscribe_error: Exception | None = None,
        next_msg_error: Exception | None = None,
        messages: dict[str, list[FakeMsg]] | None = None,
        missing_streams: set[str] | None = None,
    ) -> None:
        self.nc: FakeNATS | None = None
        self.subscriptions: list[FakeSubscription] = []
        self.subscribe_calls: list[dict] = []
        self.added_streams: list = []
        self._subscribe_error = subscribe_error
        self._next_msg_error = next_msg_error
        self._messages = messages or {}
        self._missing_streams = set(missing_streams or ())

    async def subscribe(self, subject, stream=None, **kwargs):
        self.subscribe_calls.append({"subject": subject, "stream": stream, **kwargs})
        if self._subscribe_error is not None:
            raise self._subscribe_error
        if stream in self._missing_streams:
            raise nats.js.errors.NotFoundError(description="stream not found")
        sub = FakeSubscription(
            self.nc, error=self._next_msg_error, messages=self._messages.get(subject)
        )
        self.subscriptions.append(sub)
        return sub

    async def add_stream(self, config) -> None:
        self.added_streams.append(config)
        self._missing_streams.discard(config.name)


class FakeTransport:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class FakeNATS:
    """Mimics the parts of nats.aio.client.Client the SSE manager touches.

    Every coroutine yields to the loop at least once so a cancelled caller
    behaves the way it does against the real socket-backed client.
    """

    def __init__(
        self,
        jetstream_error: Exception | None = None,
        js: FakeJetStream | None = None,
        hang_close: bool = False,
    ) -> None:
        self.closed = False
        self.connected = True
        self.close_calls = 0
        self.js = js or FakeJetStream()
        self.js.nc = self
        self._jetstream_error = jetstream_error
        self._hang_close = hang_close
        self._transport = FakeTransport()

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
        if self._hang_close:
            # A vanished broker host: nats-py waits on transport.drain()
            # until the kernel gives up on retransmission.
            await asyncio.Event().wait()
        await asyncio.sleep(0)
        self.closed = True

    async def drain(self) -> None:
        await asyncio.sleep(0)
        await self.close()


def _install_fake_nats(monkeypatch, fake: FakeNATS) -> dict:
    """Patch nats.connect to return ``fake``; returns the kwargs it was called with."""
    seen: dict = {}

    async def fake_connect(*args, **kwargs):
        seen.update(kwargs)
        return fake

    monkeypatch.setattr(sse_manager.nats, "connect", fake_connect)
    return seen


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
        fake.closed = True  # nats-py gave up reconnecting

    asyncio.create_task(drop_broker())
    await asyncio.wait_for(response(scope, receive, send), timeout=5)
    await asyncio.sleep(0.1)

    assert fake.close_calls == 1
    assert _manager_pending_tasks() == []


@pytest.mark.asyncio
async def test_failing_subscription_ends_stream(monkeypatch):
    """A subscription that keeps raising must end the stream, not spin forever."""
    fake = FakeNATS(js=FakeJetStream(next_msg_error=RuntimeError("bad subscription")))
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    queue = await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    sentinel = await asyncio.wait_for(queue.get(), timeout=2)

    assert sentinel is None, "stream kept running on a permanently failing subscription"


@pytest.mark.asyncio
async def test_connect_fails_when_no_subscription_succeeds(monkeypatch):
    """Zero subscriptions means no events can ever arrive; fail the connect instead."""
    fake = FakeNATS(js=FakeJetStream(subscribe_error=RuntimeError("stream not found")))
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()

    with pytest.raises(RuntimeError):
        await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    assert fake.closed


@pytest.mark.asyncio
async def test_broker_loss_sentinel_does_not_drop_queued_events(monkeypatch):
    """Events already delivered to a slow client must survive the broker-loss sentinel."""
    fake = FakeNATS()
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    queue = await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))
    for i in range(queue.maxsize):
        queue.put_nowait({"event": "device_status", "data": str(i), "id": str(i)})

    fake.closed = True
    await asyncio.sleep(1.2)  # pump notices the loss and tries to append the sentinel

    delivered = []
    while True:
        item = await asyncio.wait_for(queue.get(), timeout=2)
        if item is None:
            break
        delivered.append(item)
    assert len(delivered) == queue.maxsize


@pytest.mark.asyncio
async def test_teardown_forces_transport_closed_when_close_hangs(monkeypatch):
    """If nats-py's close() never returns, the socket must still be released."""
    monkeypatch.setattr(sse_manager, "_CLOSE_TIMEOUT", 0.1)
    fake = FakeNATS(hang_close=True)
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    await asyncio.wait_for(manager.disconnect(), timeout=2)

    assert fake._transport.closed, "transport left open after close() hung"
    assert _manager_pending_tasks() == []


@pytest.mark.asyncio
async def test_reconnecting_broker_does_not_end_stream(monkeypatch):
    """A NATS blip is nats-py's to ride out; only an exhausted reconnect ends the stream."""
    fake = FakeNATS()
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    queue = await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    fake.connected = False  # RECONNECTING
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(queue.get(), timeout=1.5)

    fake.closed = True  # reconnect attempts exhausted
    assert await asyncio.wait_for(queue.get(), timeout=3) is None


@pytest.mark.asyncio
async def test_connect_uses_new_delivery_and_fast_pings(monkeypatch):
    """Fresh consumers must not replay the stream's history, and a dead broker must be noticed."""
    fake = FakeNATS()
    seen = _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    assert seen.get("ping_interval", 120) <= 15
    assert fake.js.subscribe_calls, "no subscriptions made"
    for call in fake.js.subscribe_calls:
        assert call.get("deliver_policy") == DeliverPolicy.NEW, call


@pytest.mark.asyncio
async def test_lazily_created_streams_match_startup_config(monkeypatch):
    """The lazy create path must not produce a stream without the size cap."""
    fake = FakeNATS(js=FakeJetStream(missing_streams={"ALERT_EVENTS", "OPERATION_EVENTS"}))
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    await manager.connect(connection_id="sse-test", tenant_id=str(uuid.uuid4()))

    created = {c.name: c for c in fake.js.added_streams}
    assert set(created) == {"ALERT_EVENTS", "OPERATION_EVENTS"}
    for config in created.values():
        assert config.max_bytes == 16 * 1024 * 1024, config
    assert len(fake.js.subscriptions) == 7


@pytest.mark.asyncio
async def test_malformed_message_is_skipped_not_fatal(monkeypatch):
    """One bad payload must not end the stream (it would be redelivered on every reconnect)."""
    tenant = str(uuid.uuid4())
    good = FakeMsg(b'{"tenant_id": "%s", "x": 1}' % tenant.encode())
    js = FakeJetStream(messages={"device.status.>": [FakeMsg(b"[]"), FakeMsg(b"{"), good]})
    fake = FakeNATS(js=js)
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    queue = await manager.connect(connection_id="sse-test", tenant_id=tenant)

    event = await asyncio.wait_for(queue.get(), timeout=2)

    assert event is not None and event["event"] == "device_status"
    assert good.acked


@pytest.mark.asyncio
async def test_broker_unavailable_is_a_503(monkeypatch):
    """A broker outage during connect must be a 503, not a traceback-producing 500."""

    async def failing_connect(*args, **kwargs):
        raise nats.errors.NoServersError

    monkeypatch.setattr(sse_manager.nats, "connect", failing_connect)
    tenant_id = uuid.uuid4()
    monkeypatch.setattr(
        sse_router,
        "_validate_sse_token",
        AsyncMock(return_value={"role": "admin", "tenant_id": str(tenant_id), "user_id": "u"}),
    )
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}

    with pytest.raises(HTTPException) as info:
        await sse_router.event_stream(Request(scope), tenant_id, token="t")
    assert info.value.status_code == 503


@pytest.mark.asyncio
async def test_events_on_every_subscription_arrive_promptly(monkeypatch):
    """An event on the last subscription must not wait behind idle ones."""
    tenant = str(uuid.uuid4())
    payload = b'{"tenant_id": "%s"}' % tenant.encode()
    js = FakeJetStream(
        messages={"firmware.progress.>": [FakeMsg(payload, subject="firmware.progress.d1")]}
    )
    fake = FakeNATS(js=js)
    _install_fake_nats(monkeypatch, fake)
    manager = SSEConnectionManager()
    queue = await manager.connect(connection_id="sse-test", tenant_id=tenant)

    event = await asyncio.wait_for(queue.get(), timeout=0.4)

    assert event["event"] == "firmware_progress"
