"""WinBox version parsing/comparison and the winbox-worker/Dockerfile pin.

MikroTik version strings are inconsistently shaped -- some releases are
published as "4.0.1", others as "4.3" with no patch component. This module
treats a missing patch as 0 so both shapes compare correctly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?$")


class InvalidVersionError(ValueError):
    """Raised when a string doesn't look like a WinBox version."""


def parse_version(raw: str) -> tuple[int, int, int]:
    match = _VERSION_RE.match(raw.strip())
    if not match:
        raise InvalidVersionError(f"not a WinBox version string: {raw!r}")
    major, minor, patch = match.groups()
    return (int(major), int(minor), int(patch or 0))


def is_newer(candidate: str, current: str) -> bool:
    """True if `candidate` is a strictly newer version than `current`."""
    return parse_version(candidate) > parse_version(current)


@dataclass(frozen=True)
class DockerfilePin:
    version: str
    sha256: str


# Trailing whitespace is matched with `[ \t]*`, not `\s*`: `\s` includes `\n`,
# and combined with MULTILINE's `$` (which matches just before a newline) a
# greedy `\s*$` would swallow a following blank line into the match --
# silently dropping it on write.
_VERSION_ARG_RE = re.compile(r"^(ARG WINBOX_VERSION=)(\S+)[ \t]*$", re.MULTILINE)
_SHA256_ARG_RE = re.compile(r"^(ARG WINBOX_SHA256=)(\S+)[ \t]*$", re.MULTILINE)


def read_dockerfile_pin(dockerfile: Path) -> DockerfilePin:
    text = dockerfile.read_text()
    version_match = _VERSION_ARG_RE.search(text)
    sha256_match = _SHA256_ARG_RE.search(text)
    if not version_match or not sha256_match:
        raise ValueError(
            f"could not find both ARG WINBOX_VERSION= and ARG WINBOX_SHA256= in {dockerfile}"
        )
    return DockerfilePin(version=version_match.group(2), sha256=sha256_match.group(2))


def write_dockerfile_pin(dockerfile: Path, pin: DockerfilePin) -> None:
    text = dockerfile.read_text()

    text, n = _VERSION_ARG_RE.subn(rf"\g<1>{pin.version}", text)
    if n != 1:
        raise ValueError(
            f"expected exactly one ARG WINBOX_VERSION= line in {dockerfile}, found {n}"
        )

    text, n = _SHA256_ARG_RE.subn(rf"\g<1>{pin.sha256}", text)
    if n != 1:
        raise ValueError(
            f"expected exactly one ARG WINBOX_SHA256= line in {dockerfile}, found {n}"
        )

    dockerfile.write_text(text)
