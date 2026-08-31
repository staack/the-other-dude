"""Tests for SSH private key normalization used by credential profiles.

Keys are stored unencrypted inside the OpenBao Transit envelope, so any
passphrase is stripped at upload and never persisted. These tests pin that
behavior and the derived public fingerprint shown to operators.
"""

import base64
import hashlib

import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.hazmat.primitives.serialization import (
    BestAvailableEncryption,
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from app.services.ssh_key import SSHKeyError, normalize_private_key


def _ed25519_pem(passphrase: bytes | None = None) -> str:
    key = ed25519.Ed25519PrivateKey.generate()
    enc = BestAvailableEncryption(passphrase) if passphrase else NoEncryption()
    return key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, enc).decode()


def _expected_fingerprint(pem: str) -> str:
    """Compute the fingerprint independently, the way ssh-keygen -l does."""
    from cryptography.hazmat.primitives.serialization import load_ssh_private_key

    pub = load_ssh_private_key(pem.encode(), password=None).public_key()
    blob = pub.public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH).split()[1]
    digest = hashlib.sha256(base64.b64decode(blob)).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


class TestNormalizePrivateKey:
    def test_unencrypted_ed25519_key_is_accepted(self):
        pem = _ed25519_pem()
        normalized, fingerprint = normalize_private_key(pem, None)
        assert "PRIVATE KEY" in normalized
        assert fingerprint == _expected_fingerprint(pem)

    def test_fingerprint_has_ssh_keygen_format(self):
        _, fingerprint = normalize_private_key(_ed25519_pem(), None)
        assert fingerprint.startswith("SHA256:")
        assert not fingerprint.endswith("=")  # unpadded, like ssh-keygen

    def test_rsa_key_is_accepted(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()).decode()
        normalized, fingerprint = normalize_private_key(pem, None)
        assert "PRIVATE KEY" in normalized
        assert fingerprint.startswith("SHA256:")

    def test_passphrase_is_stripped_from_the_stored_key(self):
        """The stored key must be usable by the poller without a passphrase.

        Asserted by loading it with password=None, not by looking for an
        "ENCRYPTED" marker: OpenSSH-format keys keep the same PEM header
        whether or not they are encrypted, so that check would be vacuous.
        """
        from cryptography.hazmat.primitives.serialization import load_ssh_private_key

        pem = _ed25519_pem(passphrase=b"hunter2")
        # The input really is encrypted.
        with pytest.raises(TypeError):
            load_ssh_private_key(pem.encode(), password=None)

        normalized, _ = normalize_private_key(pem, "hunter2")
        load_ssh_private_key(normalized.encode(), password=None)

    def test_passphrase_protected_key_without_passphrase_is_rejected(self):
        pem = _ed25519_pem(passphrase=b"hunter2")
        with pytest.raises(SSHKeyError) as exc:
            normalize_private_key(pem, None)
        assert "passphrase" in str(exc.value).lower()

    def test_wrong_passphrase_is_rejected_without_echoing_it(self):
        pem = _ed25519_pem(passphrase=b"hunter2")
        with pytest.raises(SSHKeyError) as exc:
            normalize_private_key(pem, "wrong-guess")
        message = str(exc.value)
        assert "passphrase" in message.lower()
        # The supplied secret must never appear in an error that reaches logs.
        assert "wrong-guess" not in message

    def test_garbage_input_is_rejected_without_echoing_key_material(self):
        with pytest.raises(SSHKeyError) as exc:
            normalize_private_key("-----BEGIN OPENSSH PRIVATE KEY-----\nsekrit\n", None)
        assert "sekrit" not in str(exc.value)

    def test_public_key_pasted_by_mistake_is_rejected(self):
        """A common operator error: pasting id_ed25519.pub instead of the key."""
        with pytest.raises(SSHKeyError):
            normalize_private_key("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host", None)
