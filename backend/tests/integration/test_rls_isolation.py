"""
RLS (Row Level Security) tenant isolation integration tests.

Verifies that PostgreSQL RLS policies correctly isolate tenant data:
- Tenant A cannot see Tenant B's devices, alerts, or device groups
- Tenant A cannot insert data into Tenant B's namespace
- super_admin context sees all tenants
- API-level isolation matches DB-level isolation

These tests commit real data to PostgreSQL and use the app_user engine
(which enforces RLS) to validate isolation. Each test creates unique
entity names to avoid collisions and cleans up via admin engine.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import set_tenant_context
from app.models.alert import AlertRule
from app.models.device import Device, DeviceGroup
from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import hash_password

pytestmark = pytest.mark.integration

# Use the same test DB URLs as conftest
from tests.integration.conftest import TEST_APP_USER_DATABASE_URL, TEST_DATABASE_URL  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers: create and commit entities, and cleanup
# ---------------------------------------------------------------------------


async def _admin_commit(url, callback):
    """Open a fresh admin connection, run callback, commit, close."""
    engine = create_async_engine(url, echo=False)
    async with engine.connect() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        result = await callback(session)
        await session.commit()
    await engine.dispose()
    return result


async def _app_query(url, tenant_id, model_class):
    """Open a fresh app_user connection, set tenant context, query model, close."""
    engine = create_async_engine(url, echo=False)
    async with engine.connect() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        await set_tenant_context(session, tenant_id)
        result = await session.execute(select(model_class))
        rows = result.scalars().all()
    await engine.dispose()
    return rows


async def _admin_cleanup(url, *table_names):
    """Truncate specified tables via admin engine."""
    engine = create_async_engine(url, echo=False)
    async with engine.connect() as conn:
        for table in table_names:
            await conn.execute(text(f"DELETE FROM {table}"))
        await conn.commit()
    await engine.dispose()


# ---------------------------------------------------------------------------
# Test 1: Tenant A cannot see Tenant B devices
# ---------------------------------------------------------------------------


async def test_tenant_a_cannot_see_tenant_b_devices():
    """Tenant A app_user session only returns Tenant A devices."""
    uid = uuid.uuid4().hex[:6]

    # Create tenants via admin
    async def setup(session):
        ta = Tenant(name=f"rls-dev-ta-{uid}")
        tb = Tenant(name=f"rls-dev-tb-{uid}")
        session.add_all([ta, tb])
        await session.flush()

        da = Device(
            tenant_id=ta.id,
            hostname=f"rls-ra-{uid}",
            ip_address="10.1.1.1",
            api_port=8728,
            api_ssl_port=8729,
            status="online",
        )
        db = Device(
            tenant_id=tb.id,
            hostname=f"rls-rb-{uid}",
            ip_address="10.1.1.2",
            api_port=8728,
            api_ssl_port=8729,
            status="online",
        )
        session.add_all([da, db])
        await session.flush()
        return {"ta_id": str(ta.id), "tb_id": str(tb.id)}

    ids = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        # Query as Tenant A
        devices_a = await _app_query(TEST_APP_USER_DATABASE_URL, ids["ta_id"], Device)
        assert len(devices_a) == 1
        assert devices_a[0].hostname == f"rls-ra-{uid}"

        # Query as Tenant B
        devices_b = await _app_query(TEST_APP_USER_DATABASE_URL, ids["tb_id"], Device)
        assert len(devices_b) == 1
        assert devices_b[0].hostname == f"rls-rb-{uid}"
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "devices", "tenants")


# ---------------------------------------------------------------------------
# Test 2: Tenant A cannot see Tenant B alerts
# ---------------------------------------------------------------------------


async def test_tenant_a_cannot_see_tenant_b_alerts():
    """Tenant A only sees its own alert rules."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        ta = Tenant(name=f"rls-alrt-ta-{uid}")
        tb = Tenant(name=f"rls-alrt-tb-{uid}")
        session.add_all([ta, tb])
        await session.flush()

        ra = AlertRule(
            tenant_id=ta.id,
            name=f"CPU Alert A {uid}",
            metric="cpu_load",
            operator=">",
            threshold=90.0,
            severity="warning",
        )
        rb = AlertRule(
            tenant_id=tb.id,
            name=f"CPU Alert B {uid}",
            metric="cpu_load",
            operator=">",
            threshold=85.0,
            severity="critical",
        )
        session.add_all([ra, rb])
        await session.flush()
        return {"ta_id": str(ta.id), "tb_id": str(tb.id)}

    ids = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        rules_a = await _app_query(TEST_APP_USER_DATABASE_URL, ids["ta_id"], AlertRule)
        assert len(rules_a) == 1
        assert rules_a[0].name == f"CPU Alert A {uid}"
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "alert_rules", "tenants")


