"""Real PostgreSQL/app_user regressions for reports #14 and #15."""

import asyncio
import time
import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_db, set_tenant_context
from app.schemas.device import DeviceCreate
from app.services import audit_service, device as device_service, device_probe

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def independent_audit_sessions(monkeypatch, admin_engine):
    # Keep real admin connections on the current test's event loop.
    monkeypatch.setattr(
        "app.database.AdminAsyncSessionLocal",
        async_sessionmaker(admin_engine, expire_on_commit=False),
    )


@pytest.fixture
async def app_user_requests(test_app, app_engine):
    """Keep these request regressions explicitly on the production app_user role."""
    previous = test_app.dependency_overrides[get_db]

    async def sessions():
        async with AsyncSession(app_engine, expire_on_commit=False) as db:
            try:
                yield db
                await db.commit()
            except BaseException:
                await db.rollback()
                raise

    test_app.dependency_overrides[get_db] = sessions
    yield
    test_app.dependency_overrides[get_db] = previous


@pytest.mark.parametrize("role", ["super_admin", "operator"])
async def test_rename_audits_and_releases_device_for_poller(
    client,
    app_user_requests,
    auth_headers_factory,
    admin_session,
    create_test_device,
    monkeypatch,
    role,
):
    monkeypatch.setattr(
        "app.services.crypto.encrypt_data_transit",
        AsyncMock(side_effect=RuntimeError("KMS unavailable")),
    )
    auth = await auth_headers_factory(admin_session, role=role)
    device = await create_test_device(admin_session, uuid.UUID(auth["tenant_id"]))
    await admin_session.commit()
    path = f"/api/tenants/{auth['tenant_id']}/devices/{device.id}"
    for name in ["renamed-first", "renamed-again"]:
        async with asyncio.timeout(3):
            response = await client.put(
                path, json={"hostname": name, "latitude": 42.5}, headers=auth["headers"]
            )
        assert response.status_code == 200
        assert response.json()["hostname"] == name
        assert response.json()["latitude"] == 42.5
        # A separate connection must be able to write the same device now.
        async with asyncio.timeout(3):
            await admin_session.execute(
                text("UPDATE devices SET last_cpu_load=7 WHERE id=:id"), {"id": device.id}
            )
            await admin_session.commit()
    count = await admin_session.scalar(
        text("SELECT count(*) FROM audit_logs WHERE device_id=:id AND action='device_update'"),
        {"id": device.id},
    )
    assert count == 2


async def test_transactional_audit_failure_does_not_abort_edit(
    app_engine,
    admin_session,
    auth_headers_factory,
    create_test_device,
):
    auth = await auth_headers_factory(admin_session)
    device = await create_test_device(admin_session, uuid.UUID(auth["tenant_id"]))
    await admin_session.commit()
    async with AsyncSession(app_engine) as db:
        await set_tenant_context(db, auth["tenant_id"])
        await db.execute(
            text("UPDATE devices SET hostname='saved-despite-audit-error' WHERE id=:id"),
            {"id": device.id},
        )
        # Invalid FK makes the INSERT fail, requiring savepoint rollback.
        await audit_service.log_action(
            db,
            uuid.UUID(auth["tenant_id"]),
            uuid.uuid4(),
            "test_failed_audit",
            device_id=device.id,
            transactional=True,
        )
        await db.commit()
    saved = await admin_session.scalar(
        text("SELECT hostname FROM devices WHERE id=:id"), {"id": device.id}
    )
    assert saved == "saved-despite-audit-error"


async def test_transactional_audit_rolls_back_with_edit(
    app_engine,
    admin_session,
    auth_headers_factory,
    create_test_device,
):
    auth = await auth_headers_factory(admin_session)
    device = await create_test_device(admin_session, uuid.UUID(auth["tenant_id"]))
    await admin_session.commit()
    async with AsyncSession(app_engine) as db:
        await set_tenant_context(db, auth["tenant_id"])
        await db.execute(
            text("UPDATE devices SET hostname='rolled-back-name' WHERE id=:id"), {"id": device.id}
        )
        await audit_service.log_action(
            db,
            uuid.UUID(auth["tenant_id"]),
            uuid.UUID(auth["user_id"]),
            "test_rollback",
            device_id=device.id,
            transactional=True,
        )
        assert (
            await db.scalar(
                text("SELECT count(*) FROM audit_logs WHERE device_id=:id"), {"id": device.id}
            )
            == 1
        )
        await db.rollback()
    assert (
        await admin_session.scalar(
            text("SELECT hostname FROM devices WHERE id=:id"), {"id": device.id}
        )
        == device.hostname
    )
    assert (
        await admin_session.scalar(
            text("SELECT count(*) FROM audit_logs WHERE device_id=:id"), {"id": device.id}
        )
        == 0
    )


async def test_independent_audit_persists_after_caller_commit(
    app_engine,
    admin_session,
    auth_headers_factory,
    create_test_device,
):
    auth = await auth_headers_factory(admin_session)
    device = await create_test_device(admin_session, uuid.UUID(auth["tenant_id"]))
    await admin_session.commit()
    async with AsyncSession(app_engine) as db:
        await db.commit()
        await audit_service.log_action(
            db,
            uuid.UUID(auth["tenant_id"]),
            uuid.UUID(auth["user_id"]),
            "test_after_commit",
            device_id=device.id,
        )
    assert (
        await admin_session.scalar(
            text(
                "SELECT count(*) FROM audit_logs WHERE device_id=:id AND action='test_after_commit'"
            ),
            {"id": device.id},
        )
        == 1
    )


