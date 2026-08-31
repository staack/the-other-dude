"""A TLS downgrade is a security event and must be greppable in the audit log.

The adoption wizard offers a one-click "switch to plain and re-test" when the
probe reports a verified plain-mode alternative. That is a legitimate remedy,
but it undoes the deliberate no-plain-text-fallback decision
(poller/internal/device/client.go:101-102) for that device: its RouterOS API
traffic, credentials included, stops being TLS-protected.

Recorded as a distinct action rather than buried in a generic `device_update`
"changes" dict, so it can be alerted on.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import device as device_service


@pytest.mark.parametrize(
    "old,new,expected",
    [
        ("auto", "plain", True),  # the wizard's one-click path
        ("portal_ca", "plain", True),
        ("insecure", "plain", True),
        ("portal_ca", "insecure", True),  # loses certificate verification
        ("portal_ca", "auto", True),  # auto may fall back to no CA check
        ("auto", "portal_ca", False),  # strengthening
        ("plain", "auto", False),
        ("auto", "auto", False),
        ("plain", "plain", False),
    ],
)
def test_tls_downgrade_classification(old, new, expected):
    assert device_service.is_tls_downgrade(old, new) is expected


def test_unknown_tls_mode_is_not_treated_as_a_downgrade():
    """An unrecognised value must not produce a spurious security event."""
    assert device_service.is_tls_downgrade("auto", "nonsense") is False
    assert device_service.is_tls_downgrade("nonsense", "plain") is False


async def test_switching_a_device_to_plain_emits_a_distinct_audit_action():
    from app.routers import devices as devices_router
    from app.schemas.device import DeviceUpdate

    update_device = devices_router.update_device.__wrapped__
    tenant_id = uuid.uuid4()
    device_id = uuid.uuid4()

    before = MagicMock()
    before.tls_mode = "auto"
    after = MagicMock()
    after.tls_mode = "plain"

    user = MagicMock()
    user.tenant_id = tenant_id
    user.user_id = uuid.uuid4()
    user.is_super_admin = False

    request = MagicMock()
    request.client.host = "127.0.0.1"

    with (
        patch.object(devices_router, "_check_tenant_access", AsyncMock()),
        patch.object(devices_router.device_service, "get_device", AsyncMock(return_value=before)),
        patch.object(devices_router.device_service, "update_device", AsyncMock(return_value=after)),
        patch.object(devices_router, "log_action", AsyncMock()) as log,
    ):
        await update_device(
            request=request,
            tenant_id=tenant_id,
            device_id=device_id,
            data=DeviceUpdate(tls_mode="plain"),
            current_user=user,
            db=AsyncMock(),
        )

    actions = [c.args[3] for c in log.await_args_list]
    assert "device_tls_downgrade" in actions, f"expected a downgrade event, got {actions}"

    downgrade = next(c for c in log.await_args_list if c.args[3] == "device_tls_downgrade")
    details = downgrade.kwargs["details"]
    assert details["from"] == "auto"
    assert details["to"] == "plain"
    # The consequence must be legible to whoever reads the log later.
    assert "tls" in details["consequence"].lower()


async def test_strengthening_tls_emits_no_downgrade_event():
    from app.routers import devices as devices_router
    from app.schemas.device import DeviceUpdate

    update_device = devices_router.update_device.__wrapped__
    tenant_id = uuid.uuid4()

    before = MagicMock()
    before.tls_mode = "plain"
    after = MagicMock()
    after.tls_mode = "portal_ca"

    user = MagicMock()
    user.tenant_id = tenant_id
    user.user_id = uuid.uuid4()
    user.is_super_admin = False

    request = MagicMock()
    request.client.host = "127.0.0.1"

    with (
        patch.object(devices_router, "_check_tenant_access", AsyncMock()),
        patch.object(devices_router.device_service, "get_device", AsyncMock(return_value=before)),
        patch.object(devices_router.device_service, "update_device", AsyncMock(return_value=after)),
        patch.object(devices_router, "log_action", AsyncMock()) as log,
    ):
        await update_device(
            request=request,
            tenant_id=tenant_id,
            device_id=uuid.uuid4(),
            data=DeviceUpdate(tls_mode="portal_ca"),
            current_user=user,
            db=AsyncMock(),
        )

    actions = [c.args[3] for c in log.await_args_list]
    assert "device_tls_downgrade" not in actions