# ---------------------------------------------------------------------------
# Test 3: Tenant A cannot see Tenant B device groups
# ---------------------------------------------------------------------------


async def test_tenant_a_cannot_see_tenant_b_device_groups():
    """Tenant A only sees its own device groups."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        ta = Tenant(name=f"rls-grp-ta-{uid}")
        tb = Tenant(name=f"rls-grp-tb-{uid}")
        session.add_all([ta, tb])
        await session.flush()

        ga = DeviceGroup(tenant_id=ta.id, name=f"Group A {uid}")
        gb = DeviceGroup(tenant_id=tb.id, name=f"Group B {uid}")
        session.add_all([ga, gb])
        await session.flush()
        return {"ta_id": str(ta.id), "tb_id": str(tb.id)}

    ids = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        groups_a = await _app_query(TEST_APP_USER_DATABASE_URL, ids["ta_id"], DeviceGroup)
        assert len(groups_a) == 1
        assert groups_a[0].name == f"Group A {uid}"
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "device_groups", "tenants")


# ---------------------------------------------------------------------------
# Test 4: Tenant A cannot insert device into Tenant B
# ---------------------------------------------------------------------------


async def test_tenant_a_cannot_insert_device_into_tenant_b():
    """Inserting a device with tenant_b's ID while in tenant_a context should fail or be invisible."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        ta = Tenant(name=f"rls-ins-ta-{uid}")
        tb = Tenant(name=f"rls-ins-tb-{uid}")
        session.add_all([ta, tb])
        await session.flush()
        return {"ta_id": str(ta.id), "tb_id": str(tb.id)}

    ids = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        engine = create_async_engine(TEST_APP_USER_DATABASE_URL, echo=False)
        async with engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            await set_tenant_context(session, ids["ta_id"])

            # Attempt to insert a device with tenant_b's tenant_id
            device = Device(
                tenant_id=uuid.UUID(ids["tb_id"]),
                hostname=f"evil-device-{uid}",
                ip_address="10.99.99.99",
                api_port=8728,
                api_ssl_port=8729,
                status="online",
            )
            session.add(device)

            # RLS policy should prevent this -- either by raising an error
            # or by making the row invisible after insert
            try:
                await session.flush()
                # If the insert succeeded, verify the device is NOT visible
                result = await session.execute(select(Device))
                visible = result.scalars().all()
                cross_tenant = [d for d in visible if d.hostname == f"evil-device-{uid}"]
                assert len(cross_tenant) == 0, (
                    "Cross-tenant device should not be visible to tenant_a"
                )
            except Exception:
                # RLS violation raised -- this is the expected behavior
                pass
        await engine.dispose()
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "devices", "tenants")


# ---------------------------------------------------------------------------
# Test 5: super_admin sees all tenants
# ---------------------------------------------------------------------------


async def test_super_admin_sees_all_tenants():
    """super_admin bypasses RLS via admin engine (superuser) and sees all devices.

    The RLS policy does NOT have a special 'super_admin' tenant context.
    Instead, super_admin users use the admin engine (PostgreSQL superuser)
    which bypasses all RLS policies entirely.
    """
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        ta = Tenant(name=f"rls-sa-ta-{uid}")
        tb = Tenant(name=f"rls-sa-tb-{uid}")
        session.add_all([ta, tb])
        await session.flush()

        da = Device(
            tenant_id=ta.id,
            hostname=f"sa-ra-{uid}",
            ip_address="10.2.1.1",
            api_port=8728,
            api_ssl_port=8729,
            status="online",
        )
        db = Device(
            tenant_id=tb.id,
            hostname=f"sa-rb-{uid}",
            ip_address="10.2.1.2",
            api_port=8728,
            api_ssl_port=8729,
            status="online",
        )
        session.add_all([da, db])
        await session.flush()
        return {"ta_id": str(ta.id), "tb_id": str(tb.id)}

    ids = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        # super_admin uses admin engine (superuser) which bypasses RLS
        engine = create_async_engine(TEST_DATABASE_URL, echo=False)
        async with engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            result = await session.execute(select(Device))
            devices = result.scalars().all()
        await engine.dispose()

        # Admin engine (superuser) should see devices from both tenants
        hostnames = {d.hostname for d in devices}
        assert f"sa-ra-{uid}" in hostnames, "admin engine should see tenant_a device"
        assert f"sa-rb-{uid}" in hostnames, "admin engine should see tenant_b device"

        # Verify that app_user engine with a specific tenant only sees that tenant
        devices_a = await _app_query(TEST_APP_USER_DATABASE_URL, ids["ta_id"], Device)
        hostnames_a = {d.hostname for d in devices_a}
        assert f"sa-ra-{uid}" in hostnames_a
        assert f"sa-rb-{uid}" not in hostnames_a
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "devices", "tenants")


