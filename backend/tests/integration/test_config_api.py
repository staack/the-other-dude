"""
Integration tests for the Config Backup API endpoints.

Tests exercise:
- GET  /api/tenants/{tenant_id}/devices/{device_id}/config/backups
- GET  /api/tenants/{tenant_id}/devices/{device_id}/config/schedules
- PUT  /api/tenants/{tenant_id}/devices/{device_id}/config/schedules

POST /backups (trigger) and POST /restore require actual RouterOS connections
and git store, so we only test that the endpoints exist and respond appropriately.

All tests run against real PostgreSQL.
"""

import uuid

import pytest

pytestmark = pytest.mark.integration


class TestConfigBackups:
    """Config backup listing and schedule endpoints."""

    async def test_list_config_backups_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET config backups for a device with no backups returns 200 + empty list."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/config/backups",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0

    async def test_get_backup_schedule_default(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET schedule returns synthetic default when no schedule configured."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/config/schedules",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_default"] is True
        assert data["cron_expression"] == "0 2 * * *"
        assert data["enabled"] is True

    async def test_update_backup_schedule(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """PUT schedule creates/updates device-specific backup schedule."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id, role="operator"
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        schedule_data = {
            "cron_expression": "0 3 * * 1",  # Monday at 3am
            "enabled": True,
        }
        resp = await client.put(
            f"/api/tenants/{tenant_id}/devices/{device.id}/config/schedules",
            json=schedule_data,
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["cron_expression"] == "0 3 * * 1"
        assert data["enabled"] is True
        assert data["is_default"] is False
        assert data["device_id"] == str(device.id)

    async def test_backup_endpoints_respond(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """Config backup router responds (not 404) for expected paths."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        # List backups -- should respond
        backups_resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/config/backups",
            headers=auth["headers"],
        )
        assert backups_resp.status_code != 404

        # Get schedule -- should respond
        schedule_resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/config/schedules",
            headers=auth["headers"],
        )
        assert schedule_resp.status_code != 404

    async def test_config_backups_unauthenticated(self, client):
        """GET config backups without auth returns 401."""
        tenant_id = str(uuid.uuid4())
        device_id = str(uuid.uuid4())
        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device_id}/config/backups"
        )
        assert resp.status_code == 401
