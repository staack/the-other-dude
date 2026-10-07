"""Initial naming uses identity only when the operator leaves the name blank."""

from unittest.mock import AsyncMock

import pytest

from app.schemas.device import DeviceCreate
from app.services import device as device_service, device_probe


@pytest.mark.parametrize(
    "supplied,identity,expected",
    [
        (None, "dudley-body", "dudley-body"),
        ("", "dudley-body", "dudley-body"),
        ("  ", "  dudley-body  ", "dudley-body"),
        ("chosen-name", "dudley-body", "chosen-name"),
        (None, None, "192.0.2.1"),
        (None, "  ", "192.0.2.1"),
    ],
)
def test_initial_hostname(supplied, identity, expected):
    assert device_service.initial_hostname(supplied, identity, "192.0.2.1") == expected


def test_hostname_can_be_omitted_from_create_request():
    request = DeviceCreate(ip_address="192.0.2.1", username="test", password="test")
    assert request.hostname is None


async def test_profile_bulk_verdict_retains_identity(monkeypatch):
    outcome = device_probe.ProbeOutcome.from_reply({"ok": True, "identity": "body-router"})
    monkeypatch.setattr(device_probe, "probe_new_device", AsyncMock(return_value=outcome))
    result = await device_service.evaluate_bulk_routeros_device(
        "192.0.2.1", 8728, 8729, "plain", ("test", "test")
    )
    assert result.identity == "body-router"
    assert result.verified
