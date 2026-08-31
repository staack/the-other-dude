"""Tests for ssh_key credential profiles.

Covers the schema contract and the credential JSON written into the Transit
envelope, plus the hard requirement that a supplied passphrase never leaks --
not into a validation error, a repr, or a log line.
"""

import json
import logging

import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.serialization import (
    BestAvailableEncryption,
    Encoding,
    NoEncryption,
    PrivateFormat,
)
from pydantic import ValidationError

from app.schemas.credential_profile import CredentialProfileCreate
from app.services.credential_profile_service import _build_credential_json


def _pem(passphrase: bytes | None = None) -> str:
    key = ed25519.Ed25519PrivateKey.generate()
    enc = BestAvailableEncryption(passphrase) if passphrase else NoEncryption()
    return key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, enc).decode()


class TestSSHKeySchema:
    def test_ssh_key_profile_is_accepted(self):
        data = CredentialProfileCreate(
            name="fleet-key", credential_type="ssh_key", username="admin", private_key=_pem()
        )
        assert data.credential_type == "ssh_key"
        assert data.username == "admin"

    def test_ssh_key_requires_a_private_key(self):
        with pytest.raises(ValidationError) as exc:
            CredentialProfileCreate(name="k", credential_type="ssh_key", username="admin")
        assert "private_key" in str(exc.value)

    def test_ssh_key_requires_a_username(self):
        with pytest.raises(ValidationError) as exc:
            CredentialProfileCreate(name="k", credential_type="ssh_key", private_key=_pem())
        assert "username" in str(exc.value)

    def test_password_remains_optional_for_ssh_key_profiles(self):
        """A key-only profile is the whole point; a password is a migration aid."""
        data = CredentialProfileCreate(
            name="k",
            credential_type="ssh_key",
            username="admin",
            private_key=_pem(),
            password="fallback",
        )
        assert data.password == "fallback"

    def test_routeros_profiles_are_unchanged(self):
        data = CredentialProfileCreate(
            name="p", credential_type="routeros", username="admin", password="secret"
        )
        assert data.credential_type == "routeros"


class TestPassphraseIsNeverExposed:
    """The lead's hard condition: a passphrase must not be persisted or logged."""

    def test_passphrase_repr_is_masked(self):
        data = CredentialProfileCreate(
            name="k",
            credential_type="ssh_key",
            username="admin",
            private_key=_pem(b"hunter2"),
            key_passphrase="hunter2",
        )
        assert "hunter2" not in repr(data)
        assert "hunter2" not in str(data)
        assert "hunter2" not in repr(data.key_passphrase)

    def test_passphrase_absent_from_validation_errors(self):
        """A ValidationError will happily echo the offending field's value."""
        with pytest.raises(ValidationError) as exc:
            CredentialProfileCreate(
                name="",  # invalid, triggers the error
                credential_type="ssh_key",
                username="admin",
                private_key=_pem(b"hunter2"),
                key_passphrase="hunter2",
            )
        assert "hunter2" not in str(exc.value)

    def test_passphrase_is_not_written_into_the_credential_envelope(self):
        data = CredentialProfileCreate(
            name="k",
            credential_type="ssh_key",
            username="admin",
            private_key=_pem(b"hunter2"),
            key_passphrase="hunter2",
        )
        cred_json, _ = _build_credential_json(data)
        serialized = json.dumps(cred_json)

        assert "hunter2" not in serialized
        assert "passphrase" not in serialized
        assert "key_passphrase" not in cred_json

    def test_passphrase_is_not_emitted_when_building_the_envelope(self, caplog):
        data = CredentialProfileCreate(
            name="k",
            credential_type="ssh_key",
            username="admin",
            private_key=_pem(b"hunter2"),
            key_passphrase="hunter2",
        )
        with caplog.at_level(logging.DEBUG):
            _build_credential_json(data)
        assert "hunter2" not in caplog.text


class TestBuildCredentialJSON:
    def test_ssh_key_envelope_shape_matches_the_go_parser(self):
        """Field names must match poller/internal/vault/credential_types.go."""
        data = CredentialProfileCreate(
            name="k", credential_type="ssh_key", username="admin", private_key=_pem()
        )
        cred_json, fingerprint = _build_credential_json(data)

        assert cred_json["type"] == "ssh_key"
        assert cred_json["username"] == "admin"
        assert "PRIVATE KEY" in cred_json["private_key"]
        assert fingerprint.startswith("SHA256:")

    def test_stored_key_is_decrypted_when_a_passphrase_was_supplied(self):
        data = CredentialProfileCreate(
            name="k",
            credential_type="ssh_key",
            username="admin",
            private_key=_pem(b"hunter2"),
            key_passphrase="hunter2",
        )
        cred_json, _ = _build_credential_json(data)
        # Load with no password: OpenSSH keys carry no "ENCRYPTED" marker, so
        # only an actual load proves the passphrase was stripped.
        from cryptography.hazmat.primitives.serialization import load_ssh_private_key

        load_ssh_private_key(cred_json["private_key"].encode(), password=None)

    def test_optional_password_is_carried_as_a_fallback(self):
        data = CredentialProfileCreate(
            name="k",
            credential_type="ssh_key",
            username="admin",
            private_key=_pem(),
            password="fallback",
        )
        cred_json, _ = _build_credential_json(data)
        assert cred_json["password"] == "fallback"

    def test_routeros_envelope_is_unchanged(self):
        data = CredentialProfileCreate(
            name="p", credential_type="routeros", username="admin", password="secret"
        )
        cred_json, fingerprint = _build_credential_json(data)
        assert cred_json == {"type": "routeros", "username": "admin", "password": "secret"}
        assert fingerprint is None
