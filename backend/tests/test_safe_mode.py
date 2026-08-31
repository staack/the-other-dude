"""Tests for RouterOS safe-mode-backed config push.

These tests encode behaviour verified against real hardware on 2026-08-30
(RouterOS 7.23.2, wAP ax). See app/services/safe_mode.py for the raw
observations that justify each constant.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.safe_mode import (
    SAFE_MODE_MAX_ACTIONS,
    SafeModeOverflowRisk,
    SafeModeSession,
    SafeModeUnavailable,
    count_rsc_actions,
)


# ---------------------------------------------------------------------------
# count_rsc_actions — the pre-flight guard against silent buffer overflow
# ---------------------------------------------------------------------------


def test_blank_lines_and_comments_are_not_actions():
    rsc = """
# 2026-08-30 12:00:00 by RouterOS 7.23.2
# software id = ABCD-1234
#

"""
    assert count_rsc_actions(rsc) == 0


def test_bare_path_lines_are_not_actions():
    """A bare `/ip firewall filter` only moves the CLI cursor — it changes nothing."""
    rsc = "/ip firewall filter\n/system identity\n"
    assert count_rsc_actions(rsc) == 0


def test_counts_add_set_remove_lines():
    rsc = """/ip firewall filter
add chain=input action=accept
add chain=forward action=drop
set 0 comment=hello
remove 1
"""
    assert count_rsc_actions(rsc) == 4


def test_counts_path_prefixed_action_lines():
    """`/ip address add ...` is a single action even though it carries a path."""
    rsc = "/ip address add address=10.0.0.1/24 interface=bridge1\n"
    assert count_rsc_actions(rsc) == 1


def test_line_continuations_count_as_one_action():
    """RouterOS wraps long lines with a trailing backslash; that is still one action."""
    rsc = """/interface wifi configuration
add disabled=no mode=station-pseudobridge name=cfg1 \\
    security.authentication-types=wpa2-psk \\
    ssid=CleverSSID
"""
    assert count_rsc_actions(rsc) == 1


def test_max_actions_matches_hardware_verified_limit():
    """100 reverted correctly on hardware; 128 silently did not. Guard at 100."""
    assert SAFE_MODE_MAX_ACTIONS == 100


# ---------------------------------------------------------------------------
# SafeModeSession — enter / commit / revert
# ---------------------------------------------------------------------------


def _fake_process(prompts):
    """Build a fake asyncssh process whose stdout yields the given chunks."""
    proc = MagicMock()
    proc.stdin = MagicMock()
    proc.stdin.write = MagicMock()
    proc.stdout = MagicMock()
    proc.stdout.read = AsyncMock(side_effect=list(prompts))
    return proc


def _fake_conn(proc):
    conn = MagicMock()
    conn.create_process = AsyncMock(return_value=proc)
    conn.abort = MagicMock()
    conn.close = MagicMock()
    return conn


async def test_enter_sends_ctrl_x_and_detects_safe_prompt():
    proc = _fake_process(
        ["[claude@wAP] > ", "Taking Safe Mode session... Success!\n[claude@wAP] <SAFE> "]
    )
    conn = _fake_conn(proc)

    session = SafeModeSession(conn)
    await session.enter()

    assert session.active is True
    # Ctrl-X is the only thing that enters safe mode.
    proc.stdin.write.assert_any_call("\x18")


async def test_enter_raises_when_safe_prompt_never_appears():
    """If we cannot confirm safe mode, we must not pretend the net is up."""
    proc = _fake_process(["[claude@wAP] > ", "[claude@wAP] > ", ""])
    conn = _fake_conn(proc)

    session = SafeModeSession(conn, read_timeout=0.01)
    with pytest.raises(SafeModeUnavailable):
        await session.enter()
    assert session.active is False


async def test_commit_releases_safe_mode_and_keeps_changes():
    proc = _fake_process(
        [
            "[claude@wAP] > ",
            "[claude@wAP] <SAFE> ",
            "Releasing Safe Mode... Success!\n[claude@wAP] > ",
        ]
    )
    conn = _fake_conn(proc)

    session = SafeModeSession(conn)
    await session.enter()
    await session.commit()

    assert session.committed is True
    assert session.active is False
    # Second Ctrl-X releases safe mode, keeping the changes.
    assert proc.stdin.write.call_args_list.count(((("\x18"),), {})) == 2
    # A commit must never abort the connection — that would revert.
    conn.abort.assert_not_called()


async def test_exiting_without_commit_aborts_connection_to_trigger_revert():
    """The revert path is a dropped session — never a reboot, never a scheduler."""
    proc = _fake_process(["[claude@wAP] > ", "[claude@wAP] <SAFE> "])
    conn = _fake_conn(proc)

    session = SafeModeSession(conn)
    async with session:
        pass  # no commit()

    assert session.committed is False
    conn.abort.assert_called_once()


async def test_commit_inside_context_manager_does_not_abort():
    proc = _fake_process(
        [
            "[claude@wAP] > ",
            "[claude@wAP] <SAFE> ",
            "Releasing Safe Mode... Success!\n[claude@wAP] > ",
        ]
    )
    conn = _fake_conn(proc)

    session = SafeModeSession(conn)
    async with session:
        await session.commit()

    conn.abort.assert_not_called()


async def test_run_refuses_when_not_in_safe_mode():
    proc = _fake_process(["[claude@wAP] > "])
    conn = _fake_conn(proc)
    session = SafeModeSession(conn)

    with pytest.raises(SafeModeUnavailable):
        await session.run("/system identity print")


async def test_guard_rejects_change_sets_larger_than_the_undo_buffer():
    """Over the buffer, safe mode keeps changes while still printing <SAFE>.

    There is no in-band signal, so the only defence is refusing up front.
    """
    rsc = "/ip firewall address-list\n" + "".join(
        f"add list=x address=192.0.2.{i}\n" for i in range(1, SAFE_MODE_MAX_ACTIONS + 2)
    )
    proc = _fake_process(["[claude@wAP] > ", "[claude@wAP] <SAFE> "])
    conn = _fake_conn(proc)
    session = SafeModeSession(conn)
    await session.enter()

    with pytest.raises(SafeModeOverflowRisk) as exc:
        await session.import_rsc(rsc, filename="portal-restore.rsc")

    assert str(SAFE_MODE_MAX_ACTIONS) in str(exc.value)


async def test_guard_allows_change_set_at_the_limit():
    rsc = "/ip firewall address-list\n" + "".join(
        f"add list=x address=192.0.2.{i}\n" for i in range(1, SAFE_MODE_MAX_ACTIONS + 1)
    )
    assert count_rsc_actions(rsc) == SAFE_MODE_MAX_ACTIONS

    proc = _fake_process(["[claude@wAP] > ", "[claude@wAP] <SAFE> ", "[claude@wAP] <SAFE> "])
    conn = _fake_conn(proc)
    session = SafeModeSession(conn)
    await session.enter()

    await session.import_rsc(rsc, filename="portal-restore.rsc")
    proc.stdin.write.assert_any_call("/import file=portal-restore.rsc\r")
