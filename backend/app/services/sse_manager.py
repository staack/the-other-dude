"""SSE Connection Manager -- bridges NATS JetStream to per-client asyncio queues.

Each SSE client gets its own NATS connection with ephemeral consumers.
Events are tenant-filtered and placed onto an asyncio.Queue that the
SSE router drains via EventSourceResponse.
"""

import asyncio
import json
from typing import Optional

import nats
import structlog
from nats.js.api import StreamConfig

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

# Teardown tasks run shielded from the caller's cancellation (sse-starlette
# cancels the stream's anyio scope when the browser disconnects).  Keep a
# strong reference so the loop cannot garbage-collect them mid-close.
_teardown_tasks: set[asyncio.Task] = set()


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

        await js.add_stream(
            StreamConfig(
                name="ALERT_EVENTS",
                subjects=["alert.fired.>", "alert.resolved.>"],
                max_age=3600,  # 1 hour retention
                max_bytes=16 * 1024 * 1024,  # 16MB cap
            )
        )
        logger.info("nats.stream.ensured", stream="ALERT_EVENTS")

        await js.add_stream(
            StreamConfig(
                name="OPERATION_EVENTS",
                subjects=["firmware.progress.>"],
                max_age=3600,  # 1 hour retention
                max_bytes=16 * 1024 * 1024,  # 16MB cap
            )
        )
        logger.info("nats.stream.ensured", stream="OPERATION_EVENTS")

    except Exception as exc:
        logger.warning("sse.streams.ensure_failed", error=str(exc))
        raise
    finally:
        if nc:
            try:
                await nc.close()
            except Exception:
                pass


