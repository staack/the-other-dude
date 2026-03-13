"""Tests for config change parser.

Tests the parse_diff_changes function that extracts structured RouterOS
component changes from unified diffs.
"""

import pytest

from app.services.config_change_parser import parse_diff_changes


class TestParseDiffChanges:
    """Tests for parse_diff_changes()."""

    def test_firewall_filter_additions(self):
        """Test 1: Diff with additions under /ip firewall filter produces correct component and summary."""
        diff_text = (
            "--- a/config\n"
            "+++ b/config\n"
            "@@ -1,3 +1,5 @@\n"
            " /ip firewall filter\n"
            " add chain=input action=accept\n"
            "+add chain=forward action=accept protocol=tcp dst-port=80\n"
            "+add chain=forward action=accept protocol=tcp dst-port=443\n"
        )
        changes = parse_diff_changes(diff_text)
        assert len(changes) == 1
        assert changes[0]["component"] == "ip/firewall/filter"
        assert "Added" in changes[0]["summary"]
        assert "2" in changes[0]["summary"]
        assert changes[0]["raw_line"] is not None

    def test_multiple_sections(self):
        """Test 2: Diff with changes under multiple sections produces two change entries."""
        diff_text = (
            "--- a/config\n"
            "+++ b/config\n"
            "@@ -1,4 +1,6 @@\n"
            " /ip address\n"
            "+add address=10.0.0.1/24 interface=ether1\n"
            " /ip dns\n"
            "+set servers=8.8.8.8,8.8.4.4\n"
        )
        changes = parse_diff_changes(diff_text)
        assert len(changes) == 2
        components = [c["component"] for c in changes]
        assert "ip/address" in components
        assert "ip/dns" in components

    def test_removals_only(self):
        """Test 3: Diff with only removals produces summary like 'Removed 1 NAT rule'."""
        diff_text = (
            "--- a/config\n"
            "+++ b/config\n"
            "@@ -1,3 +1,2 @@\n"
            " /ip firewall nat\n"
            " add chain=srcnat action=masquerade\n"
            "-add chain=dstnat action=dst-nat to-addresses=192.168.1.100\n"
        )
        changes = parse_diff_changes(diff_text)
        assert len(changes) == 1
        assert changes[0]["component"] == "ip/firewall/nat"
        assert "Removed" in changes[0]["summary"]
        assert "1" in changes[0]["summary"]

    def test_modifications_both_add_and_remove(self):
        """Test 4: Diff with both + and - lines under same component produces 'Modified' summary."""
        diff_text = (
            "--- a/config\n"
            "+++ b/config\n"
            "@@ -1,3 +1,3 @@\n"
            " /ip firewall filter\n"
            "-add chain=input action=accept protocol=tcp dst-port=22\n"
            "-add chain=input action=accept protocol=tcp dst-port=23\n"
            "+add chain=input action=accept protocol=tcp dst-port=22 comment=ssh\n"
            "+add chain=input action=accept protocol=tcp dst-port=443 comment=https\n"
        )
        changes = parse_diff_changes(diff_text)
        assert len(changes) == 1
        assert "Modified" in changes[0]["summary"]
        assert "2" in changes[0]["summary"]

    def test_no_path_header_fallback(self):
        """Test 5: Diff with no RouterOS path headers uses system/general as fallback."""
        diff_text = (
            "--- a/config\n"
            "+++ b/config\n"
            "@@ -1,3 +1,3 @@\n"
            " # RouterOS config\n"
            "-# version 6.48\n"
            "+# version 6.49\n"
        )
        changes = parse_diff_changes(diff_text)
        assert len(changes) == 1
        assert changes[0]["component"] == "system/general"

    def test_raw_line_contains_diff_lines(self):
        """Test 6: raw_line field contains actual changed diff lines joined with newlines."""
        diff_text = (
            "--- a/config\n"
            "+++ b/config\n"
            "@@ -1,3 +1,4 @@\n"
            " /ip address\n"
            "+add address=10.0.0.1/24 interface=ether1\n"
            "-add address=192.168.1.1/24 interface=ether2\n"
        )
        changes = parse_diff_changes(diff_text)
        assert len(changes) == 1
        raw = changes[0]["raw_line"]
        assert "+add address=10.0.0.1/24 interface=ether1" in raw
        assert "-add address=192.168.1.1/24 interface=ether2" in raw
        # Lines are joined with newlines
        assert "\n" in raw
