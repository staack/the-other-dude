"""Cross-tenant and privilege regressions found by the 2026-10-09 backend audit.

Every test here runs against the real database with RLS, as app_user where the
API does, so a passing test means the leak is closed at the layer users hit.
"""

import uuid

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


async def _commit_device_in(admin_session, create_test_tenant, create_test_device):
    """A device in a brand-new tenant that the caller does not belong to."""
    other = await create_test_tenant(admin_session)
    device = await create_test_device(
        admin_session, tenant_id=other.id, hostname=f"b-{uuid.uuid4().hex[:6]}"
    )
    await admin_session.commit()
    return other, device


async def _commit_channel_in(
    admin_session, tenant_id, slack_url="https://hooks.slack.com/services/T0/B0/secret-token"
):
    channel_id = uuid.uuid4()
    await admin_session.execute(
        text("""
            INSERT INTO notification_channels
                (id, tenant_id, name, channel_type, slack_webhook_url, webhook_url)
            VALUES (:id, :tenant_id, :name, 'slack', :slack, :webhook)
        """),
        {
            "id": channel_id,
            "tenant_id": tenant_id,
            "name": f"ch-{uuid.uuid4().hex[:6]}",
            "slack": slack_url,
            "webhook": "https://example.invalid/hook/secret-token",
        },
    )
    await admin_session.commit()
    return channel_id


