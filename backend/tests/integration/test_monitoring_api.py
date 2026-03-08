"""
Integration tests for the Monitoring / Metrics API endpoints.

Tests exercise:
- /api/tenants/{tenant_id}/devices/{device_id}/metrics/health
- /api/tenants/{tenant_id}/devices/{device_id}/metrics/interfaces
- /api/tenants/{tenant_id}/devices/{device_id}/metrics/interfaces/list
- /api/tenants/{tenant_id}/devices/{device_id}/metrics/wireless
- /api/tenants/{tenant_id}/devices/{device_id}/metrics/wireless/latest
- /api/tenants/{tenant_id}/devices/{device_id}/metrics/sparkline
- /api/tenants/{tenant_id}/fleet/summary
- /api/fleet/summary (super_admin only)

All tests run against real PostgreSQL+TimescaleDB.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


class TestHealthMetrics:
    """Device health metrics endpoints."""

    async def test_get_device_health_metrics_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET health metrics for a device with no data returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]

        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        now = datetime.now(timezone.utc)
        start = (now - timedelta(hours=1)).isoformat()
        end = now.isoformat()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/metrics/health",
            params={"start": start, "end": end},
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0

    async def test_get_device_health_metrics_with_data(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET health metrics returns bucketed data when rows exist."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.flush()

        # Insert test metric rows directly via admin session
        now = datetime.now(timezone.utc)
        for i in range(5):
            ts = now - timedelta(minutes=i * 5)
            await admin_session.execute(
                text(
                    "INSERT INTO health_metrics "
                    "(device_id, time, cpu_load, free_memory, total_memory, "
                    "free_disk, total_disk, temperature) "
                    "VALUES (:device_id, :ts, :cpu, :free_mem, :total_mem, "
                    ":free_disk, :total_disk, :temp)"
                ),
                {
                    "device_id": str(device.id),
                    "ts": ts,
                    "cpu": 30 + i * 5,
                    "free_mem": 500000000,
                    "total_mem": 1000000000,
                    "free_disk": 200000000,
                    "total_disk": 500000000,
                    "temp": 45,
                },
            )
        await admin_session.commit()

        start = (now - timedelta(hours=1)).isoformat()
        end = now.isoformat()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/metrics/health",
            params={"start": start, "end": end},
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0
        # Each bucket should have expected fields
        for bucket in data:
            assert "bucket" in bucket
            assert "avg_cpu" in bucket


class TestInterfaceMetrics:
    """Interface traffic metrics endpoints."""

    async def test_get_interface_metrics_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET interface metrics for device with no data returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        now = datetime.now(timezone.utc)
        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/metrics/interfaces",
            params={
                "start": (now - timedelta(hours=1)).isoformat(),
                "end": now.isoformat(),
            },
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_get_interface_list_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET interface list for device with no data returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/metrics/interfaces/list",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestSparkline:
    """Sparkline endpoint."""

    async def test_sparkline_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET sparkline for device with no data returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/metrics/sparkline",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestFleetSummary:
    """Fleet summary endpoints."""

    async def test_fleet_summary_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_tenant,
    ):
        """GET /api/tenants/{tenant_id}/fleet/summary returns 200 with empty fleet."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/fleet/summary",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    async def test_fleet_summary_with_devices(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET fleet summary returns device data when devices exist."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]

        await create_test_device(admin_session, tenant.id, hostname="fleet-dev-1")
        await create_test_device(admin_session, tenant.id, hostname="fleet-dev-2")
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/fleet/summary",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 2
        hostnames = [d["hostname"] for d in data]
        assert "fleet-dev-1" in hostnames
        assert "fleet-dev-2" in hostnames

    async def test_fleet_summary_unauthenticated(self, client):
        """GET fleet summary without auth returns 401."""
        tenant_id = str(uuid.uuid4())
        resp = await client.get(f"/api/tenants/{tenant_id}/fleet/summary")
        assert resp.status_code == 401


class TestWirelessMetrics:
    """Wireless metrics endpoints."""

    async def test_wireless_metrics_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET wireless metrics for device with no data returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        now = datetime.now(timezone.utc)
        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/metrics/wireless",
            params={
                "start": (now - timedelta(hours=1)).isoformat(),
                "end": now.isoformat(),
            },
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_wireless_latest_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET wireless latest for device with no data returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/metrics/wireless/latest",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
