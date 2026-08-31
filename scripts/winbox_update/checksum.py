"""Parsing and verification for MikroTik's `*.sha256` companion files.

This is the supply-chain enforcement point for the WinBox auto-update
pipeline: a checksum file that doesn't parse cleanly, or an archive that
doesn't match, must abort the update rather than proceed with a best guess.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

_SHA256_LINE_RE = re.compile(r"^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$")

_READ_CHUNK_SIZE = 1024 * 1024


class ChecksumFormatError(ValueError):
    """A `*.sha256` file didn't look like a single sha256sum-style entry."""


class ChecksumMismatchError(ValueError):
    """A downloaded file's sha256 didn't match the expected digest."""


def parse_sha256_file(content: str, expected_filename: str | None = None) -> str:
    lines = [line for line in content.strip().splitlines() if line.strip()]
    if len(lines) != 1:
        raise ChecksumFormatError(
            f"expected exactly one checksum line, got {len(lines)}: {content!r}"
        )

    match = _SHA256_LINE_RE.match(lines[0].strip())
    if not match:
        raise ChecksumFormatError(
            f"line does not look like a sha256sum entry: {lines[0]!r}"
        )

    digest, filename = match.group(1).lower(), match.group(2)
    if expected_filename is not None and filename != expected_filename:
        raise ChecksumFormatError(
            f"checksum file names {filename!r}, expected {expected_filename!r}"
        )
    return digest


def sha256_of_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_READ_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file_sha256(path: Path, expected_hex: str) -> None:
    actual = sha256_of_file(path)
    if actual.lower() != expected_hex.lower():
        raise ChecksumMismatchError(
            f"{path}: expected sha256 {expected_hex}, got {actual}"
        )
