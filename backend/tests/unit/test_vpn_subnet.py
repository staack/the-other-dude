"""Unit tests for VPN subnet allocation and allowed-IPs validation."""

import pytest
from app.services.vpn_service import _allocate_subnet_index_from_used, _validate_additional_allowed_ips


class TestSubnetAllocation:
    def test_first_allocation_returns_1(self):
        assert _allocate_subnet_index_from_used(set()) == 1

    def test_sequential_allocation(self):
        assert _allocate_subnet_index_from_used({1}) == 2
        assert _allocate_subnet_index_from_used({1, 2}) == 3

    def test_gap_filling(self):
        assert _allocate_subnet_index_from_used({1, 3}) == 2
        assert _allocate_subnet_index_from_used({2, 3}) == 1

    def test_pool_exhausted(self):
        with pytest.raises(ValueError, match="subnet pool exhausted"):
            _allocate_subnet_index_from_used(set(range(1, 256)))

    def test_max_allocation(self):
        used = set(range(1, 255))
        assert _allocate_subnet_index_from_used(used) == 255


class TestAllowedIpsValidation:
    def test_none_is_valid(self):
        _validate_additional_allowed_ips(None)

    def test_empty_is_valid(self):
        _validate_additional_allowed_ips("")

    def test_non_vpn_subnet_is_valid(self):
        _validate_additional_allowed_ips("192.168.1.0/24")

    def test_multiple_non_vpn_subnets_valid(self):
        _validate_additional_allowed_ips("192.168.1.0/24, 172.16.0.0/16")

    def test_vpn_subnet_rejected(self):
        with pytest.raises(ValueError, match="must not overlap"):
            _validate_additional_allowed_ips("10.10.5.0/24")

    def test_vpn_supernet_rejected(self):
        with pytest.raises(ValueError, match="must not overlap"):
            _validate_additional_allowed_ips("10.10.0.0/16")

    def test_vpn_host_rejected(self):
        with pytest.raises(ValueError, match="must not overlap"):
            _validate_additional_allowed_ips("10.10.1.5/32")

    def test_mixed_valid_and_invalid_rejected(self):
        with pytest.raises(ValueError, match="must not overlap"):
            _validate_additional_allowed_ips("192.168.1.0/24, 10.10.2.0/24")
