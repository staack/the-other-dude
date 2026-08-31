"""Guard test: every hard-coded version string in the repo must agree.

TOD's version lives in eleven places across nine files — `VERSION` at the
repo root plus eight other files, each hard-coding a copy for its own
ecosystem (npm, npm's lockfile, hatchling, Pydantic Settings, Helm, the
marketing site, the docs table, and the license header). There is no single
source of truth at runtime; every prior release bumped all of them by hand,
and that's exactly how both `LICENSE` and `frontend/package-lock.json` were
left reading "9.7.0" for a full release cycle while everything else moved on
to 9.9.0.

This test reuses scripts/bump_version.py's own location list — the same
patterns the bump script writes with — so the test and the script can never
disagree about what "the nine locations" are. If it fails, either a file
drifted (fix it with `scripts/bump_version.py <version>`, or by hand for
just the outlier) or the bump script's pattern for a file is stale (fix the
pattern in scripts/bump_version.py).

This is pure file-reading -- no database or async required.
"""

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_bump_version():
    spec = importlib.util.spec_from_file_location(
        "bump_version", REPO_ROOT / "scripts" / "bump_version.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_version_matches_everywhere():
    bump_version = _load_bump_version()
    expected = bump_version.LOCATIONS[0].current()  # VERSION file
    problems = bump_version.check(expected)
    assert not problems, "Version drift found:\n" + "\n".join(problems)
