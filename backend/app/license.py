"""Offline license key verification.

Keys are Ed25519-signed blobs that are verified locally with no network call
and no license server, which is what the public blog post promises: no
phone-home, no tracking, no feature gating. The signing key never leaves the
maintainer's machine; only the public key ships with the application.

A license raises the device count shown on the About page. It does not unlock
features and it does not expire — the same binary serves everyone, and a key
that worked yesterday works forever.

Key format::

    TOD1-<base64url(payload_json)>.<base64url(signature)>

The payload is compact JSON so a key stays short enough to paste from an
email in one piece.
"""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

KEY_PREFIX = "TOD1-"

# Maximum accepted key length. A well-formed key is ~250 chars; this only
# exists so a pasted novel is rejected before any parsing work happens.
MAX_KEY_CHARS = 4096


class LicenseError(ValueError):
    """Raised when a license key is malformed, unsigned, or altered."""


@dataclass(frozen=True)
class LicenseInfo:
    """The verified contents of a license key."""

    licensee: str
    devices: int
    issued: str
    license_id: str


def _b64url_decode(segment: str) -> bytes:
    """Decode unpadded base64url, rejecting anything that is not valid."""
    padding = "=" * (-len(segment) % 4)
    try:
        return base64.urlsafe_b64decode(segment + padding)
    except (binascii.Error, ValueError) as exc:
        raise LicenseError("License key is not valid base64.") from exc


def _b64url_encode(raw: bytes) -> str:
    """Encode to unpadded base64url."""
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def build_payload(licensee: str, devices: int, issued: str, license_id: str) -> bytes:
    """Serialize a payload deterministically.

    Signing and verification must agree byte for byte, so key order and
    separators are pinned here rather than left to json defaults.
    """
    return json.dumps(
        {
            "licensee": licensee,
            "devices": devices,
            "issued": issued,
            "id": license_id,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()


def format_key(payload: bytes, signature: bytes) -> str:
    """Assemble a pasteable key from a payload and its signature."""
    return f"{KEY_PREFIX}{_b64url_encode(payload)}.{_b64url_encode(signature)}"


def verify_license_key(key: str, public_key_hex: str) -> LicenseInfo:
    """Verify a license key and return its contents.

    Raises LicenseError for anything that is not a genuine, unaltered key
    signed by the holder of the matching private key.
    """
    if not public_key_hex:
        raise LicenseError("No license public key is configured.")

    key = (key or "").strip()
    if not key:
        raise LicenseError("License key is empty.")
    if len(key) > MAX_KEY_CHARS:
        raise LicenseError("License key is too long.")
    if not key.startswith(KEY_PREFIX):
        raise LicenseError("License key does not look like a TOD key.")

    body = key[len(KEY_PREFIX) :]
    if body.count(".") != 1:
        raise LicenseError("License key is malformed.")

    payload_b64, signature_b64 = body.split(".")
    if not payload_b64 or not signature_b64:
        raise LicenseError("License key is malformed.")

    payload = _b64url_decode(payload_b64)
    signature = _b64url_decode(signature_b64)

    try:
        public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
    except (ValueError, binascii.Error) as exc:
        raise LicenseError("Configured license public key is invalid.") from exc

    try:
        public_key.verify(signature, payload)
    except InvalidSignature as exc:
        raise LicenseError("License key signature is not valid.") from exc

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise LicenseError("License key payload is not valid JSON.") from exc

    if not isinstance(data, dict):
        raise LicenseError("License key payload is not an object.")

    licensee = data.get("licensee")
    devices = data.get("devices")
    issued = data.get("issued")
    license_id = data.get("id")

    if not isinstance(licensee, str) or not licensee.strip():
        raise LicenseError("License key is missing a licensee.")
    # bool is a subclass of int; a payload of {"devices": true} must not pass.
    if not isinstance(devices, int) or isinstance(devices, bool) or devices < 1:
        raise LicenseError("License key has an invalid device count.")
    if not isinstance(issued, str) or not issued:
        raise LicenseError("License key is missing an issue date.")
    if not isinstance(license_id, str) or not license_id:
        raise LicenseError("License key is missing an id.")

    return LicenseInfo(
        licensee=licensee.strip(),
        devices=devices,
        issued=issued,
        license_id=license_id,
    )
