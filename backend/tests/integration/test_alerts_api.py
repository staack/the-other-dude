"""
Integration tests for the Alerts API endpoints.

Tests exercise:
- GET    /api/tenants/{tenant_id}/alert-rules           -- list rules
- POST   /api/tenants/{tenant_id}/alert-rules           -- create rule
- PUT    /api/tenants/{tenant_id}/alert-rules/{rule_id} -- update rule
- DELETE /api/tenants/{tenant_id}/alert-rules/{rule_id} -- delete rule
- PATCH  /api/tenants/{tenant_id}/alert-rules/{rule_id}/toggle
- GET    /api/tenants/{tenant_id}/alerts                -- list events
- GET    /api/tenants/{tenant_id}/alerts/active-count   -- active count
- GET    /api/tenants/{tenant_id}/devices/{device_id}/alerts -- device alerts

All tests run against real PostgreSQL.
"""

import uuid

import pytest

pytestmark = pytest.mark.integration


VALID_ALERT_RULE = {
    "name": "High CPU Alert",
    "metric": "cpu_load",
    "operator": "gt",
    "threshold": 90.0,
    "duration_polls": 3,
    "severity": "warning",
    "enabled": True,
    "channel_ids": [],
}


class TestAlertRulesCRUD:
    """Alert rules CRUD endpoints."""

    async def test_list_alert_rules_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/tenants/{tenant_id}/alert-rules returns 200 with empty list."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/alert-rules",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    async def test_create_alert_rule(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """POST /api/tenants/{tenant_id}/alert-rules creates a rule."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        rule_data = {**VALID_ALERT_RULE, "name": f"CPU Alert {uuid.uuid4().hex[:6]}"}

        resp = await client.post(
            f"/api/tenants/{tenant_id}/alert-rules",
            json=rule_data,
            headers=auth["headers"],
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == rule_data["name"]
        assert data["metric"] == "cpu_load"
        assert data["operator"] == "gt"
        assert data["threshold"] == 90.0
        assert data["severity"] == "warning"
        assert "id" in data

    async def test_update_alert_rule(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """PUT /api/tenants/{tenant_id}/alert-rules/{rule_id} updates a rule."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        # Create a rule first
        rule_data = {**VALID_ALERT_RULE, "name": f"Update Test {uuid.uuid4().hex[:6]}"}
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/alert-rules",
            json=rule_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        rule_id = create_resp.json()["id"]

        # Update it
        updated_data = {**rule_data, "threshold": 95.0, "severity": "critical"}
        update_resp = await client.put(
            f"/api/tenants/{tenant_id}/alert-rules/{rule_id}",
            json=updated_data,
            headers=auth["headers"],
        )
        assert update_resp.status_code == 200
        data = update_resp.json()
        assert data["threshold"] == 95.0
        assert data["severity"] == "critical"

    async def test_delete_alert_rule(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """DELETE /api/tenants/{tenant_id}/alert-rules/{rule_id} deletes a rule."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        # Create a non-default rule
        rule_data = {**VALID_ALERT_RULE, "name": f"Delete Test {uuid.uuid4().hex[:6]}"}
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/alert-rules",
            json=rule_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        rule_id = create_resp.json()["id"]

        # Delete it
        del_resp = await client.delete(
            f"/api/tenants/{tenant_id}/alert-rules/{rule_id}",
            headers=auth["headers"],
        )
        assert del_resp.status_code == 204

    async def test_toggle_alert_rule(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """PATCH toggle flips the enabled state of a rule."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        # Create a rule (enabled=True)
        rule_data = {**VALID_ALERT_RULE, "name": f"Toggle Test {uuid.uuid4().hex[:6]}"}
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/alert-rules",
            json=rule_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        rule_id = create_resp.json()["id"]

        # Toggle it
        toggle_resp = await client.patch(
            f"/api/tenants/{tenant_id}/alert-rules/{rule_id}/toggle",
            headers=auth["headers"],
        )
        assert toggle_resp.status_code == 200
        data = toggle_resp.json()
        assert data["enabled"] is False  # Was True, toggled to False

    async def test_create_alert_rule_invalid_metric(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """POST with invalid metric returns 422."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        rule_data = {**VALID_ALERT_RULE, "metric": "invalid_metric"}
        resp = await client.post(
            f"/api/tenants/{tenant_id}/alert-rules",
            json=rule_data,
            headers=auth["headers"],
        )
        assert resp.status_code == 422

    async def test_create_alert_rule_viewer_forbidden(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """POST as viewer returns 403."""
        auth = await auth_headers_factory(admin_session, role="viewer")
        tenant_id = auth["tenant_id"]

        resp = await client.post(
            f"/api/tenants/{tenant_id}/alert-rules",
            json=VALID_ALERT_RULE,
            headers=auth["headers"],
        )
        assert resp.status_code == 403


class TestAlertEvents:
    """Alert events listing endpoints."""

    async def test_list_alerts_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/tenants/{tenant_id}/alerts returns 200 with paginated empty response."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/alerts",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 0
        assert isinstance(data["items"], list)

    async def test_active_alert_count(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET active-count returns count of firing alerts."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/alerts/active-count",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "count" in data
        assert isinstance(data["count"], int)
        assert data["count"] >= 0

    async def test_device_alerts_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """GET /api/tenants/{tenant_id}/devices/{device_id}/alerts returns paginated response."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id
        )
        tenant_id = auth["tenant_id"]
        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        resp = await client.get(
            f"/api/tenants/{tenant_id}/devices/{device.id}/alerts",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