@pytest.mark.parametrize(
    "supplied,identity,available,expected",
    [
        (None, "router-identity", True, "router-identity"),
        ("  ", "router-identity", True, "router-identity"),
        ("operator-name", "router-identity", True, "operator-name"),
        (None, "", True, "192.0.2.7"),
        (None, "unverified-name", False, "192.0.2.7"),
    ],
)
async def test_initial_hostname_saved_from_verified_probe(
    admin_session,
    create_test_tenant,
    monkeypatch,
    supplied,
    identity,
    available,
    expected,
):
    tenant = await create_test_tenant(admin_session)
    probe = device_probe.ProbeOutcome.from_reply({"ok": True, "identity": identity})
    probe.probe_available = available
    monkeypatch.setattr(
        device_service, "validate_routeros_connectivity", AsyncMock(return_value=probe)
    )
    monkeypatch.setattr(
        device_service, "encrypt_credentials_transit", AsyncMock(return_value="vault:v1:test")
    )
    result = await device_service.create_device(
        admin_session,
        tenant.id,
        DeviceCreate(hostname=supplied, ip_address="192.0.2.7", username="test", password="test"),
        b"x" * 32,
    )
    assert result.hostname == expected
    await admin_session.commit()
    assert (
        await admin_session.scalar(
            text("SELECT hostname FROM devices WHERE id=:id"), {"id": result.id}
        )
        == expected
    )


async def test_independent_audit_lock_wait_is_bounded(
    app_engine,
    admin_session,
    auth_headers_factory,
    create_test_device,
):
    auth = await auth_headers_factory(admin_session)
    device = await create_test_device(admin_session, uuid.UUID(auth["tenant_id"]))
    await admin_session.commit()
    async with AsyncSession(app_engine) as db:
        await set_tenant_context(db, auth["tenant_id"])
        await db.execute(
            text("UPDATE devices SET hostname='held-for-audit-test' WHERE id=:id"),
            {"id": device.id},
        )
        started = time.monotonic()
        async with asyncio.timeout(10):
            await audit_service.log_action(
                db,
                uuid.UUID(auth["tenant_id"]),
                uuid.UUID(auth["user_id"]),
                "test_bounded_wait",
                device_id=device.id,
            )
        assert time.monotonic() - started >= 4.5
        await db.commit()
    assert (
        await admin_session.scalar(
            text("SELECT hostname FROM devices WHERE id=:id"), {"id": device.id}
        )
        == "held-for-audit-test"
    )
    assert (
        await admin_session.scalar(
            text("SELECT count(*) FROM audit_logs WHERE device_id=:id"), {"id": device.id}
        )
        == 0
    )


async def test_scanned_bulk_uses_identity_and_preserves_supplied_names(
    client,
    auth_headers_factory,
    admin_session,
    monkeypatch,
):
    auth = await auth_headers_factory(admin_session, role="operator")
    probe = device_probe.ProbeOutcome.from_reply({"ok": True, "identity": "scan-identity"})
    monkeypatch.setattr(
        device_service, "validate_routeros_connectivity", AsyncMock(return_value=probe)
    )
    monkeypatch.setattr(
        device_service, "encrypt_credentials_transit", AsyncMock(return_value="vault:v1:test")
    )
    monkeypatch.setattr(
        "app.services.crypto.encrypt_data_transit",
        AsyncMock(side_effect=RuntimeError("KMS unavailable")),
    )
    response = await client.post(
        f"/api/tenants/{auth['tenant_id']}/devices/bulk-add",
        headers=auth["headers"],
        json={
            "devices": [
                {"ip_address": "192.0.2.10"},
                {"ip_address": "192.0.2.11", "hostname": "chosen-name"},
            ],
            "shared_username": "test",
            "shared_password": "test",
        },
    )
    assert response.status_code == 201
    assert [d["hostname"] for d in response.json()["added"]] == ["scan-identity", "chosen-name"]
    assert response.json()["failed"] == []


async def test_profile_bulk_duplicate_identity_does_not_break_remaining_imports(
    client,
    auth_headers_factory,
    admin_session,
    monkeypatch,
):
    from app.models.credential_profile import CredentialProfile

    auth = await auth_headers_factory(admin_session, role="operator")
    profile = CredentialProfile(
        tenant_id=uuid.UUID(auth["tenant_id"]), name="router-profile", credential_type="routeros"
    )
    admin_session.add(profile)
    await admin_session.commit()
    monkeypatch.setattr(
        device_service, "_decrypt_profile_credentials", AsyncMock(return_value=("test", "test"))
    )
    probe = device_probe.ProbeOutcome.from_reply({"ok": True, "identity": "shared-identity"})
    monkeypatch.setattr(device_probe, "probe_new_device", AsyncMock(return_value=probe))
    monkeypatch.setattr(
        "app.services.crypto.encrypt_data_transit",
        AsyncMock(side_effect=RuntimeError("KMS unavailable")),
    )
    response = await client.post(
        f"/api/tenants/{auth['tenant_id']}/devices/bulk",
        headers=auth["headers"],
        json={
            "credential_profile_id": str(profile.id),
            "devices": [
                {"ip_address": "192.0.2.20"},
                {"ip_address": "192.0.2.21"},
                {"ip_address": "192.0.2.22", "hostname": "explicit-third"},
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["succeeded"] == 2
    assert data["failed"] == 1
    assert [r["success"] for r in data["results"]] == [True, False, True]
    names = (
        (
            await admin_session.execute(
                text("SELECT hostname FROM devices WHERE tenant_id=:tid ORDER BY ip_address"),
                {"tid": uuid.UUID(auth["tenant_id"])},
            )
        )
        .scalars()
        .all()
    )
    assert names == ["shared-identity", "explicit-third"]
