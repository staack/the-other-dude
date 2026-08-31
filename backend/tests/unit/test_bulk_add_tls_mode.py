"""Unit tests for tls_mode on the bulk-add (device adoption) schemas.

Background: tls_mode is what actually decides how the poller connects. In
"auto" -- the column default -- ConnectDevice tries CA-verified then insecure
TLS on api_ssl_port and explicitly does NOT fall back to plain text. Only
tls_mode="plain" ever uses api_port. So a device adopted for the plain API is
unpollable unless its tls_mode says so, which is why the adoption wizard has to
be able to express the choice.

Pure schema tests -- no database or async required.
"""

import pytest
from pydantic import ValidationError

from app.schemas.device import BulkAddRequest, BulkDeviceAdd


class TestBulkDeviceAddTlsMode:
    """Per-device tls_mode on a bulk-add entry."""

    def test_defaults_to_none(self):
        entry = BulkDeviceAdd(ip_address="10.0.0.1")
        assert entry.tls_mode is None

    @pytest.mark.parametrize("mode", ["auto", "insecure", "plain", "portal_ca"])
    def test_accepts_every_valid_mode(self, mode):
        entry = BulkDeviceAdd(ip_address="10.0.0.1", tls_mode=mode)
        assert entry.tls_mode == mode

    def test_rejects_unknown_mode(self):
        with pytest.raises(ValidationError):
            BulkDeviceAdd(ip_address="10.0.0.1", tls_mode="tls")


class TestBulkAddRequestTlsMode:
    """Shared tls_mode applied to every device in the request."""

    def test_defaults_to_none(self):
        req = BulkAddRequest(devices=[BulkDeviceAdd(ip_address="10.0.0.1")])
        assert req.tls_mode is None

    def test_accepts_valid_mode(self):
        req = BulkAddRequest(
            devices=[BulkDeviceAdd(ip_address="10.0.0.1")], tls_mode="plain"
        )
        assert req.tls_mode == "plain"

    def test_rejects_unknown_mode(self):
        with pytest.raises(ValidationError):
            BulkAddRequest(
                devices=[BulkDeviceAdd(ip_address="10.0.0.1")], tls_mode="nope"
            )


class TestTlsModeResolution:
    """Per-device tls_mode wins over shared, mirroring credential resolution."""

    def test_per_device_overrides_shared(self):
        entry = BulkDeviceAdd(ip_address="10.0.0.1", tls_mode="plain")
        req = BulkAddRequest(devices=[entry], tls_mode="insecure")
        assert req.tls_mode_for(entry) == "plain"

    def test_falls_back_to_shared(self):
        entry = BulkDeviceAdd(ip_address="10.0.0.1")
        req = BulkAddRequest(devices=[entry], tls_mode="plain")
        assert req.tls_mode_for(entry) == "plain"

    def test_defaults_to_auto_when_neither_is_set(self):
        entry = BulkDeviceAdd(ip_address="10.0.0.1")
        req = BulkAddRequest(devices=[entry])
        assert req.tls_mode_for(entry) == "auto"

    def test_auto_is_not_silently_downgraded_to_plain(self):
        # Guards the security property: absent an explicit opt-in, adoption
        # must never produce a plain-text device.
        entry = BulkDeviceAdd(ip_address="10.0.0.1")
        req = BulkAddRequest(devices=[entry])
        assert req.tls_mode_for(entry) != "plain"


class TestDeviceCreateCarriesTlsMode:
    """DeviceCreate is what bulk_add actually hands to create_device.

    Regression: tls_mode was added to the bulk schemas but not to DeviceCreate,
    so the resolved value was silently dropped on the way through and
    create_device raised AttributeError for every device in the batch. Schema
    tests alone did not catch it -- this asserts the field the service reads.
    """

    def test_device_create_accepts_and_exposes_tls_mode(self):
        from app.schemas.device import DeviceCreate

        d = DeviceCreate(
            hostname="r1",
            ip_address="10.0.0.1",
            username="admin",
            password="pw",
            tls_mode="plain",
        )
        assert d.tls_mode == "plain"

    def test_device_create_defaults_tls_mode_to_none(self):
        from app.schemas.device import DeviceCreate

        d = DeviceCreate(
            hostname="r1", ip_address="10.0.0.1", username="admin", password="pw"
        )
        # create_device turns None into "auto"; what matters is the attribute
        # exists, because it reads data.tls_mode unconditionally.
        assert d.tls_mode is None

    def test_device_create_rejects_unknown_tls_mode(self):
        from app.schemas.device import DeviceCreate

        with pytest.raises(ValidationError):
            DeviceCreate(
                hostname="r1",
                ip_address="10.0.0.1",
                username="admin",
                password="pw",
                tls_mode="tls",
            )
