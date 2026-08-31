"""RouterOS safe mode — session-scoped automatic revert, without a reboot.

Safe mode is RouterOS's own dead-man's switch. Changes made inside a safe-mode
session are undone automatically when the session is lost, and kept when the
session explicitly releases safe mode. That is exactly the semantics "push
configuration with automatic rollback" promises, and unlike the scheduler
mechanism it replaces, it is conditioned on *actual* loss of contact rather
than on a timer, and it never reboots the device.

Verified against real hardware on 2026-08-30 (RouterOS 7.23.2, wAP ax),
driven by asyncssh — the same library used everywhere else in this service:

  * Ctrl-X (0x18) on an interactive pty enters safe mode; the prompt changes
    from ``[user@host] >`` to ``[user@host] <SAFE>``.
  * Aborting the connection reverted every change made inside the session,
    and device uptime continued uninterrupted — no reboot.
  * A second Ctrl-X prints "Releasing Safe Mode... Success!" and KEEPS the
    changes.

  * Both ``conn.abort()`` and a graceful ``conn.close()`` revert an
    uncommitted session, so the guarantee does not depend on the teardown
    being ungraceful. ``abort()`` is used anyway because it does not wait
    for an exchange that a severed management path cannot complete.
  * ``conn.abort()`` does NOT make the device generate a supout dump —
    verified over three consecutive abort cycles. Killing the local SSH
    *client process* mid-session does: that produced a 722 KiB
    ``autosupout.rif`` and a "service malfunction" log entry on a device
    with ~95 MiB free. Tear the connection down in-protocol; never reach
    for a process kill.

  * The undo buffer holds 100 actions. A 100-action change set reverted
    correctly; 128, 140 and 150 were all *kept* on session loss while the
    prompt still displayed ``<SAFE>`` and nothing was written to the log.
    Safe mode stops protecting silently, so there is no in-band signal to
    detect and the only defence is to count the change set up front and
    refuse. Hence SAFE_MODE_MAX_ACTIONS and the mandatory pre-flight check
    in :meth:`SafeModeSession.import_rsc`.

Why this replaced the panic-revert scheduler
--------------------------------------------
The previous mechanism installed a RouterOS scheduler with
``start-time=startup interval=90s`` whose on-event ran ``/system backup load``.
Measured on the same hardware, that scheduler fires on a lattice anchored to
device *boot* time, so the delay between installing it and its first fire is
whatever remains of the current 90-second slot — 4 seconds in one trial, 88 in
another. Because the push flow waited 60 seconds before it even began its
verification, it usually lost that race, and ``/system backup load`` reverts
*and reboots*. A completely successful push would reboot the customer's
router. There was also no reachability check anywhere in it, despite comments
and docs claiming one.
"""

import asyncio
import logging

import asyncssh

logger = logging.getLogger(__name__)

# Ctrl-X — toggles RouterOS safe mode on an interactive terminal.
_CTRL_X = "\x18"

# Substring RouterOS puts in the prompt while a safe-mode session is held.
_SAFE_PROMPT = "<SAFE>"

# Substring of the ordinary (non-safe-mode) RouterOS prompt.
_NORMAL_PROMPT = "] >"

# Maximum number of config actions safe mode will undo.
#
# Hardware-verified: 100 reverted; 128 did not, silently, with the prompt still
# showing "<SAFE>". Do not raise this without re-testing on the target
# RouterOS version — exceeding it fails open, not closed.
SAFE_MODE_MAX_ACTIONS = 100

# RouterOS login-name suffix: +c disables console colours, +t suppresses
# terminal capability detection. Together they give clean, parseable output
# while still providing the interactive terminal safe mode requires.
SAFE_MODE_USERNAME_SUFFIX = "+ct"

# Verbs that mutate configuration. A line whose first word (after an optional
# leading /path) is one of these consumes one safe-mode undo slot.
_ACTION_VERBS = frozenset(
    {"add", "set", "remove", "unset", "move", "enable", "disable", "reset", "import"}
)


class SafeModeError(Exception):
    """Base class for safe-mode failures."""


class SafeModeUnavailable(SafeModeError):
    """Safe mode could not be entered, or was used before being entered.

    Raised rather than silently continuing: a caller that believes it has a
    safety net when it does not is worse off than one that knows it has none.
    """


class SafeModeOverflowRisk(SafeModeError):
    """The change set is larger than safe mode's undo buffer.

    Applying it would leave the device unprotected without any warning from
    RouterOS, so the push is refused instead.
    """


