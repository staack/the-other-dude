"""Unit tests for the RouterOS connectivity probe client and onboarding validation.

The defect under test: onboarding used to accept any device whose TCP port was
open. A RouterOS device with api-ssl enabled and certificate=none offers only
anonymous-DH ciphers, which the Go poller's TLS stack cannot negotiate, so the
device onboarded green and then failed every poll.
"""

import json
from unittest.mock import AsyncMock, patch

import nats.errors
import pytest
from fastapi import HTTPException

from app.services import device_probe


class FakeMsg:
    """Stands in for a nats.aio.msg.Msg reply."""

    def __init__(self, payload: dict):
        self.data = json.dumps(payload).encode()


def _fake_nats(reply_payload: dict) -> AsyncMock:
    nc = AsyncMock()
    nc.request = AsyncMock(return_value=FakeMsg(reply_payload))
    return nc


# ---------------------------------------------------------------------------
# probe_new_device -- the onboarding path
# ---------------------------------------------------------------------------


async def test_probe_new_device_sends_parameters_to_the_adhoc_subject():
    """Onboarding has no stored device, so parameters travel in the request."""
    nc = _fake_nats({"ok": True, "stage": "done", "reason": "ok", "message": "fine",
                     "tls_mode": "auto", "identity": "wAP", "elapsed_ms": 12})

    with patch.object(device_probe, "_get_nats", AsyncMock(return_value=nc)):
        result = await device_probe.probe_new_device(
            ip_address="10.0.0.1",
            api_port=8728,
            api_ssl_port=8729,
            username="admin",
            password="secret",
            tls_mode="auto",
        )

    subject, payload = nc.request.call_args[0][0], json.loads(nc.request.call_args[0][1])
    assert subject == "device.probe.routeros"
    assert payload["ip_address"] == "10.0.0.1"
    assert payload["api_ssl_port"] == 8729
    assert payload["username"] == "admin"
    assert payload["tls_mode"] == "auto"

    assert result.ok is True
    assert result.identity == "wAP"
    assert result.probe_available is True


async def test_probe_new_device_parses_cipher_mismatch_verdict():
    """The classification and the actionable message must survive the round trip."""
    nc = _fake_nats({
        "ok": False,
        "stage": "tls",
        "reason": "tls_cipher_mismatch",
        "message": "TLS handshake failed: no cipher overlap ... try plain mode.",
        "detail": "remote error: tls: handshake failure",
        "tls_mode": "auto",
        "suggested_tls_mode": "plain",
        "elapsed_ms": 232,
    })

    with patch.object(device_probe, "_get_nats", AsyncMock(return_value=nc)):
        result = await device_probe.probe_new_device(
            ip_address="10.101.0.84", api_port=8728, api_ssl_port=8729,
            username="claude", password="claude",
        )

    assert result.ok is False
    assert result.reason == "tls_cipher_mismatch"
    assert result.stage == "tls"
    assert result.suggested_tls_mode == "plain"
    assert "cipher" in result.message.lower()
    assert result.probe_available is True


async def test_probe_reports_unavailable_when_the_poller_does_not_answer():
    """A poller outage must be distinguishable from a device fault."""
    nc = AsyncMock()
    nc.request = AsyncMock(side_effect=nats.errors.TimeoutError())

    with patch.object(device_probe, "_get_nats", AsyncMock(return_value=nc)):
        result = await device_probe.probe_new_device(
            ip_address="10.0.0.1", api_port=8728, api_ssl_port=8729,
            username="admin", password="pw",
        )

    assert result.probe_available is False
    assert result.ok is False
    assert result.reason == "probe_unavailable"


async def test_probe_stored_device_uses_the_device_scoped_subject():
    """A stored device is probed by id so the poller resolves its own credentials."""
    nc = _fake_nats({"ok": True, "stage": "done", "reason": "ok", "message": "fine",
                     "tls_mode": "plain", "elapsed_ms": 8})

    with patch.object(device_probe, "_get_nats", AsyncMock(return_value=nc)):
        result = await device_probe.probe_stored_device("abc-123")

    assert nc.request.call_args[0][0] == "device.probe.stored.abc-123"
    assert result.ok is True
    assert result.tls_mode == "plain"


async def test_probe_surfaces_a_responder_error():
    """A malformed-request or lookup error from the poller is not a device verdict."""
    nc = _fake_nats({"error": "device not found: no rows"})

    with patch.object(device_probe, "_get_nats", AsyncMock(return_value=nc)):
        result = await device_probe.probe_stored_device("missing")

    assert result.ok is False
    assert result.probe_available is False
    assert "device not found" in result.message


