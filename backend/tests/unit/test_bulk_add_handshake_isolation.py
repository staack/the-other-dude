"""Bulk adoption must isolate per-device handshake failures.

Onboarding validation now completes a real RouterOS handshake, which is
stricter than the TCP check it replaced: a device with api-ssl and no
certificate, or with wrong credentials, is now rejected. `bulk_add_devices`
calls `create_device` per device, so that stricter check runs for every device
in a subnet adoption.

The requirement: a device that cannot handshake must fail *that device*,
carrying the probe's explanation into `failed[]`, and must not abort the batch.
Adopting 20 routers where one has api-ssl misconfigured must still adopt 19.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException, status

from app.routers import devices as devices_router
from app.schemas.device import BulkAddRequest, DeviceResponse

# The endpoint is wrapped by slowapi's rate limiter, which needs a real
# starlette Request. Unwrap to exercise the handler body itself -- rate
# limiting is not what these tests are about.
bulk_add_devices = devices_router.bulk_add_devices.__wrapped__


CIPHER_ERROR = (
    "TLS handshake failed with 10.0.0.2:8729: no cipher overlap. This device "
    "almost certainly has api-ssl enabled without a certificate, so it offers "
    "only anonymous-DH ciphers, which Go's TLS stack cannot negotiate."
)


def _request() -> MagicMock:
    req = MagicMock()
    req.client.host = "127.0.0.1"
    return req


def _user(tenant_id: uuid.UUID) -> MagicMock:
    user = MagicMock()
    user.tenant_id = tenant_id
    user.user_id = uuid.uuid4()
    user.is_super_admin = False
    return user


def _bulk_request(*ips: str) -> BulkAddRequest:
    return BulkAddRequest(
        devices=[{"ip_address": ip, "hostname": f"r-{ip.replace('.', '-')}"} for ip in ips],
        shared_username="admin",
        shared_password="pw",
    )


async def test_one_unhandshakeable_device_does_not_abort_the_batch():
    """The middle device fails its handshake; the other two must still adopt."""
    tenant_id = uuid.uuid4()

    async def fake_create_device(db, tenant_id, data, encryption_key):
        if data.ip_address == "10.0.0.2":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=CIPHER_ERROR
            )
        return DeviceResponse(
            id=uuid.uuid4(),
            hostname=data.hostname,
            ip_address=data.ip_address,
            api_port=data.api_port,
            api_ssl_port=data.api_ssl_port,
            status="online",
            created_at=datetime.now(timezone.utc),
        )

    with patch.object(devices_router, "_check_tenant_access", AsyncMock()), \
         patch.object(devices_router.device_service, "create_device", fake_create_device), \
         patch.object(devices_router, "log_action", AsyncMock()):
        result = await bulk_add_devices(
            request=_request(),
            tenant_id=tenant_id,
            data=_bulk_request("10.0.0.1", "10.0.0.2", "10.0.0.3"),
            current_user=_user(tenant_id),
            db=AsyncMock(),
        )

    assert len(result.added) == 2, "a single handshake failure aborted the batch"
    assert {d.ip_address for d in result.added} == {"10.0.0.1", "10.0.0.3"}

    assert len(result.failed) == 1
    failure = result.failed[0]
    assert failure["ip_address"] == "10.0.0.2"
    # The probe's diagnosis must reach the user, not be flattened to "failed".
    assert "cipher" in failure["error"].lower()
    assert "api-ssl" in failure["error"].lower()


async def test_devices_after_a_failure_are_still_attempted():
    """Regression guard: the loop must not break early on the first failure."""
    tenant_id = uuid.uuid4()
    attempted: list[str] = []

    async def fake_create_device(db, tenant_id, data, encryption_key):
        attempted.append(data.ip_address)
        raise HTTPException(status_code=422, detail=CIPHER_ERROR)

    with patch.object(devices_router, "_check_tenant_access", AsyncMock()), \
         patch.object(devices_router.device_service, "create_device", fake_create_device), \
         patch.object(devices_router, "log_action", AsyncMock()):
        result = await bulk_add_devices(
            request=_request(),
            tenant_id=tenant_id,
            data=_bulk_request("10.0.0.1", "10.0.0.2", "10.0.0.3"),
            current_user=_user(tenant_id),
            db=AsyncMock(),
        )

    assert attempted == ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
    assert len(result.failed) == 3
    assert result.added == []


# ---------------------------------------------------------------------------
# Incremental commit
#
# get_db commits once, at the end of the request (app/database.py:64). A batch
# that exceeds gunicorn's 120s ceiling (gunicorn.conf.py:18) is therefore
# discarded in full -- including the devices that already adopted. Committing
# per device makes a timeout cost the remainder rather than everything.
#
# The catch: RLS context is set with SET LOCAL, which dies with the
# transaction. Once gone, current_setting('app.current_tenant', true) reads ''
# and the policy predicate is false, so the database refuses the row. Verified
# on real Postgres as app_user: INSERT raises SQLSTATE 42501 ("new row
# violates row-level security policy") while SELECT quietly returns nothing.
# Each commit and each rollback must re-establish the context.
# ---------------------------------------------------------------------------


async def test_each_successful_device_is_committed_as_it_goes():
    tenant_id = uuid.uuid4()
    db = AsyncMock()

    async def fake_create_device(db, tenant_id, data, encryption_key):
        return DeviceResponse(
            id=uuid.uuid4(), hostname=data.hostname, ip_address=data.ip_address,
            api_port=data.api_port, api_ssl_port=data.api_ssl_port,
            status="online", created_at=datetime.now(timezone.utc),
        )

    with patch.object(devices_router, "_check_tenant_access", AsyncMock()), \
         patch.object(devices_router.device_service, "create_device", fake_create_device), \
         patch.object(devices_router, "set_tenant_context", AsyncMock()) as set_ctx, \
         patch.object(devices_router, "log_action", AsyncMock()):
        result = await bulk_add_devices(
            request=_request(), tenant_id=tenant_id,
            data=_bulk_request("10.0.0.1", "10.0.0.2", "10.0.0.3"),
            current_user=_user(tenant_id), db=db,
        )

    assert len(result.added) == 3
    assert db.commit.await_count == 3, "each adopted device should be committed as it goes"
    # SET LOCAL died with each commit, so the context must be re-established.
    assert set_ctx.await_count == 3
    for call in set_ctx.await_args_list:
        assert call.args[1] == str(tenant_id)


async def test_a_failed_device_rolls_back_and_later_devices_still_adopt():
    """Guards a latent bug as well as the new one.

    A failed flush (e.g. a duplicate hostname) poisons the session, so without
    an explicit rollback every device after it fails too -- regardless of the
    handshake work. Rolling back per failure isolates it.
    """
    tenant_id = uuid.uuid4()
    db = AsyncMock()

    async def fake_create_device(db, tenant_id, data, encryption_key):
        if data.ip_address == "10.0.0.1":
            raise HTTPException(status_code=422, detail=CIPHER_ERROR)
        return DeviceResponse(
            id=uuid.uuid4(), hostname=data.hostname, ip_address=data.ip_address,
            api_port=data.api_port, api_ssl_port=data.api_ssl_port,
            status="online", created_at=datetime.now(timezone.utc),
        )

    with patch.object(devices_router, "_check_tenant_access", AsyncMock()), \
         patch.object(devices_router.device_service, "create_device", fake_create_device), \
         patch.object(devices_router, "set_tenant_context", AsyncMock()) as set_ctx, \
         patch.object(devices_router, "log_action", AsyncMock()):
        result = await bulk_add_devices(
            request=_request(), tenant_id=tenant_id,
            data=_bulk_request("10.0.0.1", "10.0.0.2"),
            current_user=_user(tenant_id), db=db,
        )

    assert len(result.failed) == 1
    assert len(result.added) == 1, "the device after a failure must still adopt"
    assert db.rollback.await_count == 1, "a failure must roll back the poisoned transaction"
    # Context re-established after both the rollback and the commit.
    assert set_ctx.await_count == 2
