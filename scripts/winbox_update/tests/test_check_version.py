"""Tests for scripts/winbox_update/check_version.py's orchestration logic.

Exercises `run()` with fake fetch/download callables so no network or
browser is involved -- only the decision logic: whether an update is
needed, whether a checksum verifies, and what ends up written to the
Dockerfile and $GITHUB_OUTPUT in each case.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from check_version import run
from mikrotik import WinboxRelease

ARCHIVE_BYTES = b"pretend this is the WinBox_Linux.zip archive"
ARCHIVE_SHA256 = hashlib.sha256(ARCHIVE_BYTES).hexdigest()


def _dockerfile(tmp_path: Path, version: str, sha256: str) -> Path:
    path = tmp_path / "Dockerfile"
    path.write_text(
        f"FROM ubuntu:24.04\nARG WINBOX_VERSION={version}\nARG WINBOX_SHA256={sha256}\nRUN true\n"
    )
    return path


def _github_output(tmp_path: Path) -> Path:
    path = tmp_path / "github_output"
    path.write_text("")
    return path


def _read_outputs(path: Path) -> dict[str, str]:
    outputs: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        key, _, value = line.partition("=")
        outputs[key] = value
    return outputs


def _fake_release(version: str) -> WinboxRelease:
    url = f"https://download.mikrotik.com/routeros/winbox/{version}/WinBox_Linux.zip"
    return WinboxRelease(
        version=version, linux_zip_url=url, checksum_url=url + ".sha256"
    )


def test_no_update_when_upstream_version_is_not_newer(tmp_path):
    dockerfile = _dockerfile(tmp_path, "4.3", "oldhash")
    github_output = _github_output(tmp_path)

    exit_code = run(
        dockerfile,
        github_output,
        fetch_release=lambda: _fake_release("4.3"),
        fetch_text=lambda url: "unused",
        download=lambda url, dest: None,
    )

    assert exit_code == 0
    assert (
        dockerfile.read_text()
        == "FROM ubuntu:24.04\nARG WINBOX_VERSION=4.3\nARG WINBOX_SHA256=oldhash\nRUN true\n"
    )
    # Lowercase, matching GitHub Actions' own boolean output convention.
    assert _read_outputs(github_output) == {"updated": "false"}


def test_bumps_dockerfile_when_checksum_verifies(tmp_path):
    dockerfile = _dockerfile(tmp_path, "4.0.1", "oldhash")
    github_output = _github_output(tmp_path)

    def fake_download(url, dest):
        Path(dest).write_bytes(ARCHIVE_BYTES)

    exit_code = run(
        dockerfile,
        github_output,
        fetch_release=lambda: _fake_release("4.3"),
        fetch_text=lambda url: f"{ARCHIVE_SHA256}  WinBox_Linux.zip\n",
        download=fake_download,
    )

    assert exit_code == 0
    assert "ARG WINBOX_VERSION=4.3" in dockerfile.read_text()
    assert f"ARG WINBOX_SHA256={ARCHIVE_SHA256}" in dockerfile.read_text()

    outputs = _read_outputs(github_output)
    assert outputs["updated"] == "true"
    assert outputs["previous_version"] == "4.0.1"
    assert outputs["version"] == "4.3"
    assert outputs["sha256"] == ARCHIVE_SHA256


def test_aborts_without_touching_dockerfile_when_checksum_file_is_malformed(tmp_path):
    dockerfile = _dockerfile(tmp_path, "4.0.1", "oldhash")
    original = dockerfile.read_text()
    github_output = _github_output(tmp_path)

    exit_code = run(
        dockerfile,
        github_output,
        fetch_release=lambda: _fake_release("4.3"),
        fetch_text=lambda url: "this is not a checksum file",
        download=lambda url, dest: pytest.fail(
            "must not download without a verified checksum"
        ),
    )

    assert exit_code == 1
    assert dockerfile.read_text() == original


def test_aborts_without_touching_dockerfile_when_archive_fails_checksum(tmp_path):
    dockerfile = _dockerfile(tmp_path, "4.0.1", "oldhash")
    original = dockerfile.read_text()
    github_output = _github_output(tmp_path)

    def fake_download(url, dest):
        Path(dest).write_bytes(b"corrupted or tampered bytes")

    exit_code = run(
        dockerfile,
        github_output,
        fetch_release=lambda: _fake_release("4.3"),
        fetch_text=lambda url: (
            f"{ARCHIVE_SHA256}  WinBox_Linux.zip\n"
        ),  # doesn't match downloaded bytes
        download=fake_download,
    )

    assert exit_code == 1
    assert dockerfile.read_text() == original
