"""The device cap and the version string must agree everywhere they appear.

These are not tests of behaviour. They exist because the free-tier device cap
is written out by hand in four places -- a licence, a Python constant, a README
paragraph and a marketing page -- and nothing connects them. On 2026-03-19 the
BSL grant dropped from 1,000 devices to 250 (``e696b7e``) and ``README.md`` was
not updated with it, so for five months the first thing a prospective user read
promised free use at a device count the licence they were bound by reserved for
a paid key. Same shape for the version: ``LICENSE`` is not among the files the
release process bumps, so its ``Licensed Work`` line went stale.

A failure here means two documents disagree, not that code is broken. The
assertion messages name every source and its value so that whoever sees this
red knows immediately which one drifted.
"""

import re
from pathlib import Path

import pytest

from app.config import settings

REPO_ROOT = Path(__file__).resolve().parents[2]


def _read(relative_path: str) -> str:
    path = REPO_ROOT / relative_path
    if not path.is_file():
        pytest.fail(
            f"{relative_path} does not exist at {path}. If it was moved or renamed, "
            f"update this test -- it is the only thing keeping the device cap and "
            f"the version string in agreement across the repo."
        )
    return path.read_text(encoding="utf-8")


def _search(relative_path: str, pattern: str, what: str) -> str:
    """Find the one capture of ``pattern``, failing loudly if the wording moved."""
    text = _read(relative_path)
    matches = re.findall(pattern, text)
    if not matches:
        pytest.fail(
            f"Could not find {what} in {relative_path} using /{pattern}/. The wording "
            f"has changed. Fix the pattern rather than deleting the check -- without "
            f"it, that file can drift out of agreement with the others unnoticed."
        )
    unique = set(matches)
    if len(unique) > 1:
        pytest.fail(
            f"{relative_path} states {what} more than once and inconsistently: "
            f"{sorted(unique)}. The file disagrees with itself."
        )
    return matches[0]


def _device_cap_sources() -> list[tuple[str, str]]:
    """Every place the free-tier device cap is written down. (label, value)."""
    return [
        (
            "LICENSE (Additional Use Grant, legally operative)",
            _search("LICENSE", r"manage up to ([\d,]+) devices", "the device grant"),
        ),
        (
            "LICENSE (commercial-license threshold)",
            _search("LICENSE", r"exceeding ([\d,]+) managed devices", "the paid threshold"),
        ),
        (
            "backend/app/config.py (LICENSE_DEVICES, what the code reports)",
            str(settings.LICENSE_DEVICES),
        ),
        (
            "README.md (free-use sentence)",
            _search("README.md", r"managing up to ([\d,]+) devices", "the free-use cap"),
        ),
        (
            "README.md (commercial-license sentence)",
            _search("README.md", r"exceeding ([\d,]+) managed devices", "the paid threshold"),
        ),
        (
            "docs/website/index.html (published status table)",
            _search(
                "docs/website/index.html",
                r"Free tier</td><td>([\d,]+) devices",
                "the published free-tier row",
            ),
        ),
    ]


def test_the_free_tier_device_cap_is_the_same_number_everywhere():
    sources = _device_cap_sources()
    normalised = [(label, int(value.replace(",", ""))) for label, value in sources]
    values = {count for _, count in normalised}

    if len(values) > 1:
        table = "\n".join(f"    {count:>6}  {label}" for label, count in normalised)
        pytest.fail(
            "The free-tier device cap disagrees between sources.\n\n"
            f"{table}\n\n"
            "LICENSE is the legally operative document -- whatever it says is correct, "
            "and the others must be brought to match it. Do not 'fix' this by editing "
            "LICENSE to match the code; that changes the terms customers are bound by."
        )


def test_the_license_version_matches_the_repo_version():
    repo_version = _read("VERSION").strip()
    license_version = _search(
        "LICENSE", r"Licensed Work:\s+The Other Dude v([\d.]+)", "the Licensed Work version"
    )

    assert license_version == repo_version, (
        "LICENSE's version string is stale.\n\n"
        f"    {repo_version:>10}  VERSION\n"
        f"    {license_version:>10}  LICENSE (Licensed Work line)\n\n"
        "LICENSE is not in the list of files the release process bumps, which is why "
        "this drifts. Either add it to that list or keep bumping it by hand."
    )
