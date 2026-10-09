"""Verify the API evidence used by the opt-in Operations screen against real RLS."""

import uuid
from datetime import datetime, timezone
from time import perf_counter
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_operations_fleet_contract_and_tenant_boundary(
    client, admin_session, auth_headers_factory, create_test_device, create_test_tenant
):
    auth = await auth_headers_factory(admin_session)
    tenant_id = uuid.UUID(auth["tenant_id"])
    first = await create_test_device(admin_session, tenant_id, hostname="Idle AP")
    first.last_seen = datetime.now(timezone.utc)
    other = await create_test_tenant(admin_session)
    await create_test_device(admin_session, other.id, hostname="Other organization")
    await admin_session.commit()
    response = await client.get(f"/api/tenants/{tenant_id}/fleet/summary", headers=auth["headers"])
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1 and rows[0]["id"] == str(first.id)
    assert rows[0]["client_count"] == 0 and rows[0]["last_seen"] is not None
    denied = await client.get(f"/api/tenants/{other.id}/fleet/summary", headers=auth["headers"])
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_operations_selected_tenant_for_superadmin(
    client, admin_session, auth_headers_factory, create_test_device, create_test_tenant
):
    auth = await auth_headers_factory(admin_session, role="super_admin")
    tenant = await create_test_tenant(admin_session)
    device = await create_test_device(admin_session, tenant.id)
    await create_test_device(admin_session, uuid.UUID(auth["tenant_id"]))
    await admin_session.commit()
    response = await client.get(f"/api/tenants/{tenant.id}/fleet/summary", headers=auth["headers"])
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(device.id)]


@pytest.mark.asyncio
async def test_operations_alert_filters_and_truncation(
    client, admin_session, auth_headers_factory, create_test_device
):
    auth = await auth_headers_factory(admin_session)
    tenant_id = uuid.UUID(auth["tenant_id"])
    device = await create_test_device(admin_session, tenant_id)
    for status, count in [("firing", 201), ("flapping", 1), ("resolved", 1)]:
        await admin_session.execute(
            text(
                "INSERT INTO alert_events (id,tenant_id,device_id,status,severity,value,threshold) VALUES (:id,:t,:d,:s,'warning',0,0)"
            ),
            [
                {"id": uuid.uuid4(), "t": tenant_id, "d": device.id, "s": status}
                for _ in range(count)
            ],
        )
    await admin_session.commit()
    for status, total in [("firing", 201), ("flapping", 1)]:
        response = await client.get(
            f"/api/tenants/{tenant_id}/alerts",
            params={"status": status, "per_page": 200},
            headers=auth["headers"],
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["total"] == total and len(data["items"]) == min(total, 200)
        assert all(a["status"] == status and a["value"] == 0 for a in data["items"])


@pytest.mark.asyncio
async def test_operations_fleet_1000_devices(client, admin_session, auth_headers_factory):
    auth = await auth_headers_factory(admin_session)
    tenant_id = uuid.UUID(auth["tenant_id"])
    await admin_session.execute(
        text(
            "INSERT INTO devices(id,tenant_id,hostname,ip_address,status,last_seen) VALUES (:id,:t,:h,'192.0.2.1','online',NOW())"
        ),
        [{"id": uuid.uuid4(), "t": tenant_id, "h": f"Router {i:04d}"} for i in range(1000)],
    )
    await admin_session.commit()
    times = []
    for _ in range(3):
        start = perf_counter()
        response = await client.get(
            f"/api/tenants/{tenant_id}/fleet/summary", headers=auth["headers"]
        )
        times.append(round((perf_counter() - start) * 1000, 2))
        assert response.status_code == 200 and len(response.json()) == 1000
    print(
        f"Operations 1000-device ASGI request ms (first, repeat, repeat): {times}; bytes: {len(response.content)}"
    )
