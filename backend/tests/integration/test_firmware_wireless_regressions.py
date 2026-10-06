"""Database/API regressions for idle wireless radios and suffixed firmware versions."""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

pytestmark = pytest.mark.integration


async def test_firmware_suffix_is_current_via_api(
    client,
    admin_session,
    admin_engine,
    create_test_tenant,
    create_test_device,
    auth_headers_factory,
    monkeypatch,
):
    from app.services import firmware_service

    monkeypatch.setattr(
        firmware_service, "AdminAsyncSessionLocal", async_sessionmaker(admin_engine)
    )
    tenant = await create_test_tenant(admin_session)
    auth = await auth_headers_factory(admin_session, existing_tenant_id=tenant.id)
    device = await create_test_device(admin_session, tenant.id)
    device.routeros_version = "7.24.5 (stable)"
    device.architecture = "arm64"
    device.preferred_channel = "stable"
    firmware_id = uuid.uuid4()
    await admin_session.execute(
        text("""
        INSERT INTO firmware_versions (id, architecture, channel, version, npk_url, checked_at)
        VALUES (:id, 'arm64', 'stable', '7.24.5', 'https://example.invalid/test.npk', NOW())
    """),
        {"id": firmware_id},
    )
    await admin_session.commit()
    try:
        response = await client.get(
            f"/api/tenants/{tenant.id}/firmware/overview", headers=auth["headers"]
        )
        assert response.status_code == 200
        result = response.json()
        assert result["summary"] == {"total": 1, "up_to_date": 1, "outdated": 0, "unknown": 0}
        assert result["devices"][0]["routeros_version"] == "7.24.5"
        assert result["version_groups"][0]["is_latest"] is True
    finally:
        await admin_session.execute(
            text("DELETE FROM firmware_versions WHERE id=:id"), {"id": firmware_id}
        )
        await admin_session.commit()


async def test_idle_radio_reaches_wireless_api_without_false_quality_alert(
    client,
    admin_session,
    create_test_tenant,
    create_test_device,
    auth_headers_factory,
):
    from app.services.metrics_subscriber import _insert_wireless_metrics

    tenant = await create_test_tenant(admin_session)
    auth = await auth_headers_factory(admin_session, existing_tenant_id=tenant.id)
    device = await create_test_device(admin_session, tenant.id)
    await admin_session.flush()
    await _insert_wireless_metrics(
        admin_session,
        {
            "tenant_id": str(tenant.id),
            "device_id": str(device.id),
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "wireless": [
                {"interface": "wifi1", "client_count": 0, "avg_signal": 0, "ccq": 0, "frequency": 0}
            ],
        },
    )
    await admin_session.commit()
    response = await client.get(
        f"/api/tenants/{tenant.id}/devices/{device.id}/metrics/wireless/latest",
        headers=auth["headers"],
    )
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["interface"] == "wifi1" and rows[0]["client_count"] == 0
    assert rows[0]["avg_signal"] is None and rows[0]["ccq"] is None
    response = await client.get(
        f"/api/tenants/{tenant.id}/fleet/wireless-issues", headers=auth["headers"]
    )
    assert response.status_code == 200 and response.json() == []
