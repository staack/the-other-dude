"""Integration tests for per-tenant VPN network isolation.

Tests subnet allocation, global server key, config generation,
tenant deletion cleanup, and allowed-IPs validation.
"""

import os
import uuid
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select, text

from app.models.vpn import VpnConfig, VpnPeer
from app.services.vpn_service import (
    add_peer,
    get_peer_config,
    get_vpn_config,
    remove_peer,
    setup_vpn,
    sync_wireguard_config,
    _get_wg_config_path,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def wireguard_tmp_dir(tmp_path):
    """Point WireGuard config path to a temp dir for tests."""
    wg_dir = tmp_path / "wireguard"
    wg_dir.mkdir()
    with patch.dict(os.environ, {"WIREGUARD_CONFIG_PATH": str(wg_dir)}):
        yield wg_dir


@pytest.fixture(autouse=True)
def _no_commit_and_sync():
    """Patch _commit_and_sync to a no-op in service calls.

    _commit_and_sync commits the transaction then opens a separate DB session
    to regenerate wg0.conf. In tests, committing breaks transaction rollback
    isolation, and the separate session can't see test data. Patching this
    single function prevents both issues.
    """
    with patch("app.services.vpn_service._commit_and_sync", new_callable=AsyncMock):
        yield


class TestSubnetAllocation:
    @pytest.mark.asyncio
    async def test_first_tenant_gets_index_1(self, admin_session, create_test_tenant):
        tenant = await create_test_tenant(admin_session)
        config = await setup_vpn(admin_session, tenant.id)
        assert config.subnet_index == 1
        assert config.subnet == "10.10.1.0/24"
        assert config.server_address == "10.10.1.1/24"

    @pytest.mark.asyncio
    async def test_second_tenant_gets_index_2(self, admin_session, create_test_tenant):
        t1 = await create_test_tenant(admin_session, name="tenant-a")
        t2 = await create_test_tenant(admin_session, name="tenant-b")
        await setup_vpn(admin_session, t1.id)
        config2 = await setup_vpn(admin_session, t2.id)
        assert config2.subnet_index == 2
        assert config2.subnet == "10.10.2.0/24"

    @pytest.mark.asyncio
    async def test_gap_filling_after_delete(self, admin_session, create_test_tenant):
        t1 = await create_test_tenant(admin_session, name="tenant-gap-a")
        t2 = await create_test_tenant(admin_session, name="tenant-gap-b")
        c1 = await setup_vpn(admin_session, t1.id)
        await setup_vpn(admin_session, t2.id)

        # Delete first tenant's VPN config
        await admin_session.delete(c1)
        await admin_session.flush()

        # New tenant should get index 1 (gap-fill)
        t3 = await create_test_tenant(admin_session, name="tenant-gap-c")
        config3 = await setup_vpn(admin_session, t3.id)
        assert config3.subnet_index == 1

    @pytest.mark.asyncio
    async def test_duplicate_vpn_rejected(self, admin_session, create_test_tenant):
        tenant = await create_test_tenant(admin_session)
        await setup_vpn(admin_session, tenant.id)
        with pytest.raises(ValueError, match="already configured"):
            await setup_vpn(admin_session, tenant.id)


class TestGlobalServerKey:
    @pytest.mark.asyncio
    async def test_both_tenants_share_server_public_key(self, admin_session, create_test_tenant):
        t1 = await create_test_tenant(admin_session, name="key-a")
        t2 = await create_test_tenant(admin_session, name="key-b")
        c1 = await setup_vpn(admin_session, t1.id)
        c2 = await setup_vpn(admin_session, t2.id)
        assert c1.server_public_key == c2.server_public_key
        assert len(c1.server_public_key) == 44  # base64 of 32 bytes


class TestWgConfGeneration:
    """Tests for wg0.conf content.

    Note: sync_wireguard_config is patched to a no-op because it opens its own
    AdminAsyncSessionLocal connection that can't see test transaction data.
    Full wg0.conf generation is validated in staging/E2E tests.
    These tests verify the data model produces correct subnet assignments.
    """

    @pytest.mark.asyncio
    async def test_multi_tenant_subnets_in_config_data(
        self, admin_session, create_test_tenant, create_test_device
    ):
        """Verify VPN configs have distinct subnets that would produce correct wg0.conf."""
        t1 = await create_test_tenant(admin_session, name="conf-a")
        t2 = await create_test_tenant(admin_session, name="conf-b")
        c1 = await setup_vpn(admin_session, t1.id)
        c2 = await setup_vpn(admin_session, t2.id)

        d1 = await create_test_device(admin_session, t1.id)
        d2 = await create_test_device(admin_session, t2.id)
        p1 = await add_peer(admin_session, t1.id, d1.id)
        p2 = await add_peer(admin_session, t2.id, d2.id)

        # Configs have distinct subnets
        assert c1.subnet == "10.10.1.0/24"
        assert c2.subnet == "10.10.2.0/24"
        # Peers are in their tenant's subnet with /32-ready IPs
        assert p1.assigned_ip.startswith("10.10.1.")
        assert p2.assigned_ip.startswith("10.10.2.")
        # Both configs share the global server public key
        assert c1.server_public_key == c2.server_public_key


class TestPeerIsolation:
    @pytest.mark.asyncio
    async def test_peers_get_unique_subnets(
        self, admin_session, create_test_tenant, create_test_device
    ):
        t1 = await create_test_tenant(admin_session, name="iso-a")
        t2 = await create_test_tenant(admin_session, name="iso-b")
        await setup_vpn(admin_session, t1.id)
        await setup_vpn(admin_session, t2.id)

        d1 = await create_test_device(admin_session, t1.id)
        d2 = await create_test_device(admin_session, t2.id)
        p1 = await add_peer(admin_session, t1.id, d1.id)
        p2 = await add_peer(admin_session, t2.id, d2.id)

        # Both get .2 host but in different subnets
        assert p1.assigned_ip.startswith("10.10.1.")
        assert p2.assigned_ip.startswith("10.10.2.")


class TestAllowedIpsValidation:
    @pytest.mark.asyncio
    async def test_vpn_overlap_rejected(
        self, admin_session, create_test_tenant, create_test_device
    ):
        t = await create_test_tenant(admin_session)
        await setup_vpn(admin_session, t.id)
        d = await create_test_device(admin_session, t.id)
        with pytest.raises(ValueError, match="must not overlap"):
            await add_peer(admin_session, t.id, d.id, additional_allowed_ips="10.10.5.0/24")

    @pytest.mark.asyncio
    async def test_non_vpn_subnet_accepted(
        self, admin_session, create_test_tenant, create_test_device
    ):
        t = await create_test_tenant(admin_session)
        await setup_vpn(admin_session, t.id)
        d = await create_test_device(admin_session, t.id)
        peer = await add_peer(admin_session, t.id, d.id, additional_allowed_ips="192.168.1.0/24")
        assert peer.additional_allowed_ips == "192.168.1.0/24"


class TestPeerConfig:
    @pytest.mark.asyncio
    async def test_routeros_commands_use_tenant_subnet(
        self, admin_session, create_test_tenant, create_test_device
    ):
        t = await create_test_tenant(admin_session)
        config = await setup_vpn(admin_session, t.id, endpoint="vpn.example.com:51820")
        d = await create_test_device(admin_session, t.id)
        peer = await add_peer(admin_session, t.id, d.id)

        peer_config = await get_peer_config(admin_session, t.id, peer.id)
        # allowed-address should be tenant-specific subnet, not 10.10.0.0/24
        commands_str = " ".join(peer_config["routeros_commands"])
        assert "10.10.1.0/24" in commands_str
        assert "10.10.0.0/24" not in commands_str
        # Server public key should be the global key
        assert peer_config["server_public_key"] == config.server_public_key


class TestTenantDeletion:
    @pytest.mark.asyncio
    async def test_vpn_config_deleted_with_tenant(
        self, admin_session, create_test_tenant, create_test_device
    ):
        """Verify VPN config and peers are cleaned up when tenant is deleted (CASCADE)."""
        t1 = await create_test_tenant(admin_session, name="keep-svc")
        t2 = await create_test_tenant(admin_session, name="delete-svc")
        await setup_vpn(admin_session, t1.id)
        await setup_vpn(admin_session, t2.id)
        d1 = await create_test_device(admin_session, t1.id)
        d2 = await create_test_device(admin_session, t2.id)
        await add_peer(admin_session, t1.id, d1.id)
        await add_peer(admin_session, t2.id, d2.id)

        # Delete tenant 2
        from app.models.tenant import Tenant
        result = await admin_session.execute(
            select(Tenant).where(Tenant.id == t2.id)
        )
        tenant_obj = result.scalar_one()
        await admin_session.delete(tenant_obj)
        await admin_session.flush()

        # VPN config for deleted tenant should be gone (CASCADE)
        deleted_config = await get_vpn_config(admin_session, t2.id)
        assert deleted_config is None

        # VPN config for kept tenant should still exist
        kept_config = await get_vpn_config(admin_session, t1.id)
        assert kept_config is not None
        assert kept_config.subnet == "10.10.1.0/24"
