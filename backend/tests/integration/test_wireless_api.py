"""
Integration tests for the Wireless Issues API endpoints.

Tests exercise:
- GET /api/tenants/{tenant_id}/fleet/wireless-issues
- GET /api/fleet/wireless-issues (super_admin)

All tests run against real PostgreSQL+TimescaleDB.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


class TestWirelessIssues:
    """Wireless issues endpoint."""

    async def test_wireless_issues_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_tenant,
    ):
        """GET wireless issues with no wireless data returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(admin_session, existing_tenant_id=tenant.id)
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/fleet/wireless-issues",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) == 0

    async def test_wireless_issues_with_bad_signal(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET wireless issues returns APs with signal worse than -70."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(admin_session, existing_tenant_id=tenant.id)
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id, hostname="bad-signal-ap")
        await admin_session.flush()

        now = datetime.now(timezone.utc)
        await admin_session.execute(
            text(
                "INSERT INTO wireless_metrics "
                "(device_id, tenant_id, time, interface, client_count, avg_signal, ccq, frequency) "
                "VALUES (:device_id, :tenant_id, :ts, :iface, :clients, :signal, :ccq, :freq)"
            ),
            {
                "device_id": str(device.id),
                "tenant_id": str(tenant.id),
                "ts": now,
                "iface": "wlan1",
                "clients": 5,
                "signal": -82,
                "ccq": 45,
                "freq": 5180,
            },
        )
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/fleet/wireless-issues",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["hostname"] == "bad-signal-ap"
        assert "Signal" in data[0]["issue"]

    async def test_wireless_issues_healthy_ap_excluded(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET wireless issues excludes APs with good signal and CCQ."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(admin_session, existing_tenant_id=tenant.id)
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id, hostname="healthy-ap")
        await admin_session.flush()

        now = datetime.now(timezone.utc)
        await admin_session.execute(
            text(
                "INSERT INTO wireless_metrics "
                "(device_id, tenant_id, time, interface, client_count, avg_signal, ccq, frequency) "
                "VALUES (:device_id, :tenant_id, :ts, :iface, :clients, :signal, :ccq, :freq)"
            ),
            {
                "device_id": str(device.id),
                "tenant_id": str(tenant.id),
                "ts": now,
                "iface": "wlan1",
                "clients": 15,
                "signal": -45,
                "ccq": 92,
                "freq": 2412,
            },
        )
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/fleet/wireless-issues",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 0

    async def test_wireless_issues_unauthenticated(self, client):
        """GET wireless issues without auth returns 401."""
        tenant_id = str(uuid.uuid4())
        resp = await client.get(f"/api/tenants/{tenant_id}/fleet/wireless-issues")
        assert resp.status_code == 401


class TestFleetWirelessIssues:
    """Fleet-wide wireless issues (super_admin)."""

    async def test_fleet_wireless_issues_super_admin(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/fleet/wireless-issues returns 200 for super_admin."""
        auth = await auth_headers_factory(admin_session, role="super_admin")

        resp = await client.get(
            "/api/fleet/wireless-issues",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