class SSEConnectionManager:
    """Manages a single SSE client's lifecycle: NATS connection, subscriptions, and event queue."""

    def __init__(self) -> None:
        self._nc: Optional[nats.aio.client.Client] = None
        self._subscriptions: list = []
        self._queue: Optional[asyncio.Queue] = None
        self._tenant_id: Optional[str] = None
        self._connection_id: Optional[str] = None
        self._pump_task: Optional[asyncio.Task] = None
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
            last_event_id: NATS stream sequence number from the Last-Event-ID header.
                           If provided, replay starts from sequence + 1.

        Returns:
            asyncio.Queue that the SSE generator should drain.
        """
        self._connection_id = connection_id
        self._tenant_id = tenant_id
        self._queue = asyncio.Queue(maxsize=256)

        self._nc = await nats.connect(
            settings.NATS_URL,
            max_reconnect_attempts=5,
            reconnect_time_wait=2,
        )
        try:
            await self._subscribe(last_event_id)
        except BaseException:
            # The socket is open; never leave it behind (issue #18).
            self._closed = True
            await asyncio.shield(self._start_teardown())
            raise

        return self._queue

    async def _subscribe(self, last_event_id: Optional[str]) -> None:
        """Create the JetStream subscriptions and start the pump task."""
        connection_id = self._connection_id
        tenant_id = self._tenant_id
        js = self._nc.jetstream()

        logger.info(
            "sse.connecting",
            connection_id=connection_id,
            tenant_id=tenant_id,
            last_event_id=last_event_id,
        )

        # Use ordered consumers for SSE — ephemeral, no server-side state,
        # no ack tracking.  They auto-clean on disconnect so stale consumers
        # can't accumulate across API restarts or dropped browser connections.
        #
        # ordered_consumer=True implies DeliverPolicy.NEW unless last_event_id
        # was provided (replay from sequence).

        # Subscribe to device events (DEVICE_EVENTS stream -- created by Go poller)
        for subject in _DEVICE_EVENT_SUBJECTS:
            try:
                sub = await js.subscribe(
                    subject,
                    stream="DEVICE_EVENTS",
                    ordered_consumer=True,
                )
                self._subscriptions.append(sub)
            except Exception as exc:
                logger.warning(
                    "sse.subscribe_failed",
                    subject=subject,
                    stream="DEVICE_EVENTS",
                    error=str(exc),
                )

        # Subscribe to alert events (ALERT_EVENTS stream)
        # Lazily create the stream if it doesn't exist yet (startup race)
        for subject in _ALERT_EVENT_SUBJECTS:
            try:
                sub = await js.subscribe(
                    subject,
                    stream="ALERT_EVENTS",
                    ordered_consumer=True,
                )
                self._subscriptions.append(sub)
            except Exception as exc:
                if "stream not found" in str(exc):
                    try:
                        await js.add_stream(
                            StreamConfig(
                                name="ALERT_EVENTS",
                                subjects=_ALERT_EVENT_SUBJECTS,
                                max_age=3600,
                            )
                        )
                        sub = await js.subscribe(
                            subject, stream="ALERT_EVENTS", ordered_consumer=True
                        )
                        self._subscriptions.append(sub)
                        logger.info("sse.stream_created_lazily", stream="ALERT_EVENTS")
                    except Exception as retry_exc:
                        logger.warning(
                            "sse.subscribe_failed",
                            subject=subject,
                            stream="ALERT_EVENTS",
                            error=str(retry_exc),
                        )
                else:
                    logger.warning(
                        "sse.subscribe_failed",
                        subject=subject,
                        stream="ALERT_EVENTS",
                        error=str(exc),
                    )

        # Subscribe to operation events (OPERATION_EVENTS stream)
        for subject in _OPERATION_EVENT_SUBJECTS:
            try:
                sub = await js.subscribe(
                    subject,
                    stream="OPERATION_EVENTS",
                    ordered_consumer=True,
                )
                self._subscriptions.append(sub)
            except Exception as exc:
                if "stream not found" in str(exc):
                    try:
                        await js.add_stream(
                            StreamConfig(
                                name="OPERATION_EVENTS",
                                subjects=_OPERATION_EVENT_SUBJECTS,
                                max_age=3600,
                            )
                        )
                        sub = await js.subscribe(
                            subject, stream="OPERATION_EVENTS", ordered_consumer=True
                        )
                        self._subscriptions.append(sub)
                        logger.info("sse.stream_created_lazily", stream="OPERATION_EVENTS")
                    except Exception as retry_exc:
                        logger.warning(
                            "sse.subscribe_failed",
                            subject=subject,
                            stream="OPERATION_EVENTS",
                            error=str(retry_exc),
                        )
                else:
                    logger.warning(
                        "sse.subscribe_failed",
                        subject=subject,
                        stream="OPERATION_EVENTS",
                        error=str(exc),
                    )

        # Start background task to pull messages from subscriptions into the queue
        self._pump_task = asyncio.create_task(self._pump_messages())

        logger.info(
            "sse.connected",
            connection_id=connection_id,
            subscription_count=len(self._subscriptions),
        )

    async def _pump_messages(self) -> None:
        """Read messages from all NATS push subscriptions and push them onto the asyncio queue.

        Uses next_msg with a short timeout so we can interleave across
        subscriptions without blocking.  Runs until the NATS connection is closed
        or drained.
        """
        while self._nc and self._nc.is_connected:
            for sub in self._subscriptions:
                try:
                    msg = await sub.next_msg(timeout=0.5)
                    await self._handle_message(msg)
                except nats.errors.TimeoutError:
                    # No messages available on this subscription -- move on
                    continue
                except Exception as exc:
                    if self._nc and self._nc.is_connected:
                        logger.warning(
                            "sse.pump_error",
                            connection_id=self._connection_id,
                            error=str(exc),
                        )
                    break
            # Brief yield to avoid tight-looping
            await asyncio.sleep(0.1)

    async def _handle_message(self, msg) -> None:
        """Parse a NATS message, apply tenant filter, and enqueue as SSE event."""
        try:
            data = json.loads(msg.data)
        except (json.JSONDecodeError, UnicodeDecodeError):
            await msg.ack()
            return

        # Tenant filtering: skip messages not matching this connection's tenant
        if self._tenant_id is not None:
            msg_tenant = data.get("tenant_id", "")
            if str(msg_tenant) != self._tenant_id:
                await msg.ack()
                return

        event_type = _map_subject_to_event_type(msg.subject)

        # Extract NATS stream sequence for Last-Event-ID support
        seq_id = "0"
        if msg.metadata and msg.metadata.sequence:
            seq_id = str(msg.metadata.sequence.stream)

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

        await msg.ack()

    async def disconnect(self) -> None:
        """Stop the pump, unsubscribe, and close the NATS connection.

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

        subscriptions, self._subscriptions = self._subscriptions, []
        nc, self._nc = self._nc, None
        if nc is None:
            return

        for sub in subscriptions:
            try:
                await asyncio.wait_for(sub.unsubscribe(), timeout=2.0)
            except Exception:
                pass

        # close(), not drain(): drain() waits up to 30s for a client that has
        # already gone away, and close() is idempotent and cancels any pending
        # next_msg() futures itself.
        try:
            await asyncio.wait_for(nc.close(), timeout=5.0)
        except Exception as exc:
            logger.warning(
                "sse.close_failed",
                connection_id=self._connection_id,
                error=str(exc) or exc.__class__.__name__,
            )
            return

        logger.info("sse.disconnected", connection_id=self._connection_id)
