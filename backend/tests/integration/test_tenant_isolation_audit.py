"""Tenant-scoping regressions for users, firmware, alerts, backups and API keys.

Every test here runs against the real database with RLS, as app_user where the
API does, so the checks are exercised at the layer users hit.
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


def _bind_session_factory(monkeypatch, module, admin_engine) -> None:
    """Point a module's AdminAsyncSessionLocal at the test engine (this test's loop)."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    monkeypatch.setattr(
        module,
        "AdminAsyncSessionLocal",
        async_sessionmaker(admin_engine, class_=AsyncSession, expire_on_commit=False),
    )


async def _commit_job_in(admin_session, tenant_id, device_id, status="failed"):
    job_id, group_id = uuid.uuid4(), uuid.uuid4()
    await admin_session.execute(
        text("""
            INSERT INTO firmware_upgrade_jobs
                (id, tenant_id, device_id, rollout_group_id, target_version, architecture,
                 channel, status, confirmed_major_upgrade)
            VALUES (:id, :tenant_id, :device_id, :group_id, '7.20.6', 'arm',
                    'stable', :status, false)
        """),
        {
            "id": job_id,
            "tenant_id": tenant_id,
            "device_id": device_id,
            "group_id": group_id,
            "status": status,
        },
    )
    await admin_session.commit()
    return job_id, group_id


