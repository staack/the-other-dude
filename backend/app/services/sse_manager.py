"""SSE Connection Manager -- bridges NATS JetStream to per-client asyncio queues.

Each SSE client gets its own NATS connection with ephemeral ordered consumers.
Events are tenant-filtered and placed onto an asyncio.Queue that the SSE
router drains via EventSourceResponse.  A ``None`` on the queue tells the
router the stream is over (broker gone, or a subscription broke) so the
browser reconnects with fresh consumers.
"""

import asyncio
import json
from typing import Optional

import nats
import nats.errors
import nats.js.errors
import structlog
from nats.js.api import DeliverPolicy, StreamConfig

from app.config import settings

logger = structlog.get_logger(__name__)

# Subjects per stream for SSE subscriptions
# Note: config.push.* subjects live in DEVICE_EVENTS (created by Go poller)
_DEVICE_EVENT_SUBJECTS = [
    "device.status.>",
    "device.metrics.>",
    "config.push.rollback.>",
    "config.push.alert.>",
]
_ALERT_EVENT_SUBJECTS = ["alert.fired.>", "alert.resolved.>"]
_OPERATION_EVENT_SUBJECTS = ["firmware.progress.>"]

_STREAM_MAX_BYTES = 16 * 1024 * 1024
_ALERT_STREAM = StreamConfig(
    name="ALERT_EVENTS",
    subjects=_ALERT_EVENT_SUBJECTS,
    max_age=3600,  # 1 hour retention
    max_bytes=_STREAM_MAX_BYTES,
)
_OPERATION_STREAM = StreamConfig(
    name="OPERATION_EVENTS",
    subjects=_OPERATION_EVENT_SUBJECTS,
    max_age=3600,
    max_bytes=_STREAM_MAX_BYTES,
)

# (stream name, subjects, config used to create the stream lazily, or None
# when another service owns it: DEVICE_EVENTS is created by the Go poller)
_SUBSCRIPTIONS: list[tuple[str, list[str], Optional[StreamConfig]]] = [
    ("DEVICE_EVENTS", _DEVICE_EVENT_SUBJECTS, None),
    ("ALERT_EVENTS", _ALERT_EVENT_SUBJECTS, _ALERT_STREAM),
    ("OPERATION_EVENTS", _OPERATION_EVENT_SUBJECTS, _OPERATION_STREAM),
]

# Teardown tasks run shielded from the caller's cancellation (sse-starlette
# cancels the stream's anyio scope when the browser disconnects).  Keep a
# strong reference so the loop cannot garbage-collect them mid-close.
_teardown_tasks: set[asyncio.Task] = set()

# nats-py's close() can sit in transport.drain()/wait_closed() for the TCP
# retransmission timeout when the broker host vanished.  After this long the
# transport is closed by hand so the descriptor is released regardless.
_CLOSE_TIMEOUT = 10.0

# How long a reader waits on one subscription before re-checking the
# connection state.  Delivery itself is immediate; this only bounds how fast
# a reader notices that the connection has closed.
_NEXT_MSG_TIMEOUT = 1.0

# Notice a silently vanished broker (no RST) within ~30 s instead of the
# nats-py default of 120 s pings x 2 outstanding (4-6 minutes), during which
# the browser would see heartbeats but no events.
_PING_INTERVAL = 10
_MAX_OUTSTANDING_PINGS = 2

# nats-py rides out short broker outages by itself; ordered consumers reset
# on missed heartbeats after a reconnect.  Only once these attempts are
# exhausted is the client closed and the stream ended.
_MAX_RECONNECT_ATTEMPTS = 5
_RECONNECT_TIME_WAIT = 2


def _map_subject_to_event_type(subject: str) -> str:
    """Map a NATS subject prefix to an SSE event type string."""
    if subject.startswith("device.status."):
        return "device_status"
    if subject.startswith("device.metrics."):
        return "metric_update"
    if subject.startswith("alert.fired."):
        return "alert_fired"
    if subject.startswith("alert.resolved."):
        return "alert_resolved"
    if subject.startswith("config.push."):
        return "config_push"
    if subject.startswith("firmware.progress."):
        return "firmware_progress"
    return "unknown"


async def ensure_sse_streams() -> None:
    """Create ALERT_EVENTS and OPERATION_EVENTS NATS streams if they don't exist.

    Called once during app startup so the streams are ready before any
    SSE connection or event publisher needs them.  Idempotent -- uses
    add_stream which acts as create-or-update.
    """
    nc = None
    try:
        nc = await nats.connect(settings.NATS_URL)
        js = nc.jetstream()
        for config in (_ALERT_STREAM, _OPERATION_STREAM):
            await js.add_stream(config)
            logger.info("nats.stream.ensured", stream=config.name)
    except Exception as exc:
        logger.warning("sse.streams.ensure_failed", error=str(exc))
        raise
    finally:
        if nc:
            try:
                await nc.close()
            except Exception:
                pass


def _describe(exc: BaseException) -> str:
    return str(exc) or exc.__class__.__name__


