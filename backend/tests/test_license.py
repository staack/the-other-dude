"""Tests for offline license key verification.

The security property under test is narrow but important: a key is only
accepted if it was signed by the holder of the private key, and its contents
cannot be edited after signing. Everything else is input validation.
"""

import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.license import (
    KEY_PREFIX,
    LicenseError,
    _b64url_encode,
    build_payload,
    format_key,
    verify_license_key,
)


@pytest.fixture
def signer():
    """A throwaway signing keypair, independent of the shipped one."""
    private_key = Ed25519PrivateKey.generate()
    public_hex = (
        private_key.public_key()
        .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        .hex()
    )
    return private_key, public_hex


def mint(
    private_key, licensee="Acme Networks", devices=2000, issued="2026-09-01", license_id="TOD-0001"
):
    payload = build_payload(licensee, devices, issued, license_id)
    return format_key(payload, private_key.sign(payload))


def test_valid_key_round_trips(signer):
    private_key, public_hex = signer
    info = verify_license_key(mint(private_key), public_hex)

    assert info.licensee == "Acme Networks"
    assert info.devices == 2000
    assert info.issued == "2026-09-01"
    assert info.license_id == "TOD-0001"


def test_key_is_pasteable(signer):
    """A key must survive being copied out of an email."""
    private_key, public_hex = signer
    key = mint(private_key)

    assert key.startswith(KEY_PREFIX)
    assert "\n" not in key and " " not in key
    # leading/trailing whitespace from a sloppy paste is tolerated
    assert verify_license_key(f"  {key}\n", public_hex).licensee == "Acme Networks"


def test_signature_from_a_different_key_is_rejected(signer):
    """The core property: only the real private key can mint a key."""
    _, public_hex = signer
    attacker = Ed25519PrivateKey.generate()

    with pytest.raises(LicenseError, match="signature is not valid"):
        verify_license_key(mint(attacker), public_hex)


def test_edited_payload_is_rejected(signer):
    """Bumping the device count after signing must invalidate the key."""
    private_key, public_hex = signer
    key = mint(private_key, devices=500)

    payload = build_payload("Acme Networks", 999999, "2026-09-01", "TOD-0001")
    _, signature_b64 = key[len(KEY_PREFIX) :].split(".")
    forged = f"{KEY_PREFIX}{_b64url_encode(payload)}.{signature_b64}"

    with pytest.raises(LicenseError, match="signature is not valid"):
        verify_license_key(forged, public_hex)


def test_truncated_signature_is_rejected(signer):
    private_key, public_hex = signer
    key = mint(private_key)

    with pytest.raises(LicenseError):
        verify_license_key(key[:-8], public_hex)


@pytest.mark.parametrize(
    "bad_key",
    [
        "",
        "   ",
        "not-a-key",
        "TOD1-",
        "TOD1-abc",  # no separator
        "TOD1-abc.def.ghi",  # too many separators
        "TOD1-.abc",  # empty payload
        "TOD1-abc.",  # empty signature
        "TOD1-!!!!.!!!!",  # not base64
    ],
)
def test_malformed_keys_are_rejected(signer, bad_key):
    _, public_hex = signer
    with pytest.raises(LicenseError):
        verify_license_key(bad_key, public_hex)


def test_absurdly_long_key_is_rejected_early(signer):
    _, public_hex = signer
    with pytest.raises(LicenseError, match="too long"):
        verify_license_key(KEY_PREFIX + "A" * 100_000, public_hex)


def test_missing_public_key_is_rejected(signer):
    private_key, _ = signer
    with pytest.raises(LicenseError, match="No license public key"):
        verify_license_key(mint(private_key), "")


def test_invalid_public_key_is_rejected(signer):
    private_key, _ = signer
    with pytest.raises(LicenseError, match="public key is invalid"):
        verify_license_key(mint(private_key), "nothex")


