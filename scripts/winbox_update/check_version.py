#!/usr/bin/env python3
"""Detect a new upstream WinBox release and, if one exists and its archive
verifies against MikroTik's own published checksum, bump the pin in
winbox-worker/Dockerfile in place.

Run by .github/workflows/winbox-version-check.yml on a schedule (and via
workflow_dispatch for a manual run). Exits non-zero -- failing the job
loudly -- if MikroTik's download page doesn't look the way this script
expects, if the checksum file isn't in the expected format, or if the
downloaded archive doesn't match it. This script must never propose a
version bump for an archive it couldn't verify.

    python scripts/winbox_update/check_version.py \\
        [--dockerfile PATH] [--github-output PATH]
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from checksum import (
    ChecksumFormatError,
    ChecksumMismatchError,
    parse_sha256_file,
    verify_file_sha256,
)
from mikrotik import ScrapeError, WinboxRelease, fetch_latest_release
from mikrotik import download as mikrotik_download
from mikrotik import fetch_text as mikrotik_fetch_text
from versioning import (
    DockerfilePin,
    InvalidVersionError,
    is_newer,
    read_dockerfile_pin,
    write_dockerfile_pin,
)

LINUX_ARCHIVE_NAME = "WinBox_Linux.zip"


def run(
    dockerfile: Path,
    github_output: Path | None,
    *,
    fetch_release: Callable[[], WinboxRelease] = fetch_latest_release,
    fetch_text: Callable[[str], str] = mikrotik_fetch_text,
    download: Callable[[str, Path], None] = mikrotik_download,
) -> int:
    current = read_dockerfile_pin(dockerfile)
    print(f"pinned version: {current.version}")

    try:
        release = fetch_release()
    except ScrapeError as e:
        print(
            f"error: MikroTik's download page didn't look the way this script expects: {e}",
            file=sys.stderr,
        )
        return 1

    print(f"latest upstream version: {release.version}")

    try:
        newer = is_newer(release.version, current.version)
    except InvalidVersionError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    if not newer:
        print("no update needed")
        _write_output(github_output, updated=False)
        return 0

    checksum_text = fetch_text(release.checksum_url)
    try:
        expected_sha256 = parse_sha256_file(
            checksum_text, expected_filename=LINUX_ARCHIVE_NAME
        )
    except ChecksumFormatError as e:
        print(
            f"error: checksum file at {release.checksum_url} is not in the expected format: {e}",
            file=sys.stderr,
        )
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / LINUX_ARCHIVE_NAME
        download(release.linux_zip_url, archive)
        try:
            verify_file_sha256(archive, expected_sha256)
        except ChecksumMismatchError as e:
            print(
                f"error: downloaded archive failed checksum verification: {e}",
                file=sys.stderr,
            )
            return 1

    write_dockerfile_pin(
        dockerfile, DockerfilePin(version=release.version, sha256=expected_sha256)
    )
    print(f"bumped {dockerfile} to WinBox {release.version} ({expected_sha256})")

    _write_output(
        github_output,
        updated=True,
        previous_version=current.version,
        version=release.version,
        sha256=expected_sha256,
    )
    return 0


def _write_output(path: Path | None, **kv: object) -> None:
    if path is None:
        return
    with open(path, "a") as f:
        for key, value in kv.items():
            if isinstance(value, bool):
                value = (
                    "true" if value else "false"
                )  # GitHub Actions' own boolean convention
            f.write(f"{key}={value}\n")


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parents[2]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dockerfile",
        type=Path,
        default=repo_root / "winbox-worker" / "Dockerfile",
    )
    parser.add_argument(
        "--github-output",
        type=Path,
        default=Path(os.environ["GITHUB_OUTPUT"])
        if "GITHUB_OUTPUT" in os.environ
        else None,
    )
    args = parser.parse_args(argv)

    return run(args.dockerfile, args.github_output)


if __name__ == "__main__":
    sys.exit(main())
