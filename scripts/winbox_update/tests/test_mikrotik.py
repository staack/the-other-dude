"""Tests for scripts/winbox_update/mikrotik.py.

`fetch_latest_release` itself drives a real headless browser against a real
website and isn't unit-tested here. What *is* pure logic -- and the part
most likely to silently do the wrong thing if MikroTik changes the page --
is turning a scraped download href into a WinboxRelease, or rejecting it.
That's `release_from_linux_href`, tested directly.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from mikrotik import ScrapeError, WinboxRelease, release_from_linux_href


def test_release_from_linux_href_parses_version_and_builds_checksum_url():
    href = "https://download.mikrotik.com/routeros/winbox/4.3/WinBox_Linux.zip"

    release = release_from_linux_href(href)

    assert release == WinboxRelease(
        version="4.3",
        linux_zip_url=href,
        checksum_url=href + ".sha256",
    )


def test_release_from_linux_href_accepts_three_part_version():
    href = "https://download.mikrotik.com/routeros/winbox/4.0.1/WinBox_Linux.zip"

    release = release_from_linux_href(href)

    assert release.version == "4.0.1"


def test_release_from_linux_href_rejects_none():
    with pytest.raises(ScrapeError):
        release_from_linux_href(None)


def test_release_from_linux_href_rejects_wrong_host():
    # A page-shape change that points somewhere else must fail loudly, not
    # silently start downloading WinBox from an unexpected origin.
    with pytest.raises(ScrapeError):
        release_from_linux_href(
            "https://evil.example.com/routeros/winbox/4.3/WinBox_Linux.zip"
        )


def test_release_from_linux_href_rejects_wrong_filename():
    with pytest.raises(ScrapeError):
        release_from_linux_href(
            "https://download.mikrotik.com/routeros/winbox/4.3/WinBox_Windows.zip"
        )


def test_release_from_linux_href_rejects_missing_version_segment():
    with pytest.raises(ScrapeError):
        release_from_linux_href(
            "https://download.mikrotik.com/routeros/winbox/WinBox_Linux.zip"
        )
