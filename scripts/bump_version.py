#!/usr/bin/env python3
"""Bump TOD's version string everywhere it's written down.

The version lives in eleven places across nine files: `VERSION` at the repo
root plus eight other files that each hard-code a copy for their own
ecosystem (npm, npm's lockfile, PyPI/hatchling, Pydantic Settings, Helm, the
marketing site, the docs table, and the license header). There has never
been a script for this — every prior release bumped them by hand, which is
exactly how `LICENSE` ended up stuck at "v9.7.0" while everything else moved
on to 9.9.0. `frontend/package-lock.json` had drifted the same way, to the
same stale 9.7.0 — npm normally re-syncs its top-level `version` field from
`package.json` on the next `npm install`/`npm ci`, but that apparently
didn't happen on a past release either. This script replaces the manual
list.

    scripts/bump_version.py 9.10.0          # bump every location
    scripts/bump_version.py --check         # verify all locations agree

`--check` does not need a target version — it reads VERSION and confirms
every other location matches it, without writing anything. This is the same
check `backend/tests/unit/test_version_consistency.py` runs in CI; run it
here for a fast manual check without spinning up pytest.

After bumping, `git diff` and commit as part of the normal release process
(see the "Release Process" note in the vault).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Semantic version, no pre-release/build suffixes — nothing in the repo uses
# them today, so we don't pretend to support what we can't verify.
VERSION_RE = re.compile(r"\d+\.\d+\.\d+")


class Location:
    """One place in the repo that hard-codes the version string."""

    def __init__(self, path: str, pattern: str, description: str):
        self.path = REPO_ROOT / path
        # `pattern` must contain exactly one capture group around the version.
        self.regex = re.compile(pattern)
        self.description = description

    def current(self) -> str:
        text = self.path.read_text()
        matches = self.regex.findall(text)
        if len(matches) != 1:
            raise SystemExit(
                f"{self.path.relative_to(REPO_ROOT)}: expected exactly 1 match for "
                f"{self.description!r}, found {len(matches)} — the file format may "
                f"have changed; update the pattern in scripts/bump_version.py"
            )
        return matches[0]

    def bump(self, new_version: str) -> tuple[str, str]:
        text = self.path.read_text()
        old = self.current()
        new_text, count = self.regex.subn(
            lambda m: m.group(0).replace(old, new_version), text
        )
        if count != 1:
            raise SystemExit(
                f"{self.path.relative_to(REPO_ROOT)}: expected exactly 1 substitution for "
                f"{self.description!r}, made {count}"
            )
        self.path.write_text(new_text)
        return old, new_version


LOCATIONS = [
    Location("VERSION", r"\d+\.\d+\.\d+", "the version file itself"),
    Location(
        "frontend/package.json",
        r'"version":\s*"(\d+\.\d+\.\d+)"',
        "npm package version",
    ),
    Location(
        "frontend/package-lock.json",
        r'\A\{\n  "name": "frontend",\n  "version": "(\d+\.\d+\.\d+)"',
        "npm lockfile top-level version",
    ),
    Location(
        "frontend/package-lock.json",
        r'"packages": \{\n    "": \{\n      "name": "frontend",\n      "version": "(\d+\.\d+\.\d+)"',
        "npm lockfile root-package version (packages[''])",
    ),
    Location(
        "backend/pyproject.toml",
        r'version\s*=\s*"(\d+\.\d+\.\d+)"',
        "hatchling project version",
    ),
    Location(
        "backend/app/config.py",
        r'APP_VERSION:\s*str\s*=\s*"(\d+\.\d+\.\d+)"',
        "Pydantic Settings APP_VERSION default",
    ),
    Location(
        "docs/CONFIGURATION.md",
        r"\| `APP_VERSION` \| `(\d+\.\d+\.\d+)` \|",
        "APP_VERSION row in the config reference table",
    ),
    Location(
        "docs/website/index.html",
        r'"softwareVersion":\s*"(\d+\.\d+\.\d+)"',
        "JSON-LD softwareVersion on the marketing site",
    ),
    Location(
        "infrastructure/helm/Chart.yaml",
        r'appVersion:\s*"(\d+\.\d+\.\d+)"',
        "Helm chart appVersion (NOT the chart's own `version:` field, which is independent)",
    ),
    Location(
        "LICENSE",
        r"Licensed Work:\s+The Other Dude v(\d+\.\d+\.\d+)",
        "BSL license header",
    ),
]

# docs/website/index.html hard-codes the version twice — once in the JSON-LD
# block above, and once in a plain-HTML status table. Both need bumping, so
# it needs its own second Location with a distinct pattern.
LOCATIONS.append(
    Location(
        "docs/website/index.html",
        r"<tr><td>Version</td><td>(\d+\.\d+\.\d+)</td></tr>",
        "Version row in the marketing site's status table",
    )
)


def check(expected: str) -> list[str]:
    """Return a list of human-readable mismatches; empty means all consistent."""
    problems = []
    for loc in LOCATIONS:
        found = loc.current()
        if found != expected:
            problems.append(
                f"  {loc.path.relative_to(REPO_ROOT)}: has {found!r}, expected {expected!r} ({loc.description})"
            )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("new_version", nargs="?", help="new version, e.g. 9.10.0")
    group.add_argument(
        "--check", action="store_true", help="verify consistency, don't write"
    )
    args = parser.parse_args()

    if args.check:
        version_loc = LOCATIONS[0]
        expected = version_loc.current()
        problems = check(expected)
        if problems:
            print(f"Version mismatch — VERSION says {expected!r}:", file=sys.stderr)
            print("\n".join(problems), file=sys.stderr)
            return 1
        print(f"All {len(LOCATIONS)} locations agree: {expected}")
        return 0

    if not args.new_version:
        parser.error("new_version is required unless --check is given")
    if not VERSION_RE.fullmatch(args.new_version):
        parser.error(
            f"'{args.new_version}' doesn't look like a semantic version (X.Y.Z)"
        )

    print(f"Bumping to {args.new_version}:")
    for loc in LOCATIONS:
        old, new = loc.bump(args.new_version)
        rel = loc.path.relative_to(REPO_ROOT)
        if old == new:
            print(f"  {rel}: already {new} ({loc.description})")
        else:
            print(f"  {rel}: {old} -> {new} ({loc.description})")

    print(
        "\nReview the diff, then commit. Remember to update the vault's Release Process note if the file list changes."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
