"""Tests for RouterOS RSC export parser."""

import pytest
from app.services.rsc_parser import parse_rsc, validate_rsc, compute_impact


SAMPLE_EXPORT = """\
# 2026-03-07 12:00:00 by RouterOS 7.16.2
# software id = ABCD-1234
#
# model = RB750Gr3
/interface bridge
add name=bridge1
/ip address
add address=192.168.88.1/24 interface=ether1 network=192.168.88.0
add address=10.0.0.1/24 interface=bridge1 network=10.0.0.0
/ip firewall filter
add action=accept chain=input comment="allow established" \\
    connection-state=established,related
add action=drop chain=input in-interface-list=WAN
/ip dns
set servers=8.8.8.8,8.8.4.4
/system identity
set name=test-router
"""


class TestParseRsc:
    def test_extracts_categories(self):
        result = parse_rsc(SAMPLE_EXPORT)
        paths = [c["path"] for c in result["categories"]]
        assert "/interface bridge" in paths
        assert "/ip address" in paths
        assert "/ip firewall filter" in paths
        assert "/ip dns" in paths
        assert "/system identity" in paths

    def test_counts_commands_per_category(self):
        result = parse_rsc(SAMPLE_EXPORT)
        cat_map = {c["path"]: c for c in result["categories"]}
        assert cat_map["/ip address"]["adds"] == 2
        assert cat_map["/ip address"]["sets"] == 0
        assert cat_map["/ip firewall filter"]["adds"] == 2
        assert cat_map["/ip dns"]["sets"] == 1
        assert cat_map["/system identity"]["sets"] == 1

    def test_handles_continuation_lines(self):
        result = parse_rsc(SAMPLE_EXPORT)
        cat_map = {c["path"]: c for c in result["categories"]}
        # The firewall filter has a continuation line — should still count as 2 adds
        assert cat_map["/ip firewall filter"]["adds"] == 2

    def test_ignores_comments_and_blank_lines(self):
        result = parse_rsc(SAMPLE_EXPORT)
        # Comments at top should not create categories
        paths = [c["path"] for c in result["categories"]]
        assert "#" not in paths

    def test_empty_input(self):
        result = parse_rsc("")
        assert result["categories"] == []


class TestValidateRsc:
    def test_valid_export_passes(self):
        result = validate_rsc(SAMPLE_EXPORT)
        assert result["valid"] is True
        assert result["errors"] == []

    def test_unbalanced_quotes_detected(self):
        bad = '/system identity\nset name="missing-end-quote\n'
        result = validate_rsc(bad)
        assert result["valid"] is False
        assert any("quote" in e.lower() for e in result["errors"])

    def test_truncated_continuation_detected(self):
        bad = '/ip address\nadd address=192.168.1.1/24 \\\n'
        result = validate_rsc(bad)
        assert result["valid"] is False
        assert any("truncat" in e.lower() or "continuation" in e.lower() for e in result["errors"])


class TestComputeImpact:
    def test_high_risk_for_firewall_input(self):
        current = '/ip firewall filter\nadd action=accept chain=input\n'
        target = '/ip firewall filter\nadd action=drop chain=input\n'
        result = compute_impact(parse_rsc(current), parse_rsc(target))
        assert any(c["risk"] == "high" for c in result["categories"])

    def test_high_risk_for_ip_address_changes(self):
        current = '/ip address\nadd address=192.168.1.1/24 interface=ether1\n'
        target = '/ip address\nadd address=10.0.0.1/24 interface=ether1\n'
        result = compute_impact(parse_rsc(current), parse_rsc(target))
        ip_cat = next(c for c in result["categories"] if c["path"] == "/ip address")
        assert ip_cat["risk"] in ("high", "medium")

    def test_warnings_for_management_access(self):
        current = ""
        target = '/ip firewall filter\nadd action=drop chain=input protocol=tcp dst-port=22\n'
        result = compute_impact(parse_rsc(current), parse_rsc(target))
        assert len(result["warnings"]) > 0

    def test_no_changes_no_warnings(self):
        same = '/ip dns\nset servers=8.8.8.8\n'
        result = compute_impact(parse_rsc(same), parse_rsc(same))
        assert result["warnings"] == [] or all(c["risk"] == "none" for c in result["categories"])
