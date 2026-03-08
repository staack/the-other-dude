"""Unit tests for the credential encryption/decryption service.

Tests cover:
- Encryption/decryption round-trip with valid key
- Random nonce ensures different ciphertext per encryption
- Wrong key rejection (InvalidTag)
- Invalid key length rejection (ValueError)
- Unicode and JSON payload handling
- Tampered ciphertext detection

These are pure function tests -- no database or async required.
"""

import json
import os

import pytest
from cryptography.exceptions import InvalidTag

from app.services.crypto import decrypt_credentials, encrypt_credentials


class TestEncryptDecryptRoundTrip:
    """Tests for successful encryption/decryption cycles."""

    def test_basic_roundtrip(self):
        key = os.urandom(32)
        plaintext = "secret-password"
        ciphertext = encrypt_credentials(plaintext, key)
        result = decrypt_credentials(ciphertext, key)
        assert result == plaintext

    def test_json_credentials_roundtrip(self):
        """The actual use case: encrypting JSON credential objects."""
        key = os.urandom(32)
        creds = json.dumps({"username": "admin", "password": "RouterOS!123"})
        ciphertext = encrypt_credentials(creds, key)
        result = decrypt_credentials(ciphertext, key)
        parsed = json.loads(result)
        assert parsed["username"] == "admin"
        assert parsed["password"] == "RouterOS!123"

    def test_unicode_roundtrip(self):
        key = os.urandom(32)
        plaintext = "password-with-unicode-\u00e9\u00e8\u00ea"
        ciphertext = encrypt_credentials(plaintext, key)
        result = decrypt_credentials(ciphertext, key)
        assert result == plaintext

    def test_empty_string_roundtrip(self):
        key = os.urandom(32)
        ciphertext = encrypt_credentials("", key)
        result = decrypt_credentials(ciphertext, key)
        assert result == ""

    def test_long_payload_roundtrip(self):
        """Ensure large payloads work (e.g., SSH keys in credentials)."""
        key = os.urandom(32)
        plaintext = "x" * 10000
        ciphertext = encrypt_credentials(plaintext, key)
        result = decrypt_credentials(ciphertext, key)
        assert result == plaintext


class TestNonceRandomness:
    """Tests that encryption uses random nonces."""

    def test_different_ciphertext_each_time(self):
        """Two encryptions of the same plaintext should produce different ciphertext
        because a random 12-byte nonce is generated each time."""
        key = os.urandom(32)
        plaintext = "same-plaintext"
        ct1 = encrypt_credentials(plaintext, key)
        ct2 = encrypt_credentials(plaintext, key)
        assert ct1 != ct2

    def test_both_decrypt_correctly(self):
        """Both different ciphertexts should decrypt to the same plaintext."""
        key = os.urandom(32)
        plaintext = "same-plaintext"
        ct1 = encrypt_credentials(plaintext, key)
        ct2 = encrypt_credentials(plaintext, key)
        assert decrypt_credentials(ct1, key) == plaintext
        assert decrypt_credentials(ct2, key) == plaintext


class TestDecryptionFailures:
    """Tests for proper rejection of invalid inputs."""

    def test_wrong_key_raises_invalid_tag(self):
        key1 = os.urandom(32)
        key2 = os.urandom(32)
        ciphertext = encrypt_credentials("secret", key1)
        with pytest.raises(InvalidTag):
            decrypt_credentials(ciphertext, key2)

    def test_tampered_ciphertext_raises_invalid_tag(self):
        """Flipping a byte in the ciphertext should cause authentication failure."""
        key = os.urandom(32)
        ciphertext = bytearray(encrypt_credentials("secret", key))
        # Flip a byte in the encrypted portion (after the 12-byte nonce)
        ciphertext[15] ^= 0xFF
        with pytest.raises(InvalidTag):
            decrypt_credentials(bytes(ciphertext), key)


class TestKeyValidation:
    """Tests for encryption key length validation."""

    def test_short_key_encrypt_raises(self):
        with pytest.raises(ValueError, match="32 bytes"):
            encrypt_credentials("test", os.urandom(16))

    def test_long_key_encrypt_raises(self):
        with pytest.raises(ValueError, match="32 bytes"):
            encrypt_credentials("test", os.urandom(64))

    def test_short_key_decrypt_raises(self):
        key = os.urandom(32)
        ciphertext = encrypt_credentials("test", key)
        with pytest.raises(ValueError, match="32 bytes"):
            decrypt_credentials(ciphertext, os.urandom(16))

    def test_empty_key_raises(self):
        with pytest.raises(ValueError, match="32 bytes"):
            encrypt_credentials("test", b"")
