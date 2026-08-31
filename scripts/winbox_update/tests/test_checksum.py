"""Tests for scripts/winbox_update/checksum.py.

Pure logic: parsing a MikroTik `*.sha256` companion file and verifying a
downloaded archive against it. This is the supply-chain enforcement point --
it must fail loudly on anything unexpected rather than guess.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from checksum import (
    ChecksumFormatError,
    ChecksumMismatchError,
    parse_sha256_file,
    sha256_of_file,
    verify_file_sha256,
)

REAL_DIGEST = "573600ac24df38a7a06ea4318b12754247eec4b54c6c90b0a57100d676787a4c"


def test_parse_sha256_file_extracts_lowercase_digest():
    content = f"{REAL_DIGEST}  WinBox_Linux.zip\n"
    assert parse_sha256_file(content) == REAL_DIGEST


def test_parse_sha256_file_uppercases_normalized_to_lowercase():
    content = f"{REAL_DIGEST.upper()}  WinBox_Linux.zip\n"
    assert parse_sha256_file(content) == REAL_DIGEST


def test_parse_sha256_file_checks_filename_when_given():
    content = f"{REAL_DIGEST}  WinBox_Linux.zip\n"
    assert (
        parse_sha256_file(content, expected_filename="WinBox_Linux.zip") == REAL_DIGEST
    )


def test_parse_sha256_file_rejects_mismatched_filename():
    content = f"{REAL_DIGEST}  WinBox_Windows.zip\n"
    with pytest.raises(ChecksumFormatError):
        parse_sha256_file(content, expected_filename="WinBox_Linux.zip")


def test_parse_sha256_file_rejects_empty_content():
    with pytest.raises(ChecksumFormatError):
        parse_sha256_file("")


def test_parse_sha256_file_rejects_multiple_lines():
    # A checksum file listing more than one entry isn't the single-file
    # shape MikroTik publishes -- something changed upstream, fail loudly.
    content = f"{REAL_DIGEST}  WinBox_Linux.zip\n{REAL_DIGEST}  WinBox_Windows.zip\n"
    with pytest.raises(ChecksumFormatError):
        parse_sha256_file(content)


def test_parse_sha256_file_rejects_non_hex_digest():
    content = "not-a-real-digest  WinBox_Linux.zip\n"
    with pytest.raises(ChecksumFormatError):
        parse_sha256_file(content)


def test_parse_sha256_file_rejects_short_digest():
    content = "deadbeef  WinBox_Linux.zip\n"
    with pytest.raises(ChecksumFormatError):
        parse_sha256_file(content)


def test_sha256_of_file_matches_hashlib(tmp_path):
    f = tmp_path / "archive.zip"
    f.write_bytes(b"some archive bytes")

    assert sha256_of_file(f) == hashlib.sha256(b"some archive bytes").hexdigest()


def test_verify_file_sha256_passes_on_match(tmp_path):
    f = tmp_path / "archive.zip"
    f.write_bytes(b"some archive bytes")
    expected = hashlib.sha256(b"some archive bytes").hexdigest()

    verify_file_sha256(f, expected)  # must not raise


def test_verify_file_sha256_raises_on_mismatch(tmp_path):
    f = tmp_path / "archive.zip"
    f.write_bytes(b"some archive bytes")

    with pytest.raises(ChecksumMismatchError):
        verify_file_sha256(f, "0" * 64)


def test_verify_file_sha256_is_case_insensitive(tmp_path):
    f = tmp_path / "archive.zip"
    f.write_bytes(b"some archive bytes")
    expected = hashlib.sha256(b"some archive bytes").hexdigest().upper()

    verify_file_sha256(f, expected)  # must not raise