@pytest.mark.parametrize(
    "payload_obj",
    [
        {"licensee": "", "devices": 10, "issued": "2026-09-01", "id": "X"},
        {"licensee": "  ", "devices": 10, "issued": "2026-09-01", "id": "X"},
        {"devices": 10, "issued": "2026-09-01", "id": "X"},
        {"licensee": "A", "devices": 0, "issued": "2026-09-01", "id": "X"},
        {"licensee": "A", "devices": -5, "issued": "2026-09-01", "id": "X"},
        {"licensee": "A", "devices": "many", "issued": "2026-09-01", "id": "X"},
        {"licensee": "A", "devices": True, "issued": "2026-09-01", "id": "X"},
        {"licensee": "A", "devices": 10, "id": "X"},
        {"licensee": "A", "devices": 10, "issued": "2026-09-01"},
    ],
)
def test_signed_but_invalid_payloads_are_rejected(signer, payload_obj):
    """Even a correctly signed key must carry a sane payload."""
    private_key, public_hex = signer
    payload = json.dumps(payload_obj, separators=(",", ":"), sort_keys=True).encode()

    with pytest.raises(LicenseError):
        verify_license_key(format_key(payload, private_key.sign(payload)), public_hex)


def test_non_json_payload_is_rejected(signer):
    private_key, public_hex = signer
    payload = b"this is not json"

    with pytest.raises(LicenseError, match="not valid JSON"):
        verify_license_key(format_key(payload, private_key.sign(payload)), public_hex)


def test_shipped_public_key_is_a_valid_ed25519_key():
    """The key baked into config must at least be structurally usable."""
    from app.config import settings

    assert len(bytes.fromhex(settings.LICENSE_PUBLIC_KEY)) == 32


# ---------------------------------------------------------------------------
# Router integration: how a stored key becomes reported license status
# ---------------------------------------------------------------------------


async def test_active_license_returns_verified_stored_key(signer, monkeypatch):
    from app.config import settings as app_settings
    from app.routers import settings as settings_router

    private_key, public_hex = signer
    monkeypatch.setattr(app_settings, "LICENSE_PUBLIC_KEY", public_hex)

    async def fake_get(_keys):
        return {settings_router.LICENSE_KEY_SETTING: mint(private_key)}

    monkeypatch.setattr(settings_router, "_get_system_settings", fake_get)

    info, key_invalid = await settings_router._active_license()

    assert info is not None
    assert info.licensee == "Acme Networks"
    assert info.devices == 2000
    assert key_invalid is False


async def test_active_license_flags_a_key_that_no_longer_verifies(signer, monkeypatch):
    """A tampered or stale stored key must be reported, not silently ignored."""
    from app.config import settings as app_settings
    from app.routers import settings as settings_router

    _, public_hex = signer
    attacker = Ed25519PrivateKey.generate()
    monkeypatch.setattr(app_settings, "LICENSE_PUBLIC_KEY", public_hex)

    async def fake_get(_keys):
        return {settings_router.LICENSE_KEY_SETTING: mint(attacker)}

    monkeypatch.setattr(settings_router, "_get_system_settings", fake_get)

    info, key_invalid = await settings_router._active_license()

    assert info is None
    assert key_invalid is True


async def test_active_license_with_no_key_is_not_an_error(monkeypatch):
    from app.routers import settings as settings_router

    async def fake_get(_keys):
        return {settings_router.LICENSE_KEY_SETTING: None}

    monkeypatch.setattr(settings_router, "_get_system_settings", fake_get)

    info, key_invalid = await settings_router._active_license()

    assert info is None
    assert key_invalid is False


def test_license_writer_uses_the_user_id_attribute_that_exists():
    """Guards a real bug: the auth object exposes user_id, not id.

    Both license endpoints call _set_system_settings with the current user, so
    referencing the wrong attribute would only fail at runtime, on activation.
    """
    import inspect

    from app.routers import settings as settings_router

    source = inspect.getsource(settings_router)
    assert "str(user.id)" not in source
    assert source.count("str(user.user_id)") >= 3