class TestFirmwareJobControl:
    @pytest.mark.parametrize("action", ["cancel", "retry"])
    async def test_job_control_rejects_other_tenants_job(
        self,
        action,
        client,
        auth_headers_factory,
        admin_session,
        create_test_tenant,
        create_test_device,
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        other, foreign = await _commit_device_in(
            admin_session, create_test_tenant, create_test_device
        )
        job_id, _ = await _commit_job_in(
            admin_session,
            other.id,
            foreign.id,
            status="pending" if action == "cancel" else "failed",
        )

        resp = await client.post(
            f"/api/tenants/{auth['tenant_id']}/firmware/upgrades/{job_id}/{action}",
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text
        row = await admin_session.execute(
            text("SELECT status FROM firmware_upgrade_jobs WHERE id = :id"), {"id": job_id}
        )
        assert row.scalar_one() == ("pending" if action == "cancel" else "failed")

    @pytest.mark.parametrize("action", ["resume", "abort"])
    async def test_rollout_control_rejects_other_tenants_rollout(
        self,
        action,
        client,
        auth_headers_factory,
        admin_session,
        create_test_tenant,
        create_test_device,
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        other, foreign = await _commit_device_in(
            admin_session, create_test_tenant, create_test_device
        )
        _, group_id = await _commit_job_in(admin_session, other.id, foreign.id, status="pending")

        resp = await client.post(
            f"/api/tenants/{auth['tenant_id']}/firmware/rollouts/{group_id}/{action}",
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text
        row = await admin_session.execute(
            text("SELECT status FROM firmware_upgrade_jobs WHERE rollout_group_id = :g"),
            {"g": group_id},
        )
        assert row.scalar_one() == "pending"


class TestBackupScheduleOwnership:
    async def test_schedule_override_rejects_other_tenants_device(
        self, client, auth_headers_factory, admin_session, create_test_tenant, create_test_device
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        _, foreign = await _commit_device_in(admin_session, create_test_tenant, create_test_device)

        resp = await client.put(
            f"/api/tenants/{auth['tenant_id']}/devices/{foreign.id}/config/schedules",
            json={"cron_expression": "0 3 * * *", "enabled": False},
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text
        rows = await admin_session.execute(
            text("SELECT count(*) FROM config_backup_schedules WHERE device_id = :d"),
            {"d": foreign.id},
        )
        assert rows.scalar_one() == 0

    async def test_scheduler_ignores_foreign_override(
        self, admin_engine, admin_session, create_test_tenant, create_test_device, monkeypatch
    ):
        """An override row only applies to a device of the same tenant, and a row from
        a different tenant must not shadow the device's own override."""
        from app.services import backup_scheduler

        _bind_session_factory(monkeypatch, backup_scheduler, admin_engine)
        other = await create_test_tenant(admin_session)
        owner = await create_test_tenant(admin_session)
        device = await create_test_device(admin_session, tenant_id=owner.id)
        await admin_session.flush()
        for tenant_id, cron, enabled in (
            (owner.id, "0 3 * * *", True),
            (other.id, "0 0 1 1 *", False),  # inserted last so it would win a device-only index
        ):
            await admin_session.execute(
                text("""
                    INSERT INTO config_backup_schedules (id, tenant_id, device_id, cron_expression, enabled)
                    VALUES (:id, :tenant_id, :device_id, :cron, :enabled)
                """),
                {
                    "id": uuid.uuid4(),
                    "tenant_id": tenant_id,
                    "device_id": device.id,
                    "cron": cron,
                    "enabled": enabled,
                },
            )
        await admin_session.commit()

        effective = await backup_scheduler._load_effective_schedules()

        mine = [e for e in effective if e.device_id == str(device.id)]
        assert len(mine) == 1, "device missing from effective schedules"
        assert mine[0].cron_expression == "0 3 * * *"
        assert mine[0].enabled is True


class TestAlertMutationScopes:
    async def _key_headers(self, admin_engine, admin_session, auth, scopes, monkeypatch):
        from app.services import api_key_service

        _bind_session_factory(monkeypatch, api_key_service, admin_engine)
        key = await api_key_service.create_api_key(
            admin_session, uuid.UUID(auth["tenant_id"]), uuid.UUID(auth["user_id"]), "k", scopes
        )
        return {"Authorization": f"Bearer {key['key']}"}

    async def test_read_only_api_key_cannot_create_rules(
        self, client, auth_headers_factory, admin_engine, admin_session, monkeypatch
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        headers = await self._key_headers(
            admin_engine, admin_session, auth, ["devices:read", "alerts:read"], monkeypatch
        )

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
                "channel_ids": [],
            },
            headers=headers,
        )

        assert resp.status_code == 403, resp.text

    async def test_alerts_write_api_key_can_create_rules(
        self, client, auth_headers_factory, admin_engine, admin_session, monkeypatch
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        headers = await self._key_headers(
            admin_engine, admin_session, auth, ["alerts:write"], monkeypatch
        )

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
                "channel_ids": [],
            },
            headers=headers,
        )

        assert resp.status_code == 201, resp.text


class TestAlertRuleTargets:
    async def test_create_rule_rejects_other_tenants_device(
        self, client, auth_headers_factory, admin_session, create_test_tenant, create_test_device
    ):
        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        _, foreign = await _commit_device_in(admin_session, create_test_tenant, create_test_device)

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
                "channel_ids": [],
                "device_id": str(foreign.id),
            },
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text

    async def test_create_rule_rejects_other_tenants_group(
        self, client, auth_headers_factory, admin_session, create_test_tenant
    ):
        from app.models.device import DeviceGroup

        auth = await auth_headers_factory(admin_session, role="tenant_admin")
        other = await create_test_tenant(admin_session)
        group = DeviceGroup(tenant_id=other.id, name=f"g-{uuid.uuid4().hex[:6]}")
        admin_session.add(group)
        await admin_session.commit()

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
                "channel_ids": [],
                "group_id": str(group.id),
            },
            headers=auth["headers"],
        )

        assert resp.status_code == 404, resp.text


class TestEvaluatorChannelTenant:
    async def test_pre_existing_foreign_link_is_not_delivered(
        self, admin_engine, admin_session, create_test_tenant, monkeypatch
    ):
        """Delivery only follows links whose channel and rule share a tenant."""
        from app.services import alert_evaluator

        _bind_session_factory(monkeypatch, alert_evaluator, admin_engine)
        owner = await create_test_tenant(admin_session)
        other = await create_test_tenant(admin_session)
        await admin_session.commit()
        foreign_channel = await _commit_channel_in(admin_session, owner.id)
        rule_id = uuid.uuid4()
        await admin_session.execute(
            text("""
                INSERT INTO alert_rules
                    (id, tenant_id, name, metric, operator, threshold, duration_polls,
                     severity, enabled)
                VALUES (:id, :tenant_id, 'cpu', 'cpu_load', 'gt', 90, 3, 'warning', true)
            """),
            {"id": rule_id, "tenant_id": other.id},
        )
        await admin_session.execute(
            text("INSERT INTO alert_rule_channels (rule_id, channel_id) VALUES (:r, :c)"),
            {"r": rule_id, "c": foreign_channel},
        )
        await admin_session.commit()

        channels = await alert_evaluator._get_channels_for_rule(str(rule_id))

        assert channels == []