# ---------------------------------------------------------------------------
# Onboarding validation -- the behaviour the defect report is about
# ---------------------------------------------------------------------------


def _outcome(**kw) -> device_probe.ProbeOutcome:
    base = dict(
        ok=False, stage="tls", reason="tls_cipher_mismatch",
        message="TLS handshake failed: no cipher overlap "
                "(device has api-ssl enabled without a certificate; try plain mode)",
        detail="remote error: tls: handshake failure",
        tls_mode="auto", suggested_tls_mode="plain",
        identity=None, version=None, board_name=None,
        elapsed_ms=200, probe_available=True,
    )
    base.update(kw)
    return device_probe.ProbeOutcome(**base)


async def test_onboarding_rejects_a_device_that_cannot_complete_a_handshake():
    """The regression: an open port is no longer enough to onboard green."""
    from app.services import device as device_service

    with patch.object(device_probe, "probe_new_device", AsyncMock(return_value=_outcome())):
        with pytest.raises(HTTPException) as exc:
            await device_service.validate_routeros_connectivity(
                ip_address="10.101.0.84", api_port=8728, api_ssl_port=8729,
                username="claude", password="claude", tls_mode="auto",
            )

    assert exc.value.status_code == 422
    detail = str(exc.value.detail)
    # The user must learn the real cause, not "unreachable".
    assert "cipher" in detail.lower()
    assert "plain" in detail.lower()


async def test_onboarding_accepts_a_device_that_completes_a_handshake():
    from app.services import device as device_service

    ok = _outcome(ok=True, stage="done", reason="ok", message="Connected.",
                  identity="wAP", version="7.23.2 (stable)", suggested_tls_mode=None)

    with patch.object(device_probe, "probe_new_device", AsyncMock(return_value=ok)):
        result = await device_service.validate_routeros_connectivity(
            ip_address="10.101.0.84", api_port=8728, api_ssl_port=8729,
            username="claude", password="claude", tls_mode="plain",
        )

    assert result.ok is True
    assert result.identity == "wAP"


async def test_onboarding_reports_an_authentication_failure_as_such():
    """Wrong credentials used to pass validation entirely."""
    from app.services import device as device_service

    bad = _outcome(reason="auth_failed", stage="login", suggested_tls_mode=None,
                   message="Reached 10.0.0.1:8728 but the RouterOS API rejected the login.")

    with patch.object(device_probe, "probe_new_device", AsyncMock(return_value=bad)):
        with pytest.raises(HTTPException) as exc:
            await device_service.validate_routeros_connectivity(
                ip_address="10.0.0.1", api_port=8728, api_ssl_port=8729,
                username="admin", password="wrong", tls_mode="auto",
            )

    assert exc.value.status_code == 422
    assert "rejected the login" in str(exc.value.detail)


async def test_onboarding_falls_back_to_a_tcp_check_when_the_poller_is_down():
    """A poller outage must not make the product unusable for onboarding.

    Degraded mode reproduces the old, weaker check rather than blocking, but
    only when the probe genuinely could not run.
    """
    from app.services import device as device_service

    unavailable = _outcome(probe_available=False, reason="probe_unavailable",
                           message="The poller did not respond.")

    with patch.object(device_probe, "probe_new_device", AsyncMock(return_value=unavailable)):
        with patch.object(device_service, "_tcp_reachable", AsyncMock(return_value=True)):
            result = await device_service.validate_routeros_connectivity(
                ip_address="10.0.0.1", api_port=8728, api_ssl_port=8729,
                username="admin", password="pw", tls_mode="auto",
            )

    assert result.probe_available is False
    assert result.ok is False  # not verified -- the device must not be marked online


async def test_degraded_onboarding_still_rejects_a_closed_port():
    from app.services import device as device_service

    unavailable = _outcome(probe_available=False, reason="probe_unavailable",
                           message="The poller did not respond.")

    with patch.object(device_probe, "probe_new_device", AsyncMock(return_value=unavailable)):
        with patch.object(device_service, "_tcp_reachable", AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc:
                await device_service.validate_routeros_connectivity(
                    ip_address="10.0.0.1", api_port=8728, api_ssl_port=8729,
                    username="admin", password="pw", tls_mode="auto",
                )

    assert exc.value.status_code == 422
