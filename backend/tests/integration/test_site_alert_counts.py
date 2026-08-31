"""Site rollups must report real active-alert counts.

The UI renders a red badge when site.alert_count > 0 (SiteTable.tsx:194), but
site_service hardcoded 0, so the badge could never fire.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from app.services import site_service


async def _seed(session, *, firing: int, resolved: int, silenced: int, other_site_firing: int):
    tenant_id = uuid.uuid4()
    site_id = uuid.uuid4()
    other_site_id = uuid.uuid4()
    device_id = uuid.uuid4()
    other_device_id = uuid.uuid4()

    await session.execute(
        text("INSERT INTO tenants (id, name) VALUES (:i, :n)"),
        {"i": tenant_id, "n": f"alert-count-{tenant_id.hex[:8]}"},
    )
    for sid, nm in ((site_id, "site-under-test"), (other_site_id, "other-site")):
        await session.execute(
            text("INSERT INTO sites (id, tenant_id, name) VALUES (:i, :t, :n)"),
            {"i": sid, "t": tenant_id, "n": nm},
        )
    for did, sid, host in (
        (device_id, site_id, "dev-a"),
        (other_device_id, other_site_id, "dev-b"),
    ):
        await session.execute(
            text(
                "INSERT INTO devices (id, tenant_id, site_id, hostname, ip_address)"
                " VALUES (:i, :t, :s, :h, '192.0.2.1')"
            ),
            {"i": did, "t": tenant_id, "s": sid, "h": host},
        )

    async def add_event(dev, status, resolved_at, silenced_until):
        await session.execute(
            text(
                "INSERT INTO alert_events (id, device_id, tenant_id, status, severity,"
                " resolved_at, silenced_until)"
                " VALUES (:i, :d, :t, :st, 'critical', :r, :s)"
            ),
            {
                "i": uuid.uuid4(),
                "d": dev,
                "t": tenant_id,
                "st": status,
                "r": resolved_at,
                "s": silenced_until,
            },
        )

    for _ in range(firing):
        await add_event(device_id, "firing", None, None)
    for _ in range(resolved):
        await add_event(device_id, "resolved", datetime.now(timezone.utc), None)
    for _ in range(silenced):
        await session.execute(
            text(
                "INSERT INTO alert_events (id, device_id, tenant_id, status, severity,"
                " silenced_until) VALUES (:i, :d, :t, 'firing', 'critical', NOW() + INTERVAL '1 hour')"
            ),
            {"i": uuid.uuid4(), "d": device_id, "t": tenant_id},
        )
    for _ in range(other_site_firing):
        await add_event(other_device_id, "firing", None, None)

    await session.commit()
    return tenant_id, site_id


@pytest.mark.asyncio
async def test_get_sites_reports_active_alert_count(admin_session):
    tenant_id, site_id = await _seed(
        admin_session, firing=2, resolved=3, silenced=1, other_site_firing=4
    )

    listing = await site_service.get_sites(admin_session, tenant_id)
    site = next(s for s in listing.sites if s.id == site_id)

    assert site.alert_count == 2, "only firing, unresolved, unsilenced alerts on this site count"


@pytest.mark.asyncio
async def test_get_site_reports_active_alert_count(admin_session):
    tenant_id, site_id = await _seed(
        admin_session, firing=3, resolved=1, silenced=2, other_site_firing=5
    )

    site = await site_service.get_site(admin_session, tenant_id, site_id)

    assert site.alert_count == 3


@pytest.mark.asyncio
async def test_update_site_reports_active_alert_count(admin_session):
    """The response that refreshes the row after an edit must carry the real count."""
    from app.schemas.site import SiteUpdate

    tenant_id, site_id = await _seed(
        admin_session, firing=2, resolved=0, silenced=1, other_site_firing=1
    )

    site = await site_service.update_site(
        admin_session, tenant_id, site_id, SiteUpdate(name="renamed-site")
    )

    assert site.name == "renamed-site"
    assert site.alert_count == 2
