"""Stored key and password fallback over a real loopback SSH/SFTP session."""

import asyncio
import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import asyncssh
import pytest

from app.services import backup_service as backup


@pytest.mark.parametrize("inline", [False, True])
async def test_backup_uses_profile_key_with_inline_api_password(monkeypatch, inline):
    device = SimpleNamespace(
        tenant_id=uuid.uuid4(),
        credential_profile_id=uuid.uuid4(),
        encrypted_credentials_transit="device" if inline else None,
        encrypted_credentials=None,
    )
    profile = SimpleNamespace(encrypted_credentials_transit="profile", encrypted_credentials=None)
    result = MagicMock()
    result.scalar_one_or_none.return_value = profile
    session = AsyncMock()
    session.execute.return_value = result

    async def decrypt(transit, *args):
        return json.dumps(
            {"username": "ssh-user", "private_key": "stored"}
            if transit == "profile"
            else {"username": "api-user", "password": "api-only"}
        )

    monkeypatch.setattr(backup, "decrypt_credentials_hybrid", decrypt)
    assert await backup._backup_credentials(session, device) == {
        "username": "ssh-user",
        "private_key": "stored",
    }


@pytest.mark.parametrize(
    "device,profile,expected",
    [
        (
            {"username": "own", "private_key": "device-key"},
            {"username": "profile", "private_key": "profile-key"},
            "own",
        ),
        (
            {"username": "own", "password": "own-pass"},
            {"username": "profile", "password": "profile-pass"},
            "own",
        ),
        (None, {"username": "profile", "password": "profile-pass"}, "profile"),
    ],
)
async def test_ssh_resolution_preserves_existing_fallback(device, profile, expected):
    decrypt = AsyncMock(
        side_effect=lambda transit, *args: json.dumps(device if transit == "device" else profile)
    )
    creds = await backup._resolve_ssh_credentials(
        "device" if device else None, None, "profile", None, "tenant", decrypt=decrypt
    )
    assert creds["username"] == expected


async def test_malformed_key_error_does_not_echo_material():
    with pytest.raises(ValueError, match="Stored SSH private key could not be loaded") as error:
        backup._ssh_client_keys("not-a-key-SECRET")
    assert "SECRET" not in str(error.value)


@pytest.mark.parametrize("mode", ["key-only", "password-only", "rejected-key-password-fallback"])
async def test_capture_over_ssh_with_custom_port(tmp_path, mode):
    key = asyncssh.generate_private_key("ssh-ed25519")
    accepted = []

    class Server(asyncssh.SSHServer):
        def begin_auth(self, username):
            return True

        def public_key_auth_supported(self):
            return mode == "key-only" or mode == "rejected-key-password-fallback"

        def password_auth_supported(self):
            return mode != "key-only"

        def validate_public_key(self, username, public_key):
            valid = mode == "key-only" and public_key == key.convert_to_public()
            if valid:
                accepted.append("key")
            return valid

        def validate_password(self, username, password):
            valid = mode != "key-only" and password == "test-password"
            if valid:
                accepted.append("password")
            return valid

    async def process(proc):
        if proc.command == "/export compact":
            proc.stdout.write("/system identity\nset name=lab\n")
        elif proc.command.startswith("/system backup save"):
            (tmp_path / "portal-backup.backup").write_bytes(b"lab-backup")
        elif proc.command.startswith("/file remove"):
            (tmp_path / "portal-backup.backup").unlink()
        proc.exit(0)

    async with asyncssh.listen(
        "127.0.0.1",
        0,
        server_factory=Server,
        server_host_keys=[asyncssh.generate_private_key("ssh-ed25519")],
        process_factory=process,
        sftp_factory=lambda conn: asyncssh.SFTPServer(conn, chroot=str(tmp_path)),
    ) as server:
        options = dict(
            port=server.get_port(),
            username="test",
            password="test-password",
            private_key="" if mode == "password-only" else key.export_private_key().decode(),
        )
        text, binary = await asyncio.gather(
            backup.capture_export("127.0.0.1", **options),
            backup.capture_binary_backup("127.0.0.1", **options),
        )
    assert "set name=lab" in text
    assert binary == b"lab-backup"
    assert not (tmp_path / "portal-backup.backup").exists()
    assert accepted and set(accepted) == ({"key"} if mode == "key-only" else {"password"})