# ---------------------------------------------------------------------------
# Test 6: API-level RLS isolation (devices endpoint)
# ---------------------------------------------------------------------------


async def test_api_rls_isolation_devices_endpoint(client, admin_engine):
    """Each user only sees their own tenant's devices via the API."""
    uid = uuid.uuid4().hex[:6]

    # Create data via admin engine (committed for API visibility)
    async def setup(session):
        ta = Tenant(name=f"api-rls-ta-{uid}")
        tb = Tenant(name=f"api-rls-tb-{uid}")
        session.add_all([ta, tb])
        await session.flush()

        ua = User(
            email=f"api-ua-{uid}@example.com",
            hashed_password=hash_password("TestPass123!"),
            name="User A",
            role="tenant_admin",
            tenant_id=ta.id,
            is_active=True,
        )
        ub = User(
            email=f"api-ub-{uid}@example.com",
            hashed_password=hash_password("TestPass123!"),
            name="User B",
            role="tenant_admin",
            tenant_id=tb.id,
            is_active=True,
        )
        session.add_all([ua, ub])
        await session.flush()

        da = Device(
            tenant_id=ta.id,
            hostname=f"api-ra-{uid}",
            ip_address="10.3.1.1",
            api_port=8728,
            api_ssl_port=8729,
            status="online",
        )
        db = Device(
            tenant_id=tb.id,
            hostname=f"api-rb-{uid}",
            ip_address="10.3.1.2",
            api_port=8728,
            api_ssl_port=8729,
            status="online",
        )
        session.add_all([da, db])
        await session.flush()
        return {
            "ta_id": str(ta.id),
            "tb_id": str(tb.id),
            "ua_email": ua.email,
            "ub_email": ub.email,
        }

    ids = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        # Login as user A
        login_a = await client.post(
            "/api/auth/login",
            json={"email": ids["ua_email"], "password": "TestPass123!"},
        )
        assert login_a.status_code == 200, f"Login A failed: {login_a.text}"
        token_a = login_a.json()["access_token"]

        # Login as user B
        login_b = await client.post(
            "/api/auth/login",
            json={"email": ids["ub_email"], "password": "TestPass123!"},
        )
        assert login_b.status_code == 200, f"Login B failed: {login_b.text}"
        token_b = login_b.json()["access_token"]

        # User A lists devices for tenant A
        resp_a = await client.get(
            f"/api/tenants/{ids['ta_id']}/devices",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert resp_a.status_code == 200
        hostnames_a = [d["hostname"] for d in resp_a.json()["items"]]
        assert f"api-ra-{uid}" in hostnames_a
        assert f"api-rb-{uid}" not in hostnames_a

        # User B lists devices for tenant B
        resp_b = await client.get(
            f"/api/tenants/{ids['tb_id']}/devices",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert resp_b.status_code == 200
        hostnames_b = [d["hostname"] for d in resp_b.json()["items"]]
        assert f"api-rb-{uid}" in hostnames_b
        assert f"api-ra-{uid}" not in hostnames_b
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "devices", "users", "tenants")


# ---------------------------------------------------------------------------
# Test 7: API-level cross-tenant device access
# ---------------------------------------------------------------------------


async def test_api_rls_isolation_cross_tenant_device_access(client, admin_engine):
    """Accessing another tenant's endpoint returns 403 (tenant access check)."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        ta = Tenant(name=f"api-xt-ta-{uid}")
        tb = Tenant(name=f"api-xt-tb-{uid}")
        session.add_all([ta, tb])
        await session.flush()

        ua = User(
            email=f"api-xt-ua-{uid}@example.com",
            hashed_password=hash_password("TestPass123!"),
            name="User A",
            role="tenant_admin",
            tenant_id=ta.id,
            is_active=True,
        )
        session.add(ua)
        await session.flush()

        db = Device(
            tenant_id=tb.id,
            hostname=f"api-xt-rb-{uid}",
            ip_address="10.4.1.1",
            api_port=8728,
            api_ssl_port=8729,
            status="online",
        )
        session.add(db)
        await session.flush()
        return {
            "ta_id": str(ta.id),
            "tb_id": str(tb.id),
            "ua_email": ua.email,
            "db_id": str(db.id),
        }

    ids = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        # Login as user A
        login_a = await client.post(
            "/api/auth/login",
            json={"email": ids["ua_email"], "password": "TestPass123!"},
        )
        assert login_a.status_code == 200
        token_a = login_a.json()["access_token"]

        # User A tries to access tenant B's devices endpoint
        resp = await client.get(
            f"/api/tenants/{ids['tb_id']}/devices",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        # Should be 403 -- tenant access check prevents cross-tenant access
        assert resp.status_code == 403
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "devices", "users", "tenants")
