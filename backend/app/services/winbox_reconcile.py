"""Two-directional reconciliation between Redis session records and the winbox-worker.

The worker holds a fixed pool of ten concurrency slots, each pinning an X display,
a WebSocket port and — through the poller's tunnel — an authenticated TCP connection
to a customer router. A session that outlives its Redis record holds all of that
forever: the poller's tunnel reaper only reaps when ActiveConns() drops to zero, and
the worker only expires sessions it still believes are alive. Ten of those and remote
WinBox is hard-down for the whole deployment with HTTP 503.

Two passes run on every sweep:

  A. Redis -> worker. For every live Redis record, ask the worker whether it still
     has the session. If not, close the tunnel and drop the record.
  B. Worker -> Redis. For every session the worker reports, check whether a Redis
     record still exists. If not, the session is orphaned and gets terminated.

Pass B is the one that catches the leak; a Redis SCAN can only ever find records
Redis already knows about, so the "worker has it, Redis doesn't" direction was
structurally invisible before.

Pass B deliberately converges rather than leasing. A heartbeat or lease would make
worker liveness depend on API availability, so an API blip would start killing healthy
user sessions; a sweep that has to observe the same orphan twice degrades to doing
nothing when the API is unhealthy.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from app.routers.winbox_remote import (
    REDIS_PREFIX,
    _close_tunnel,
    _get_redis,
)
from app.schemas.winbox_remote import LIVE_STATES
from app.services.winbox_remote import (
    get_session as worker_get_session,
    list_sessions as worker_list_sessions,
    terminate_session as worker_terminate_session,
)

logger = logging.getLogger(__name__)

# How often the sweep runs. The two-strike rule below is expressed in sweeps, so
# changing this changes how long an orphan survives.
RECONCILE_INTERVAL_SECONDS = 60

# An orphan is only terminated once it is older than this. A session legitimately
# exists on the worker for a window before its Redis key is written (tunnel open ->
# worker create -> Redis save), so anything younger than this may simply be mid-create.
# Two sweeps plus this floor means an orphan lives for at most ~3 minutes and a
# mid-create session is never touched.
ORPHAN_MIN_AGE_SECONDS = 120


def _parse_created_at(value: Any) -> Optional[datetime]:
    """Parse the worker's RFC3339 created_at, tolerating Go's variable-width fraction.

    Go emits between zero and nine fractional digits; fromisoformat only accepts
    three or six, so the fraction is normalised before parsing. Returns None if the
    value is missing or unparseable — callers fall back to their own observation
    window rather than guessing an age.
    """
    if not isinstance(value, str) or not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    if "." in text:
        head, _, tail = text.partition(".")
        digits = ""
        for ch in tail:
            if ch.isdigit():
                digits += ch
            else:
                break
        suffix = tail[len(digits) :]
        text = f"{head}.{digits[:6].ljust(6, '0')}{suffix}"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def _reconcile_redis_to_worker() -> None:
    """Pass A — drop Redis records for sessions the worker no longer has."""
    rd = await _get_redis()
    cursor = "0"
    while True:
        cursor, keys = await rd.scan(cursor=cursor, match=f"{REDIS_PREFIX}*", count=100)
        for key in keys:
            raw = await rd.get(key)
            if raw is None:
                continue
            try:
                sess = json.loads(raw)
            except Exception:
                await rd.delete(key)
                continue

            if sess.get("status") not in LIVE_STATES:
                continue

            session_id = sess.get("session_id")
            if not session_id:
                await rd.delete(key)
                continue

            worker_info = await worker_get_session(session_id)
            if worker_info is None:
                logger.warning("reconcile: worker lost session %s, cleaning up", session_id)
                tunnel_id = sess.get("tunnel_id")
                if tunnel_id:
                    await _close_tunnel(tunnel_id)
                await rd.delete(key)

        if cursor == "0" or cursor == 0:
            break


async def _reconcile_worker_to_redis(unknown_since: dict[str, float]) -> dict[str, float]:
    """Pass B — terminate worker sessions that no Redis record accounts for.

    ``unknown_since`` maps a worker session id to the monotonic time it was first
    seen without a Redis record. It is the loop's own memory and is deliberately not
    persisted: losing it on restart costs one extra sweep, whereas persisting it
    would be one more piece of state that can itself go stale.

    Returns the map to carry into the next sweep, rebuilt from the sessions the
    worker currently reports so that entries for vanished sessions age out on their
    own. A session whose termination failed stays in the map and is retried on the
    next sweep.
    """
    rd = await _get_redis()
    sessions = await worker_list_sessions()
    now = time.monotonic()
    still_unknown: dict[str, float] = {}

    for item in sessions:
        if not isinstance(item, dict):
            continue
        session_id = item.get("worker_session_id") or item.get("session_id")
        if not session_id:
            continue

        if await rd.exists(f"{REDIS_PREFIX}{session_id}"):
            # The API still has a record for this session — never touch it.
            continue

        first_seen = unknown_since.get(session_id)
        if first_seen is None:
            # First strike. A session is legitimately unknown to Redis for the
            # window between worker create and the Redis write.
            still_unknown[session_id] = now
            continue

        created_at = _parse_created_at(item.get("created_at"))
        if created_at is not None:
            age = (datetime.now(timezone.utc) - created_at).total_seconds()
        else:
            # The worker did not give us a usable age, so fall back to how long we
            # have been watching it go unclaimed.
            age = now - first_seen
        if age < ORPHAN_MIN_AGE_SECONDS:
            still_unknown[session_id] = first_seen
            continue

        logger.warning(
            "reconcile: terminating orphaned worker session %s (age %.0fs, no Redis record)",
            session_id,
            age,
        )
        try:
            await worker_terminate_session(session_id)
        except Exception as exc:
            logger.warning("reconcile: failed to terminate orphan %s: %s", session_id, exc)
        # Kept under its original first-seen time: if the terminate did not take,
        # the next sweep sees it again and retries immediately.
        still_unknown[session_id] = first_seen

    return still_unknown


async def reconcile_once(unknown_since: dict[str, float]) -> dict[str, float]:
    """Run both passes and return the updated orphan-watch map."""
    await _reconcile_redis_to_worker()
    return await _reconcile_worker_to_redis(unknown_since)


async def reconcile_loop() -> None:
    """Sweep every RECONCILE_INTERVAL_SECONDS until cancelled.

    NOTE: this assumes a single API replica. Two replicas would each run the sweep
    and could both terminate the same orphan — harmless, since DELETE /sessions is
    idempotent — but they would also race pass A's tunnel close against a concurrent
    create. If the API is ever scaled out, wrap the sweep in a distributed lock;
    poller/internal/bus/redis_locker.go is the established pattern in this codebase.
    """
    unknown_since: dict[str, float] = {}
    while True:
        try:
            await asyncio.sleep(RECONCILE_INTERVAL_SECONDS)
            unknown_since = await reconcile_once(unknown_since)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("winbox reconcile loop error: %s", exc)
