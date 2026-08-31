"""SSH private key handling for device credential profiles.

Keys are stored unencrypted inside the OpenBao Transit envelope. Any passphrase
supplied at upload is used once, here, to decrypt the key and is then discarded:
it is never written to the database, a log, or an audit record.

That is deliberate. A passphrase stored beside the key it protects secures
nothing, since anyone able to decrypt the envelope holds both. An unattended
poller cannot prompt for one, so the choice is between storing it and stripping
it, and stripping is strictly better. Transit envelope encryption is the
protection at rest, and it is stronger than PBKDF2 over an operator's passphrase.

Every error raised here is safe to log: none of them interpolate key material or
the supplied passphrase, and all suppress exception chaining so a traceback
cannot surface the underlying bytes.
"""

import base64
import hashlib

from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
    load_ssh_private_key,
)

__all__ = ["SSHKeyError", "normalize_private_key"]


class SSHKeyError(ValueError):
    """Raised when a supplied SSH private key cannot be used.

    The message is always safe to log: it never contains key material or the
    passphrase.
    """


def _fingerprint(key) -> str:
    """Return the public key fingerprint in ssh-keygen -l format."""
    blob = key.public_key().public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH).split()[1]
    digest = hashlib.sha256(base64.b64decode(blob)).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


def normalize_private_key(private_key: str, passphrase: str | None) -> tuple[str, str]:
    """Validate a private key and return it unencrypted, with its fingerprint.

    Args:
        private_key: PEM or OpenSSH private key text, optionally passphrase-protected.
        passphrase: the passphrase, if the key is protected. Used once and discarded.

    Returns:
        (unencrypted_pem, public_key_fingerprint) -- the fingerprint is not secret
        and is safe to return from the API so operators can identify the stored key.

    Raises:
        SSHKeyError: the key is unreadable, or the passphrase is missing or wrong.
    """
    data = private_key.strip().encode()
    password = passphrase.encode() if passphrase else None

    try:
        key = load_ssh_private_key(data, password=password)
    except TypeError:
        # cryptography raises TypeError both when a password is required and
        # absent, and when one is supplied for an unencrypted key.
        if password is None:
            raise SSHKeyError(
                "This private key is passphrase-protected. Supply its passphrase; "
                "it is used once to decrypt the key and is never stored."
            ) from None
        try:
            key = load_ssh_private_key(data, password=None)
        except Exception:
            raise SSHKeyError("Could not load the private key.") from None
    except ValueError:
        if password is not None:
            raise SSHKeyError(
                "Could not decrypt the private key: the passphrase is wrong, "
                "or the key is malformed."
            ) from None
        raise SSHKeyError(
            "Could not parse the private key. Expected an OpenSSH or PEM private key "
            "(the file without a .pub extension)."
        ) from None
    except Exception:
        raise SSHKeyError("Could not load the private key.") from None

    try:
        normalized = key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()).decode()
    except Exception:
        raise SSHKeyError("Unsupported private key type.") from None

    return normalized, _fingerprint(key)