class TestRoleEscalation:
    async def test_tenant_admin_cannot_promote_to_super_admin(
        self, client, auth_headers_factory, admin_session
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")

        resp = await client.put(
            f"/api/tenants/{auth['tenant_id']}/users/{auth['user_id']}",
            json={"role": "super_admin"},
            headers=auth["headers"],
        )

        assert resp.status_code == 422, resp.text
        row = await admin_session.execute(
            text("SELECT role FROM users WHERE id = :id"), {"id": uuid.UUID(auth["user_id"])}
        )
        assert row.scalar_one() == "tenant_admin"


class TestFirmwareUpgradeOwnership:
    async def test_single_upgrade_rejects_other_tenants_device(
        self, client, auth_headers_factory, admin_session, create_test_tenant, create_test_device
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        _, foreign = await _commit_device_in(admin_session, create_test_tenant, create_test_device)

        resp = await client.post(
            f"/api/tenants/{auth['tenant_id']}/firmware/upgrade",
            json={
                "device_id": str(foreign.id),
                "target_version": "7.20.6",
                "architecture": "arm",  # supplied, so the old code skipped the device lookup
            },
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text
        jobs = await admin_session.execute(
            text("SELECT count(*) FROM firmware_upgrade_jobs WHERE device_id = :d"),
            {"d": foreign.id},
        )
        assert jobs.scalar_one() == 0

    async def test_mass_upgrade_rejects_other_tenants_device(
        self, client, auth_headers_factory, admin_session, create_test_tenant, create_test_device
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        own = await create_test_device(admin_session, tenant_id=uuid.UUID(auth["tenant_id"]))
        await admin_session.commit()
        _, foreign = await _commit_device_in(admin_session, create_test_tenant, create_test_device)

        resp = await client.post(
            f"/api/tenants/{auth['tenant_id']}/firmware/mass-upgrade",
            json={"device_ids": [str(own.id), str(foreign.id)], "target_version": "7.20.6"},
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text
        jobs = await admin_session.execute(
            text("SELECT count(*) FROM firmware_upgrade_jobs WHERE tenant_id = :t"),
            {"t": uuid.UUID(auth["tenant_id"])},
        )
        assert jobs.scalar_one() == 0, "a rejected batch must not leave partial jobs"


class TestAlertRuleChannelOwnership:
    async def test_create_rule_rejects_other_tenants_channel(
        self, client, auth_headers_factory, admin_session, create_test_tenant
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        other = await create_test_tenant(admin_session)
        await admin_session.commit()
        foreign_channel = await _commit_channel_in(admin_session, other.id)

        resp = await client.post(
            f"/api/tenants/{auth['tenant_id']}/alert-rules",
            json={
                "name": "cpu",
                "metric": "cpu_load",
                "operator": "gt",
                "threshold": 90.0,
                "duration_polls": 3,
                "severity": "warning",
                "enabled": True,
                "channel_ids": [str(foreign_channel)],
            },
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text
        links = await admin_session.execute(
            text("SELECT count(*) FROM alert_rule_channels WHERE channel_id = :c"),
            {"c": foreign_channel},
        )
        assert links.scalar_one() == 0

    async def test_update_rule_rejects_other_tenants_channel(
        self, client, auth_headers_factory, admin_session, create_test_tenant
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        own_channel = await _commit_channel_in(admin_session, uuid.UUID(auth["tenant_id"]))
        other = await create_test_tenant(admin_session)
        await admin_session.commit()
        foreign_channel = await _commit_channel_in(admin_session, other.id)
        rule = {
            "name": "cpu",
            "metric": "cpu_load",
            "operator": "gt",
            "threshold": 90.0,
            "duration_polls": 3,
            "severity": "warning",
            "enabled": True,
            "channel_ids": [str(own_channel)],
        }
        created = await client.post(
            f"/api/tenants/{auth['tenant_id']}/alert-rules", json=rule, headers=auth["headers"]
        )
        assert created.status_code in (200, 201), created.text
        rule_id = created.json()["id"]

        resp = await client.put(
            f"/api/tenants/{auth['tenant_id']}/alert-rules/{rule_id}",
            json={**rule, "channel_ids": [str(foreign_channel)]},
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text
        links = await admin_session.execute(
            text("SELECT channel_id FROM alert_rule_channels WHERE rule_id = :r"),
            {"r": uuid.UUID(rule_id)},
        )
        assert [row[0] for row in links.fetchall()] == [own_channel], (
            "a rejected update must leave the previous associations intact"
        )


class TestApiKeyOwner:
    async def test_api_key_of_deactivated_user_is_rejected(
        self, admin_engine, admin_session, create_test_tenant, create_test_user, monkeypatch
    ):
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

        from app.services import api_key_service
        from app.services.api_key_service import create_api_key, validate_api_key

        # validate_api_key opens its own admin session; bind that factory to
        # the test engine so it runs on this test's event loop.
        monkeypatch.setattr(
            api_key_service,
            "AdminAsyncSessionLocal",
            async_sessionmaker(admin_engine, class_=AsyncSession, expire_on_commit=False),
        )

        tenant = await create_test_tenant(admin_session)
        user = await create_test_user(admin_session, tenant_id=tenant.id)
        await admin_session.commit()
        key = await create_api_key(admin_session, tenant.id, user.id, "ci", ["devices:read"])

        assert await validate_api_key(key["key"]) is not None

        user.is_active = False
        await admin_session.commit()

        assert await validate_api_key(key["key"]) is None


class TestWebhookSecrets:
    async def test_viewer_does_not_receive_webhook_urls(
        self, client, auth_headers_factory, admin_session
    ):
        admin = await auth_headers_factory(admin_session, role="tenant_admin")
        secret = "https://hooks.slack.com/services/T0/B0/very-secret-token"
        await _commit_channel_in(admin_session, uuid.UUID(admin["tenant_id"]), slack_url=secret)
        viewer = await auth_headers_factory(
            admin_session, role="viewer", existing_tenant_id=uuid.UUID(admin["tenant_id"])
        )

        resp = await client.get(
            f"/api/tenants/{admin['tenant_id']}/notification-channels",
            headers=viewer["headers"],
        )

        assert resp.status_code == 200, resp.text
        body = resp.text
        assert "very-secret-token" not in body
        assert "hook/secret-token" not in body

    async def test_admin_still_receives_webhook_urls(
        self, client, auth_headers_factory, admin_session
    ):
        admin = await auth_headers_factory(admin_session, role="tenant_admin")
        secret = "https://hooks.slack.com/services/T0/B0/very-secret-token"
        await _commit_channel_in(admin_session, uuid.UUID(admin["tenant_id"]), slack_url=secret)

        resp = await client.get(
            f"/api/tenants/{admin['tenant_id']}/notification-channels",
            headers=admin["headers"],
        )

        assert resp.status_code == 200
        assert any(ch.get("slack_webhook_url") == secret for ch in resp.json())