def count_rsc_actions(rsc: str) -> int:
    """Count the config-mutating actions in a RouterOS .rsc script.

    Deliberately conservative — it is better to over-count and refuse a push
    that would in fact have been protected than to under-count and apply an
    unprotected one.

    Blank lines, ``#`` comments and bare path lines (``/ip firewall filter``)
    change nothing and are not counted. Backslash line continuations are
    joined first, so a wrapped statement counts once.

    Args:
        rsc: Contents of the .rsc script.

    Returns:
        Number of actions the script will perform.
    """
    # Join RouterOS line continuations before doing anything else.
    logical = rsc.replace("\\\n", " ")

    actions = 0
    for raw in logical.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        words = line.split()

        if words[0].startswith("/"):
            # A path-prefixed statement. The path is multi-token
            # ("/ip address add ...") and RouterOS 7 also accepts the
            # slash-joined form ("/ip/address/add"), so scan forward for the
            # verb rather than assuming a position. Stop at the first
            # property token (they contain "="), because everything after
            # that is a value and could coincidentally read like a verb.
            tokens: list[str] = []
            for word in words[0].split("/"):
                tokens.append(word)
            tokens.extend(words[1:])

            verb = None
            for token in tokens:
                if "=" in token:
                    break
                if token.lower() in _ACTION_VERBS:
                    verb = token
                    break
            if verb is None:
                continue  # bare path line, cursor move only
        else:
            verb = words[0]

        if verb.lstrip(":").lower() in _ACTION_VERBS:
            actions += 1

    return actions


class SafeModeSession:
    """An interactive RouterOS session holding safe mode open.

    Use as an async context manager. Changes made inside the block are
    reverted by the device unless :meth:`commit` is called::

        async with SafeModeSession(conn) as session:
            await session.import_rsc(rsc, filename="portal-restore.rsc")
            if await device_still_reachable():
                await session.commit()
        # no commit -> connection aborted -> RouterOS reverts, no reboot

    The revert path is simply dropping the connection, which is also what
    happens if the pushed config severs the management path. The mechanism and
    the failure it guards against are the same event, so there is no timer to
    tune and no race to lose.
    """

    def __init__(self, conn: asyncssh.SSHClientConnection, read_timeout: float = 30.0):
        """Initialise the session.

        Args:
            conn:         An established asyncssh connection to the device.
            read_timeout: Seconds to wait for an expected prompt.
        """
        self._conn = conn
        self._read_timeout = read_timeout
        self._proc: asyncssh.SSHClientProcess | None = None
        self.active = False
        self.committed = False

    async def __aenter__(self) -> "SafeModeSession":
        await self.enter()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if not self.committed:
            # Abort rather than close: we want the session to die without a
            # clean shutdown so RouterOS treats it as a lost session and
            # reverts. This is the rollback.
            logger.info("Safe-mode session ending without commit — device will revert")
            self._conn.abort()
        self.active = False

    async def _read_until(self, marker: str) -> str:
        """Read from the device until *marker* appears or the timeout expires."""
        assert self._proc is not None
        buf = ""
        try:
            while marker not in buf:
                chunk = await asyncio.wait_for(
                    self._proc.stdout.read(4096), timeout=self._read_timeout
                )
                if not chunk:
                    break
                buf += chunk
        except (TimeoutError, asyncio.TimeoutError, asyncssh.Error, StopAsyncIteration):
            pass
        except StopIteration:  # pragma: no cover - test doubles exhaust side_effect
            pass
        return buf

    async def enter(self) -> None:
        """Open a pty and enter safe mode, confirming the prompt changed.

        Raises:
            SafeModeUnavailable: if the ``<SAFE>`` prompt never appeared, i.e.
                the device did not grant safe mode.
        """
        self._proc = await self._conn.create_process(term_type="vt100", term_size=(200, 50))
        await self._read_until(_NORMAL_PROMPT)

        self._proc.stdin.write(_CTRL_X)
        out = await self._read_until(_SAFE_PROMPT)
        if _SAFE_PROMPT not in out:
            self.active = False
            raise SafeModeUnavailable(
                "device did not enter safe mode; refusing to push without a "
                f"rollback net (last output: {out[-200:]!r})"
            )

        self.active = True
        logger.info("Safe mode acquired — changes will revert if this session is lost")

    async def run(self, command: str) -> str:
        """Run a command inside the safe-mode session.

        Raises:
            SafeModeUnavailable: if safe mode is not currently held.
        """
        if not self.active or self._proc is None:
            raise SafeModeUnavailable("refusing to run %r: safe mode is not held" % command)
        self._proc.stdin.write(command + "\r")
        return await self._read_until(_SAFE_PROMPT)

    async def import_rsc(self, rsc: str, filename: str) -> str:
        """Import an already-uploaded .rsc, refusing over-large change sets.

        Args:
            rsc:      Contents of the script, used only to count actions.
            filename: Name of the file already present on device flash.

        Raises:
            SafeModeOverflowRisk: if the script exceeds the undo buffer.
            SafeModeUnavailable:  if safe mode is not currently held.
        """
        actions = count_rsc_actions(rsc)
        if actions > SAFE_MODE_MAX_ACTIONS:
            raise SafeModeOverflowRisk(
                f"change set has {actions} actions but RouterOS safe mode only "
                f"undoes {SAFE_MODE_MAX_ACTIONS}; beyond that it keeps changes "
                "on session loss without warning. Refusing to push unprotected — "
                "split the change into smaller batches."
            )
        return await self.run(f"/import file={filename}")

    async def commit(self) -> None:
        """Release safe mode, keeping the changes.

        Only call this once the device has been confirmed reachable over an
        independent connection.
        """
        if not self.active or self._proc is None:
            raise SafeModeUnavailable("cannot commit: safe mode is not held")

        self._proc.stdin.write(_CTRL_X)
        await self._read_until(_NORMAL_PROMPT)
        self.committed = True
        self.active = False
        logger.info("Safe mode released — config change committed")
