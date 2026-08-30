"""Tests for the Remote WinBox entries in the active-sessions panel.

The panel used to SCAN winbox-remote:{device_id}:* while sessions are actually stored
under winbox-remote:{session_id}, so the pattern could never match and the panel
reported zero remote WinBox sessions even when several were running.
"""

import json
import uuid

from app.routers.remote_access import _winbox_remote_item_for_device

TENANT = uuid.uuid4()
DEVICE = uuid.uuid4()


def record(**overrides) -> str:
    data = {
        "session_id": str(uuid.uuid4()),
        "tenant_id": str(TENANT),
        "device_id": str(DEVICE),
        "user_id": str(uuid.uuid4()),
        "tunnel_id": "tun-1",
        "tunnel_port": 49001,
        "status": "active",
        "created_at": "2026-08-30T12:00:00+00:00",
        "expires_at": "2026-08-30T12:10:00+00:00",
        "max_expires_at": "2026-08-30T14:00:00+00:00",
        "idle_timeout_seconds": 600,
        "max_lifetime_seconds": 7200,
        "xpra_ws_port": 10100,
    }
    data.update(overrides)
    return json.dumps(data)


def test_session_for_this_device_is_returned():
    """The regression: a real record stored under its session_id must be found."""
    item = _winbox_remote_item_for_device(record(), TENANT, DEVICE)

    assert item is not None
    assert item.status.value == "active"


def test_session_for_another_device_is_excluded():
    other = _winbox_remote_item_for_device(record(device_id=str(uuid.uuid4())), TENANT, DEVICE)

    assert other is None


def test_session_for_another_tenant_is_excluded():
    other = _winbox_remote_item_for_device(record(tenant_id=str(uuid.uuid4())), TENANT, DEVICE)

    assert other is None


def test_terminated_session_is_not_listed_as_active():
    assert _winbox_remote_item_for_device(record(status="terminated"), TENANT, DEVICE) is None
    assert _winbox_remote_item_for_device(record(status="failed"), TENANT, DEVICE) is None


def test_creating_and_grace_sessions_are_listed():
    for state in ("creating", "grace"):
        assert _winbox_remote_item_for_device(record(status=state), TENANT, DEVICE) is not None


def test_junk_records_do_not_break_the_panel():
    assert _winbox_remote_item_for_device(None, TENANT, DEVICE) is None
    assert _winbox_remote_item_for_device("", TENANT, DEVICE) is None
    assert _winbox_remote_item_for_device("not json", TENANT, DEVICE) is None
    assert _winbox_remote_item_for_device("[]", TENANT, DEVICE) is None
    # Right device, but missing the fields the response model needs.
    partial = json.dumps({"device_id": str(DEVICE), "tenant_id": str(TENANT), "status": "active"})
    assert _winbox_remote_item_for_device(partial, TENANT, DEVICE) is None
