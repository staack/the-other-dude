"""wg0.conf is derived state and must be rebuildable from the database alone.

A restore onto a fresh host repopulates vpn_config/vpn_peers but leaves no
wg0.conf behind. Until the API regenerated it on startup, that produced a correct
device inventory and a silently dead VPN. These tests cover the mechanism that
recovery depends on; the existing VPN tests patch it out as a no-op.
"""

import uuid

import pytest
from sqlalchemy import text

from app.services.vpn_service import sync_wireguard_config


async def _seed_vpn(session, *, enabled: bool = True) -> str:
    tenant_id = uuid.uuid4()
    device_id = uuid.uuid4()
    peer_public_key = f"pk{uuid.uuid4().hex}"[:44]

    await session.execute(
        text("INSERT INTO tenants (id, name) VALUES (:i, :n)"),
        {"i": tenant_id, "n": f"vpn-regen-{tenant_id.hex[:8]}"},
    )
    await session.execute(
        text(
            "INSERT INTO devices (id, tenant_id, hostname, ip_address)"
            " VALUES (:i, :t, :h, '192.0.2.5')"
        ),
        {"i": device_id, "t": tenant_id, "h": f"dev-{device_id.hex[:6]}"},
    )
    await session.execute(
        text(
            "INSERT INTO vpn_config (id, tenant_id, server_private_key, server_public_key,"
            " subnet_index, subnet, server_address, server_port, is_enabled)"
            " VALUES (:i, :t, :priv, :pub, :idx, '10.99.0.0/24', '10.99.0.1', 51820, :en)"
        ),
        {
            "i": uuid.uuid4(),
            "t": tenant_id,
            "priv": b"server-private-key",
            "pub": "server-public-key",
            "idx": uuid.uuid4().int % 100000,
            "en": enabled,
        },
    )
    await session.execute(
        text(
            "INSERT INTO vpn_peers (id, tenant_id, device_id, peer_private_key,"
            " peer_public_key, assigned_ip)"
            " VALUES (:i, :t, :d, :priv, :pub, '10.99.0.2')"
        ),
        {
            "i": uuid.uuid4(),
            "t": tenant_id,
            "d": device_id,
            "priv": b"peer-private-key",
            "pub": peer_public_key,
        },
    )
    await session.commit()  # sync_wireguard_config opens its own session
    return peer_public_key


@pytest.mark.asyncio
async def test_sync_rebuilds_wg0_conf_from_the_database_alone(admin_session, tmp_path, monkeypatch):
    """The restore case: the database has the peers, the host has no config file.

    Both assertions share one sync call because sync_wireguard_config opens its own
    session against a module-level engine, which binds to the first event loop that
    uses it; a second call from another test's loop fails on engine reuse.
    """
    monkeypatch.setenv("WIREGUARD_CONFIG_PATH", str(tmp_path))
    live_key = await _seed_vpn(admin_session, enabled=True)
    disabled_key = await _seed_vpn(admin_session, enabled=False)

    conf = tmp_path / "wg_confs" / "wg0.conf"
    assert not conf.exists(), "precondition: no config file on a fresh host"

    await sync_wireguard_config()

    assert conf.exists(), "wg0.conf was not regenerated from the database"
    body = conf.read_text()
    assert "[Interface]" in body
    assert live_key in body, "the restored peer is missing from the regenerated config"
    assert disabled_key not in body, "a disabled tenant's peer must not be written"
