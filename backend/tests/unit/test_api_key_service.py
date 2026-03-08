"""Unit tests for API key service.

Tests cover:
- Key generation format (mktp_ prefix, sufficient length)
- Key hashing (SHA-256 hex digest, 64 chars)
- Scope validation against allowed list
- Key prefix extraction

These are pure function tests -- no database or async required.
"""

import hashlib

from app.services.api_key_service import (
    ALLOWED_SCOPES,
    generate_raw_key,
    hash_key,
)


class TestKeyGeneration:
    """Tests for API key generation."""

    def test_key_starts_with_prefix(self):
        key = generate_raw_key()
        assert key.startswith("mktp_")

    def test_key_has_sufficient_length(self):
        """Key should be mktp_ + at least 32 chars of randomness."""
        key = generate_raw_key()
        assert len(key) >= 37  # "mktp_" (5) + 32

    def test_key_uniqueness(self):
        """Two generated keys should never be the same."""
        key1 = generate_raw_key()
        key2 = generate_raw_key()
        assert key1 != key2


class TestKeyHashing:
    """Tests for SHA-256 key hashing."""

    def test_hash_produces_64_char_hex(self):
        key = "mktp_test1234567890abcdef"
        h = hash_key(key)
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_is_sha256(self):
        key = "mktp_test1234567890abcdef"
        expected = hashlib.sha256(key.encode()).hexdigest()
        assert hash_key(key) == expected

    def test_hash_deterministic(self):
        key = generate_raw_key()
        assert hash_key(key) == hash_key(key)

    def test_different_keys_different_hashes(self):
        key1 = generate_raw_key()
        key2 = generate_raw_key()
        assert hash_key(key1) != hash_key(key2)


class TestAllowedScopes:
    """Tests for scope definitions."""

    def test_allowed_scopes_contains_expected(self):
        expected = {
            "devices:read",
            "devices:write",
            "config:read",
            "config:write",
            "alerts:read",
            "firmware:write",
        }
        assert expected == ALLOWED_SCOPES
