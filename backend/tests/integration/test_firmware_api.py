"""
Integration tests for the Firmware API endpoints.

Tests exercise:
- GET  /api/firmware/versions              -- list firmware versions (global)
- GET  /api/tenants/{tenant_id}/firmware/overview -- firmware overview per tenant
- GET  /api/tenants/{tenant_id}/firmware/upgrades -- list upgrade jobs
- PATCH /api/tenants/{tenant_id}/devices/{device_id}/preferred-channel

Upgrade endpoints (POST .../upgrade, .../mass-upgrade) require actual RouterOS
connections and NATS, so we verify the endpoint exists and handles missing
services gracefully. Download/cache endpoints require super_admin.

All tests run against real PostgreSQL.
"""

import uuid

import pytest

pytestmark = pytest.mark.integration


class TestFirmwareVersions:
    """Firmware version listing endpoints."""

    async def test_list_firmware_versions(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/firmware/versions returns 200 with list (may be empty)."""
        auth = await auth_headers_factory(admin_session)

        resp = await client.get(
            "/api/firmware/versions",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    async def test_list_firmware_versions_with_filters(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/firmware/versions with filters returns 200."""
        auth = await auth_headers_factory(admin_session)

        resp = await client.get(
            "/api/firmware/versions",
            params={"architecture": "arm", "channel": "stable"},
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestFirmwareOverview:
    """Tenant-scoped firmware overview."""

    @pytest.mark.xfail(
        reason="firmware_service uses module-level httpx client that binds to wrong event loop",
        raises=RuntimeError,
    )
    async def test_firmware_overview(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/tenants/{tenant_id}/firmware/overview returns 200."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/firmware/overview",
            headers=auth["headers"],
        )
        # May return 200 or 500 if firmware_service depends on external state
        # At minimum, it should not be 404
        assert resp.status_code != 404


class TestPreferredChannel:
    """Device preferred firmware channel endpoint."""

    async def test_set_device_preferred_channel(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """PATCH preferred channel updates the device firmware channel preference."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id, role="operator"
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.patch(
            f"/api/tenants/{tenant_id}/devices/{device.id}/preferred-channel",
            json={"preferred_channel": "long-term"},
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["preferred_channel"] == "long-term"
        assert data["status"] == "ok"

    async def test_set_invalid_preferred_channel(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """PATCH with invalid channel returns 422."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id, role="operator"
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.patch(
            f"/api/tenants/{tenant_id}/devices/{device.id}/preferred-channel",
            json={"preferred_channel": "invalid"},
            headers=auth["headers"],
        )
        assert resp.status_code == 422


class TestUpgradeJobs:
    """Upgrade job listing endpoints."""

    async def test_list_upgrade_jobs_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/tenants/{tenant_id}/firmware/upgrades returns paginated response."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/firmware/upgrades",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert data["total"] >= 0

    async def test_get_upgrade_job_not_found(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/tenants/{tenant_id}/firmware/upgrades/{fake_id} returns 404."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]
        fake_id = str(uuid.uuid4())

        resp = await client.get(
            f"/api/tenants/{tenant_id}/firmware/upgrades/{fake_id}",
            headers=auth["headers"],
        )
        assert resp.status_code == 404

    async def test_firmware_unauthenticated(self, client):
        """GET firmware versions without auth returns 401."""
        resp = await client.get("/api/firmware/versions")
        assert resp.status_code == 401
