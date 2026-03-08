"""
Credential encryption/decryption with dual-read (OpenBao Transit + legacy AES-256-GCM).

This module provides two encryption paths:
1. Legacy (sync): AES-256-GCM with static CREDENTIAL_ENCRYPTION_KEY — used for fallback reads.
2. Transit (async): OpenBao Transit per-tenant keys — used for all new writes.

The dual-read pattern:
- New writes always use OpenBao Transit (encrypt_credentials_transit).
- Reads prefer Transit ciphertext, falling back to legacy (decrypt_credentials_hybrid).
- Legacy functions are preserved for backward compatibility during migration.

Security properties:
- AES-256-GCM provides authenticated encryption (confidentiality + integrity)
- A unique 12-byte random nonce is generated per legacy encryption operation
- OpenBao Transit keys are AES-256-GCM96, managed entirely by OpenBao
- Ciphertext format: "vault:v1:..." for Transit, raw bytes for legacy
"""

import os


def encrypt_credentials(plaintext: str, key: bytes) -> bytes:
    """
    Encrypt a plaintext string using AES-256-GCM.

    Args:
        plaintext: The credential string to encrypt (e.g., JSON with username/password)
        key: 32-byte encryption key

    Returns:
        bytes: nonce (12 bytes) + ciphertext + GCM tag (16 bytes)

    Raises:
        ValueError: If key is not exactly 32 bytes
    """
    if len(key) != 32:
        raise ValueError(f"Key must be exactly 32 bytes, got {len(key)}")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aesgcm = AESGCM(key)
    nonce = os.urandom(12)  # 96-bit nonce, unique per encryption
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)

    # Store as: nonce (12 bytes) + ciphertext + GCM tag (included in ciphertext by library)
    return nonce + ciphertext


def decrypt_credentials(ciphertext: bytes, key: bytes) -> str:
    """
    Decrypt AES-256-GCM encrypted credentials.

    Args:
        ciphertext: bytes from encrypt_credentials (nonce + encrypted data + GCM tag)
        key: 32-byte encryption key (must match the key used for encryption)

    Returns:
        str: The original plaintext string

    Raises:
        ValueError: If key is not exactly 32 bytes
        cryptography.exceptions.InvalidTag: If authentication fails (tampered data or wrong key)
    """
    if len(key) != 32:
        raise ValueError(f"Key must be exactly 32 bytes, got {len(key)}")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = ciphertext[:12]
    encrypted_data = ciphertext[12:]

    aesgcm = AESGCM(key)
    plaintext_bytes = aesgcm.decrypt(nonce, encrypted_data, None)

    return plaintext_bytes.decode("utf-8")


# ---------------------------------------------------------------------------
# OpenBao Transit functions (async, per-tenant keys)
# ---------------------------------------------------------------------------


async def encrypt_credentials_transit(plaintext: str, tenant_id: str) -> str:
    """Encrypt via OpenBao Transit. Returns ciphertext string (vault:v1:...).

    Args:
        plaintext: The credential string to encrypt.
        tenant_id: Tenant UUID string for key lookup.

    Returns:
        Transit ciphertext string (vault:v1:base64...).
    """
    from app.services.openbao_service import get_openbao_service

    service = get_openbao_service()
    return await service.encrypt(tenant_id, plaintext.encode("utf-8"))


async def decrypt_credentials_transit(ciphertext: str, tenant_id: str) -> str:
    """Decrypt OpenBao Transit ciphertext. Returns plaintext string.

    Args:
        ciphertext: Transit ciphertext (vault:v1:...).
        tenant_id: Tenant UUID string for key lookup.

    Returns:
        Decrypted plaintext string.
    """
    from app.services.openbao_service import get_openbao_service

    service = get_openbao_service()
    plaintext_bytes = await service.decrypt(tenant_id, ciphertext)
    return plaintext_bytes.decode("utf-8")


# ---------------------------------------------------------------------------
# OpenBao Transit data encryption (async, per-tenant _data keys — Phase 30)
# ---------------------------------------------------------------------------


async def encrypt_data_transit(plaintext: str, tenant_id: str) -> str:
    """Encrypt non-credential data via OpenBao Transit using per-tenant data key.

    Used for audit log details, config backups, and reports. Data keys are
    separate from credential keys (tenant_{uuid}_data vs tenant_{uuid}).

    Args:
        plaintext: The data string to encrypt.
        tenant_id: Tenant UUID string for data key lookup.

    Returns:
        Transit ciphertext string (vault:v1:base64...).
    """
    from app.services.openbao_service import get_openbao_service

    service = get_openbao_service()
    return await service.encrypt_data(tenant_id, plaintext.encode("utf-8"))


async def decrypt_data_transit(ciphertext: str, tenant_id: str) -> str:
    """Decrypt OpenBao Transit data ciphertext. Returns plaintext string.

    Args:
        ciphertext: Transit ciphertext (vault:v1:...).
        tenant_id: Tenant UUID string for data key lookup.

    Returns:
        Decrypted plaintext string.
    """
    from app.services.openbao_service import get_openbao_service

    service = get_openbao_service()
    plaintext_bytes = await service.decrypt_data(tenant_id, ciphertext)
    return plaintext_bytes.decode("utf-8")


async def decrypt_credentials_hybrid(
    transit_ciphertext: str | None,
    legacy_ciphertext: bytes | None,
    tenant_id: str,
    legacy_key: bytes,
) -> str:
    """Dual-read: prefer Transit ciphertext, fall back to legacy.

    Args:
        transit_ciphertext: OpenBao Transit ciphertext (vault:v1:...) or None.
        legacy_ciphertext: Legacy AES-256-GCM bytes (nonce+ciphertext+tag) or None.
        tenant_id: Tenant UUID string for Transit key lookup.
        legacy_key: 32-byte legacy encryption key for fallback.

    Returns:
        Decrypted plaintext string.

    Raises:
        ValueError: If neither ciphertext is available.
    """
    if transit_ciphertext and transit_ciphertext.startswith("vault:v"):
        return await decrypt_credentials_transit(transit_ciphertext, tenant_id)
    elif legacy_ciphertext:
        return decrypt_credentials(legacy_ciphertext, legacy_key)
    else:
        raise ValueError("No credentials available (both transit and legacy are empty)")
