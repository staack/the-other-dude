"""
Integration tests for the Config Templates API endpoints.

Tests exercise:
- GET    /api/tenants/{tenant_id}/templates              -- list templates
- POST   /api/tenants/{tenant_id}/templates              -- create template
- GET    /api/tenants/{tenant_id}/templates/{id}         -- get template
- PUT    /api/tenants/{tenant_id}/templates/{id}         -- update template
- DELETE /api/tenants/{tenant_id}/templates/{id}         -- delete template
- POST   /api/tenants/{tenant_id}/templates/{id}/preview -- preview rendered template

Push endpoints (POST .../push) require actual RouterOS connections, so we
only test the preview endpoint which only needs a database device record.

All tests run against real PostgreSQL.
"""

import uuid

import pytest

pytestmark = pytest.mark.integration

TEMPLATE_CONTENT = """/ip address add address={{ ip_address }}/24 interface=ether1
/system identity set name={{ hostname }}
"""

TEMPLATE_VARIABLES = [
    {"name": "ip_address", "type": "ip", "default": "192.168.1.1"},
    {"name": "hostname", "type": "string", "default": "router"},
]


class TestTemplatesCRUD:
    """Template list, create, get, update, delete endpoints."""

    async def test_list_templates_empty(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/tenants/{tenant_id}/templates returns 200 with empty list."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]

        resp = await client.get(
            f"/api/tenants/{tenant_id}/templates",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    async def test_create_template(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """POST /api/tenants/{tenant_id}/templates creates a template."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        template_data = {
            "name": f"Test Template {uuid.uuid4().hex[:6]}",
            "description": "A test config template",
            "content": TEMPLATE_CONTENT,
            "variables": TEMPLATE_VARIABLES,
            "tags": ["test", "integration"],
        }

        resp = await client.post(
            f"/api/tenants/{tenant_id}/templates",
            json=template_data,
            headers=auth["headers"],
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == template_data["name"]
        assert data["description"] == "A test config template"
        assert "id" in data
        assert "content" in data
        assert data["content"] == TEMPLATE_CONTENT
        assert data["variable_count"] == 2
        assert set(data["tags"]) == {"test", "integration"}

    async def test_get_template(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET /api/tenants/{tenant_id}/templates/{id} returns full template with content."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        # Create first
        create_data = {
            "name": f"Get Test {uuid.uuid4().hex[:6]}",
            "content": TEMPLATE_CONTENT,
            "variables": TEMPLATE_VARIABLES,
            "tags": [],
        }
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/templates",
            json=create_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        template_id = create_resp.json()["id"]

        # Get it
        resp = await client.get(
            f"/api/tenants/{tenant_id}/templates/{template_id}",
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == template_id
        assert data["content"] == TEMPLATE_CONTENT
        assert "variables" in data
        assert len(data["variables"]) == 2

    @pytest.mark.xfail(
        reason="Template tag update fails under RLS — config_template_tags policy needs investigation",
    )
    async def test_update_template(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """PUT /api/tenants/{tenant_id}/templates/{id} updates template content."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        # Create first
        create_data = {
            "name": f"Update Test {uuid.uuid4().hex[:6]}",
            "content": TEMPLATE_CONTENT,
            "variables": TEMPLATE_VARIABLES,
            "tags": ["original"],
        }
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/templates",
            json=create_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        template_id = create_resp.json()["id"]

        # Update it
        updated_content = "/system identity set name={{ hostname }}-updated\n"
        update_data = {
            "name": create_data["name"],
            "content": updated_content,
            "variables": [{"name": "hostname", "type": "string"}],
            "tags": ["updated"],
        }
        resp = await client.put(
            f"/api/tenants/{tenant_id}/templates/{template_id}",
            json=update_data,
            headers=auth["headers"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == updated_content
        assert data["variable_count"] == 1
        assert "updated" in data["tags"]

    async def test_delete_template(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """DELETE /api/tenants/{tenant_id}/templates/{id} removes the template."""
        auth = await auth_headers_factory(admin_session, role="operator")
        tenant_id = auth["tenant_id"]

        # Create first
        create_data = {
            "name": f"Delete Test {uuid.uuid4().hex[:6]}",
            "content": "/system identity set name=test\n",
            "variables": [],
            "tags": [],
        }
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/templates",
            json=create_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        template_id = create_resp.json()["id"]

        # Delete it
        resp = await client.delete(
            f"/api/tenants/{tenant_id}/templates/{template_id}",
            headers=auth["headers"],
        )
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(
            f"/api/tenants/{tenant_id}/templates/{template_id}",
            headers=auth["headers"],
        )
        assert get_resp.status_code == 404

    async def test_get_template_not_found(
        self,
        client,
        auth_headers_factory,
        admin_session,
    ):
        """GET non-existent template returns 404."""
        auth = await auth_headers_factory(admin_session)
        tenant_id = auth["tenant_id"]
        fake_id = str(uuid.uuid4())

        resp = await client.get(
            f"/api/tenants/{tenant_id}/templates/{fake_id}",
            headers=auth["headers"],
        )
        assert resp.status_code == 404


class TestTemplatePreview:
    """Template preview endpoint."""

    async def test_template_preview(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """POST /api/tenants/{tenant_id}/templates/{id}/preview renders template for device."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id, role="operator"
        )
        tenant_id = auth["tenant_id"]

        # Create device for preview context
        device = await create_test_device(
            admin_session, tenant.id, hostname="preview-router", ip_address="10.0.1.1"
        )
        await admin_session.commit()

        # Create template
        template_data = {
            "name": f"Preview Test {uuid.uuid4().hex[:6]}",
            "content": "/system identity set name={{ hostname }}\n",
            "variables": [],
            "tags": [],
        }
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/templates",
            json=template_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        template_id = create_resp.json()["id"]

        # Preview it
        preview_resp = await client.post(
            f"/api/tenants/{tenant_id}/templates/{template_id}/preview",
            json={"device_id": str(device.id), "variables": {}},
            headers=auth["headers"],
        )
        assert preview_resp.status_code == 200
        data = preview_resp.json()
        assert "rendered" in data
        assert "preview-router" in data["rendered"]
        assert data["device_hostname"] == "preview-router"

    async def test_template_preview_with_variables(
        self,
        client,
        auth_headers_factory,
        admin_session,
        create_test_device,
        create_test_tenant,
    ):
        """Preview with custom variables renders them into the template."""
        tenant = await create_test_tenant(admin_session)
        auth = await auth_headers_factory(
            admin_session, existing_tenant_id=tenant.id, role="operator"
        )
        tenant_id = auth["tenant_id"]

        device = await create_test_device(admin_session, tenant.id)
        await admin_session.commit()

        template_data = {
            "name": f"VarPreview {uuid.uuid4().hex[:6]}",
            "content": "/ip address add address={{ custom_ip }}/24 interface=ether1\n",
            "variables": [{"name": "custom_ip", "type": "ip", "default": "192.168.1.1"}],
            "tags": [],
        }
        create_resp = await client.post(
            f"/api/tenants/{tenant_id}/templates",
            json=template_data,
            headers=auth["headers"],
        )
        assert create_resp.status_code == 201
        template_id = create_resp.json()["id"]

        preview_resp = await client.post(
            f"/api/tenants/{tenant_id}/templates/{template_id}/preview",
            json={"device_id": str(device.id), "variables": {"custom_ip": "10.10.10.1"}},
            headers=auth["headers"],
        )
        assert preview_resp.status_code == 200
        data = preview_resp.json()
        assert "10.10.10.1" in data["rendered"]

    async def test_templates_unauthenticated(self, client):
        """GET templates without auth returns 401."""
        tenant_id = str(uuid.uuid4())
        resp = await client.get(f"/api/tenants/{tenant_id}/templates")
        assert resp.status_code == 401
