"""Tests for scripts/winbox_update/versioning.py.

Pure logic: parsing WinBox version strings, comparing them, and reading/
writing the WINBOX_VERSION / WINBOX_SHA256 pin in winbox-worker/Dockerfile.
No network, no filesystem beyond a tmp_path fixture.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from versioning import (
    DockerfilePin,
    InvalidVersionError,
    is_newer,
    parse_version,
    read_dockerfile_pin,
    write_dockerfile_pin,
)


def test_parse_version_with_patch():
    assert parse_version("4.0.1") == (4, 0, 1)


def test_parse_version_without_patch_defaults_patch_to_zero():
    # MikroTik's download page shows "v4.3" for some releases with no
    # third segment -- treat a missing patch as 0 so it still compares.
    assert parse_version("4.3") == (4, 3, 0)


def test_parse_version_rejects_garbage():
    with pytest.raises(InvalidVersionError):
        parse_version("not-a-version")


def test_is_newer_true_when_candidate_has_higher_minor():
    assert is_newer("4.3", "4.0.1") is True


def test_is_newer_false_when_candidate_equals_current():
    assert is_newer("4.0.1", "4.0.1") is False


def test_is_newer_false_when_candidate_is_older():
    assert is_newer("4.0.1", "4.3") is False


def test_read_dockerfile_pin_extracts_version_and_sha256(tmp_path):
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text(
        "FROM ubuntu:24.04\n"
        "ARG WINBOX_VERSION=4.0.1\n"
        "ARG WINBOX_SHA256=8ec2d08929fd434c4b88881f3354bdf60b057ecd2fb54961dd912df57e326a70\n"
        "RUN echo hi\n"
    )

    pin = read_dockerfile_pin(dockerfile)

    assert pin == DockerfilePin(
        version="4.0.1",
        sha256="8ec2d08929fd434c4b88881f3354bdf60b057ecd2fb54961dd912df57e326a70",
    )


def test_read_dockerfile_pin_raises_when_args_missing(tmp_path):
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text("FROM ubuntu:24.04\nRUN echo hi\n")

    with pytest.raises(ValueError):
        read_dockerfile_pin(dockerfile)


def test_write_dockerfile_pin_updates_only_the_two_arg_lines(tmp_path):
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text(
        "FROM ubuntu:24.04\n"
        "ARG WINBOX_VERSION=4.0.1\n"
        "ARG WINBOX_SHA256=oldhash\n"
        "RUN echo hi\n"
    )

    write_dockerfile_pin(dockerfile, DockerfilePin(version="4.3", sha256="newhash"))

    assert dockerfile.read_text() == (
        "FROM ubuntu:24.04\n"
        "ARG WINBOX_VERSION=4.3\n"
        "ARG WINBOX_SHA256=newhash\n"
        "RUN echo hi\n"
    )


def test_write_dockerfile_pin_round_trips_through_read(tmp_path):
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text("ARG WINBOX_VERSION=1.0\nARG WINBOX_SHA256=abc\n")

    write_dockerfile_pin(dockerfile, DockerfilePin(version="2.0", sha256="def"))

    assert read_dockerfile_pin(dockerfile) == DockerfilePin(version="2.0", sha256="def")


def test_write_dockerfile_pin_preserves_blank_line_after_the_sha256_arg(tmp_path):
    # Regression: the real winbox-worker/Dockerfile has a blank line between
    # the ARG block and the next RUN instruction. A greedy `\s*` in the
    # replacement regex previously ate that blank line as part of the match.
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text(
        "ARG WINBOX_VERSION=4.0.1\n"
        "ARG WINBOX_SHA256=oldhash\n"
        "\n"
        "# Install Xpra + X11 deps\n"
        "RUN apt-get update\n"
    )

    write_dockerfile_pin(dockerfile, DockerfilePin(version="4.3", sha256="newhash"))

    assert dockerfile.read_text() == (
        "ARG WINBOX_VERSION=4.3\n"
        "ARG WINBOX_SHA256=newhash\n"
        "\n"
        "# Install Xpra + X11 deps\n"
        "RUN apt-get update\n"
    )