class SSEConnectionManager:
    """Manages a single SSE client's lifecycle: NATS connection, subscriptions, and event queue."""

    def __init__(self) -> None:
        self._nc: Optional[nats.aio.client.Client] = None
        self._subscriptions: list = []
        self._queue: Optional[asyncio.Queue] = None
        self._tenant_id: Optional[str] = None
        self._connection_id: Optional[str] = None
        self._pump_task: Optional[asyncio.Task] = None
        self._pump_failed = False
        self._closed = False

    async def connect(
        self,
        connection_id: str,
        tenant_id: Optional[str],
        last_event_id: Optional[str] = None,
    ) -> asyncio.Queue:
        """Set up NATS subscriptions and return an asyncio.Queue for SSE events.

        Args:
            connection_id: Unique identifier for this SSE connection.
            tenant_id: Tenant UUID string to filter events.  None for super_admin
                       (receives events from all tenants).
            last_event_id: The browser's Last-Event-ID header, logged for
                           diagnostics only.  Replay is not implemented: event
                           ids are stream sequences from three different
                           streams, so one id cannot position all consumers.

        Returns:
            asyncio.Queue that the SSE generator should drain.  A ``None``
            item means the stream is over and the client should reconnect.

        Raises:
            nats.errors.Error / OSError: the broker could not be reached.
            RuntimeError: no subscription could be created.
        """
        self._connection_id = connection_id
        self._tenant_id = tenant_id
        self._queue = asyncio.Queue(maxsize=256)

        self._nc = await nats.connect(
            settings.NATS_URL,
            max_reconnect_attempts=_MAX_RECONNECT_ATTEMPTS,
            reconnect_time_wait=_RECONNECT_TIME_WAIT,
            ping_interval=_PING_INTERVAL,
            max_outstanding_pings=_MAX_OUTSTANDING_PINGS,
        )
        try:
            await self._subscribe(last_event_id)
        except BaseException:
            # The socket is open; never leave it behind (issue #18).
            await self.disconnect()
            raise

        return self._queue

    async def _subscribe(self, last_event_id: Optional[str]) -> None:
        """Create the JetStream subscriptions and start the pump task."""
        js = self._nc.jetstream()

        logger.info(
            "sse.connecting",
            connection_id=self._connection_id,
            tenant_id=self._tenant_id,
            last_event_id=last_event_id,
        )

        for stream, subjects, create in _SUBSCRIPTIONS:
            for subject in subjects:
                sub = await self._subscribe_subject(js, stream, subject, create)
                if sub is not None:
                    self._subscriptions.append(sub)

        if not self._subscriptions:
            # Nothing could ever reach the client; failing here makes the
            # browser retry with back-off instead of sitting on a
            # healthy-looking stream that only carries heartbeats.
            raise RuntimeError("no SSE subscriptions could be created")

        self._pump_task = asyncio.create_task(self._pump_messages())

        logger.info(
            "sse.connected",
            connection_id=self._connection_id,
            subscription_count=len(self._subscriptions),
        )

    async def _subscribe_subject(self, js, stream: str, subject: str, create):
        """Subscribe to one subject, creating the stream first if we own it and it is missing."""
        try:
            return await self._ordered_subscribe(js, stream, subject)
        except Exception as exc:
            missing = isinstance(exc, nats.js.errors.NotFoundError) or "stream not found" in str(
                exc
            )
            if create is not None and missing:
                try:
                    await js.add_stream(create)
                    sub = await self._ordered_subscribe(js, stream, subject)
                    logger.info("sse.stream_created_lazily", stream=stream)
                    return sub
                except Exception as retry_exc:
                    exc = retry_exc
            logger.warning(
                "sse.subscribe_failed",
                subject=subject,
                stream=stream,
                error=_describe(exc),
            )
            return None

    @staticmethod
    async def _ordered_subscribe(js, stream: str, subject: str):
        # Ordered consumers: ephemeral, no server-side state, no ack tracking;
        # they go away with the connection so nothing accumulates across API
        # restarts or dropped browsers.  DeliverPolicy.NEW is essential: the
        # library default (ALL) replays the stream's whole retention (24 h of
        # device events) into every new browser connection.
        return await js.subscribe(
            subject,
            stream=stream,
            ordered_consumer=True,
            deliver_policy=DeliverPolicy.NEW,
        )

    async def _pump_messages(self) -> None:
        """Run one reader per subscription; end the stream when they stop.

        Readers stop when the NATS client is closed (reconnect attempts
        exhausted) or when a subscription keeps failing.  Either way nothing
        would restart delivery, so a ``None`` sentinel ends the stream and the
        browser reconnects with fresh consumers; otherwise heartbeats would
        keep it looking healthy while no event ever arrives again.
        """
        await asyncio.gather(*(self._read_subscription(sub) for sub in self._subscriptions))

        if not self._closed and self._queue is not None:
            logger.warning(
                "sse.pump_failed" if self._pump_failed else "sse.broker_lost",
                connection_id=self._connection_id,
            )
            # put(), not put_nowait(): a slow client's queued events are still
            # delivered before the sentinel.  _teardown cancels this task if
            # the consumer is already gone.
            await self._queue.put(None)

    async def _read_subscription(self, sub) -> None:
        """Deliver one subscription's messages to the queue until the connection is closed."""
        while not self._closed and not self._pump_failed:
            nc = self._nc
            if nc is None or nc.is_closed:
                return
            try:
                msg = await sub.next_msg(timeout=_NEXT_MSG_TIMEOUT)
            except nats.errors.TimeoutError:
                continue
            except asyncio.CancelledError:
                # nats-py cancels pending next_msg() futures when it closes
                # the connection; that is not our task being cancelled.
                if asyncio.current_task().cancelling():
                    raise
                continue
            except Exception as exc:
                if nc.is_closed:
                    return
                logger.warning(
                    "sse.pump_error",
                    connection_id=self._connection_id,
                    error=_describe(exc),
                )
                # A subscription that keeps raising would otherwise spin here
                # forever; end the stream so the client gets fresh consumers.
                self._pump_failed = True
                return
            await self._handle_message(msg)

    async def _handle_message(self, msg) -> None:
        """Parse a NATS message, apply the tenant filter, and enqueue it as an SSE event.

        Never raises: a bad payload is logged and skipped, because ending the
        stream on it would redeliver the same message on every reconnect.
        """
        try:
            data = json.loads(msg.data)
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = None
        if not isinstance(data, dict):
            logger.warning(
                "sse.bad_payload",
                connection_id=self._connection_id,
                subject=getattr(msg, "subject", None),
            )
            await self._ack(msg)
            return

        # Tenant filtering: skip messages not matching this connection's tenant
        if self._tenant_id is not None:
            if str(data.get("tenant_id", "")) != self._tenant_id:
                await self._ack(msg)
                return

        event_type = _map_subject_to_event_type(msg.subject)

        # Extract NATS stream sequence for the SSE id field
        seq_id = "0"
        metadata = getattr(msg, "metadata", None)
        if metadata and metadata.sequence:
            seq_id = str(metadata.sequence.stream)

        sse_event = {
            "event": event_type,
            "data": json.dumps(data),
            "id": seq_id,
        }

        try:
            self._queue.put_nowait(sse_event)
        except asyncio.QueueFull:
            logger.warning(
                "sse.queue_full",
                connection_id=self._connection_id,
                dropped_event=event_type,
            )

        await self._ack(msg)

    @staticmethod
    async def _ack(msg) -> None:
        try:
            await msg.ack()
        except Exception:
            pass

    async def disconnect(self) -> None:
        """Stop the pump and close the NATS connection.

        Safe to call more than once.  The real work runs in a separate task
        behind ``asyncio.shield`` because the SSE generator's ``finally`` runs
        inside an anyio scope that sse-starlette has already cancelled: every
        await there raises ``CancelledError`` again, which used to abort this
        method before ``close()`` and leak one NATS connection per browser
        reconnect (issue #18).  The caller may still see ``CancelledError``;
        the teardown completes regardless.
        """
        if self._closed:
            return
        self._closed = True
        logger.info("sse.disconnecting", connection_id=self._connection_id)
        await asyncio.shield(self._start_teardown())

    def _start_teardown(self) -> asyncio.Task:
        """Run _teardown() in its own task, held alive by the module registry."""
        task = asyncio.get_running_loop().create_task(self._teardown())
        _teardown_tasks.add(task)
        task.add_done_callback(_teardown_tasks.discard)
        return task

    async def _teardown(self) -> None:
        """Release every resource held by this connection.  Must not be cancelled."""
        pump, self._pump_task = self._pump_task, None
        if pump is not None and not pump.done():
            pump.cancel()
            try:
                await pump
            except (asyncio.CancelledError, Exception):
                pass

        self._subscriptions = []
        nc, self._nc = self._nc, None
        if nc is None:
            return

        # No per-subscription unsubscribe: close() clears them, the server
        # drops ephemeral ordered consumers with the connection, and each
        # unsubscribe would be one more round trip to a broker that may be
        # unreachable.  close(), not drain(): drain() waits up to 30s for a
        # client that has already gone away, and close() is idempotent and
        # cancels any pending next_msg() futures itself.
        try:
            await asyncio.wait_for(nc.close(), timeout=_CLOSE_TIMEOUT)
        except asyncio.TimeoutError:
            # Cancelling nats-py's _close() part-way leaves the client marked
            # CLOSED with the socket still open, so close the transport
            # directly; the client object is discarded after this anyway.
            logger.warning("sse.close_timeout", connection_id=self._connection_id)
            transport = getattr(nc, "_transport", None)
            if transport is not None:
                try:
                    transport.close()
                except Exception:
                    pass
        except Exception as exc:
            logger.warning(
                "sse.close_failed",
                connection_id=self._connection_id,
                error=_describe(exc),
            )
            return

        logger.info("sse.disconnected", connection_id=self._connection_id)
