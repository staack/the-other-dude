"""Key hierarchy management service for zero-knowledge architecture.

Provides CRUD operations for encrypted key bundles (UserKeySet),
append-only audit logging (KeyAccessLog), and OpenBao Transit
tenant key provisioning with credential migration.
"""

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.key_set import KeyAccessLog, UserKeySet

logger = logging.getLogger(__name__)


async def store_user_key_set(
    db: AsyncSession,
    user_id: UUID,
    tenant_id: UUID | None,
    encrypted_private_key: bytes,
    private_key_nonce: bytes,
    encrypted_vault_key: bytes,
    vault_key_nonce: bytes,
    public_key: bytes,
    pbkdf2_salt: bytes,
    hkdf_salt: bytes,
    pbkdf2_iterations: int = 650000,
) -> UserKeySet:
    """Store encrypted key bundle during registration.

    Creates a new UserKeySet for the user. Each user has exactly one
    key set (UNIQUE constraint on user_id).

    Args:
        db: Async database session.
        user_id: The user's UUID.
        tenant_id: The user's tenant UUID (None for super_admin).
        encrypted_private_key: RSA private key wrapped by AUK (AES-GCM).
        private_key_nonce: 12-byte AES-GCM nonce for private key.
        encrypted_vault_key: Tenant vault key wrapped by user's public key.
        vault_key_nonce: 12-byte AES-GCM nonce for vault key.
        public_key: RSA-2048 public key in SPKI format.
        pbkdf2_salt: 32-byte salt for PBKDF2 key derivation.
        hkdf_salt: 32-byte salt for HKDF Secret Key derivation.
        pbkdf2_iterations: PBKDF2 iteration count (default 650000).

    Returns:
        The created UserKeySet instance.
    """
    # Remove any existing key set (e.g. from a failed prior upgrade attempt)
    from sqlalchemy import delete
    await db.execute(delete(UserKeySet).where(UserKeySet.user_id == user_id))

    key_set = UserKeySet(
        user_id=user_id,
        tenant_id=tenant_id,
        encrypted_private_key=encrypted_private_key,
        private_key_nonce=private_key_nonce,
        encrypted_vault_key=encrypted_vault_key,
        vault_key_nonce=vault_key_nonce,
        public_key=public_key,
        pbkdf2_salt=pbkdf2_salt,
        hkdf_salt=hkdf_salt,
        pbkdf2_iterations=pbkdf2_iterations,
    )
    db.add(key_set)
    await db.flush()
    return key_set


async def get_user_key_set(
    db: AsyncSession, user_id: UUID
) -> UserKeySet | None:
    """Retrieve encrypted key bundle for login response.

    Args:
        db: Async database session.
        user_id: The user's UUID.

    Returns:
        The UserKeySet if found, None otherwise.
    """
    result = await db.execute(
        select(UserKeySet).where(UserKeySet.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def log_key_access(
    db: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    key_version: int | None = None,
    ip_address: str | None = None,
    device_id: UUID | None = None,
    justification: str | None = None,
    correlation_id: str | None = None,
) -> None:
    """Append to immutable key_access_log.

    This table is append-only (INSERT+SELECT only via RLS policy).
    No UPDATE or DELETE is permitted.

    Args:
        db: Async database session.
        tenant_id: The tenant UUID for RLS isolation.
        user_id: The user who performed the action (None for system ops).
        action: Action description (e.g., 'create_key_set', 'decrypt_vault_key').
        resource_type: Optional resource type being accessed.
        resource_id: Optional resource identifier.
        key_version: Optional key version involved.
        ip_address: Optional client IP address.
        device_id: Optional device UUID for credential access tracking.
        justification: Optional justification for the access (e.g., 'api_backup').
        correlation_id: Optional correlation ID for request tracing.
    """
    log_entry = KeyAccessLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        key_version=key_version,
        ip_address=ip_address,
        device_id=device_id,
        justification=justification,
        correlation_id=correlation_id,
    )
    db.add(log_entry)
    await db.flush()


# ---------------------------------------------------------------------------
# OpenBao Transit tenant key provisioning and credential migration
# ---------------------------------------------------------------------------


async def provision_tenant_key(db: AsyncSession, tenant_id: UUID) -> str:
    """Provision an OpenBao Transit key for a tenant and update the tenant record.

    Idempotent: if the key already exists in OpenBao, it's a no-op on the
    OpenBao side. The tenant record is always updated with the key name.

    Args:
        db: Async database session (admin engine, no RLS).
        tenant_id: Tenant UUID.

    Returns:
        The key name (tenant_{uuid}).
    """
    from app.models.tenant import Tenant
    from app.services.openbao_service import get_openbao_service

    openbao = get_openbao_service()
    key_name = f"tenant_{tenant_id}"

    await openbao.create_tenant_key(str(tenant_id))

    # Update tenant record with key name
    result = await db.execute(
        select(Tenant).where(Tenant.id == tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if tenant:
        tenant.openbao_key_name = key_name
        await db.flush()

    logger.info(
        "Provisioned OpenBao Transit key for tenant %s (key=%s)",
        tenant_id,
        key_name,
    )
    return key_name


async def migrate_tenant_credentials(db: AsyncSession, tenant_id: UUID) -> dict:
    """Re-encrypt all legacy credentials for a tenant from AES-256-GCM to Transit.

    Migrates device credentials, CA private keys, device cert private keys,
    and notification channel secrets. Already-migrated items are skipped.

    Args:
        db: Async database session (admin engine, no RLS).
        tenant_id: Tenant UUID.

    Returns:
        Dict with counts: {"devices": N, "cas": N, "certs": N, "channels": N, "errors": N}
    """
    from app.config import settings
    from app.models.alert import NotificationChannel
    from app.models.certificate import CertificateAuthority, DeviceCertificate
    from app.models.device import Device
    from app.services.crypto import decrypt_credentials
    from app.services.openbao_service import get_openbao_service

    openbao = get_openbao_service()
    legacy_key = settings.get_encryption_key_bytes()
    tid = str(tenant_id)

    counts = {"devices": 0, "cas": 0, "certs": 0, "channels": 0, "errors": 0}

    # --- Migrate device credentials ---
    result = await db.execute(
        select(Device).where(
            Device.tenant_id == tenant_id,
            Device.encrypted_credentials.isnot(None),
            (Device.encrypted_credentials_transit.is_(None) | (Device.encrypted_credentials_transit == "")),
        )
    )
    for device in result.scalars().all():
        try:
            plaintext = decrypt_credentials(device.encrypted_credentials, legacy_key)
            device.encrypted_credentials_transit = await openbao.encrypt(tid, plaintext.encode("utf-8"))
            counts["devices"] += 1
        except Exception as e:
            logger.error("Failed to migrate device %s credentials: %s", device.id, e)
            counts["errors"] += 1

    # --- Migrate CA private keys ---
    result = await db.execute(
        select(CertificateAuthority).where(
            CertificateAuthority.tenant_id == tenant_id,
            CertificateAuthority.encrypted_private_key.isnot(None),
            (CertificateAuthority.encrypted_private_key_transit.is_(None) | (CertificateAuthority.encrypted_private_key_transit == "")),
        )
    )
    for ca in result.scalars().all():
        try:
            plaintext = decrypt_credentials(ca.encrypted_private_key, legacy_key)
            ca.encrypted_private_key_transit = await openbao.encrypt(tid, plaintext.encode("utf-8"))
            counts["cas"] += 1
        except Exception as e:
            logger.error("Failed to migrate CA %s private key: %s", ca.id, e)
            counts["errors"] += 1

    # --- Migrate device cert private keys ---
    result = await db.execute(
        select(DeviceCertificate).where(
            DeviceCertificate.tenant_id == tenant_id,
            DeviceCertificate.encrypted_private_key.isnot(None),
            (DeviceCertificate.encrypted_private_key_transit.is_(None) | (DeviceCertificate.encrypted_private_key_transit == "")),
        )
    )
    for cert in result.scalars().all():
        try:
            plaintext = decrypt_credentials(cert.encrypted_private_key, legacy_key)
            cert.encrypted_private_key_transit = await openbao.encrypt(tid, plaintext.encode("utf-8"))
            counts["certs"] += 1
        except Exception as e:
            logger.error("Failed to migrate cert %s private key: %s", cert.id, e)
            counts["errors"] += 1

    # --- Migrate notification channel secrets ---
    result = await db.execute(
        select(NotificationChannel).where(
            NotificationChannel.tenant_id == tenant_id,
        )
    )
    for ch in result.scalars().all():
        migrated_any = False
        try:
            # SMTP password
            if ch.smtp_password and not ch.smtp_password_transit:
                plaintext = decrypt_credentials(ch.smtp_password, legacy_key)
                ch.smtp_password_transit = await openbao.encrypt(tid, plaintext.encode("utf-8"))
                migrated_any = True
            if migrated_any:
                counts["channels"] += 1
        except Exception as e:
            logger.error("Failed to migrate channel %s secrets: %s", ch.id, e)
            counts["errors"] += 1

    await db.flush()

    logger.info(
        "Tenant %s credential migration complete: %s",
        tenant_id,
        counts,
    )
    return counts


async def provision_existing_tenants(db: AsyncSession) -> dict:
    """Provision OpenBao Transit keys for all existing tenants and migrate credentials.

    Called on app startup to ensure all tenants have Transit keys.
    Idempotent -- running multiple times is safe (already-migrated items are skipped).

    Args:
        db: Async database session (admin engine, no RLS).

    Returns:
        Summary dict with total counts across all tenants.
    """
    from app.models.tenant import Tenant

    result = await db.execute(select(Tenant))
    tenants = result.scalars().all()

    total = {"tenants": len(tenants), "devices": 0, "cas": 0, "certs": 0, "channels": 0, "errors": 0}

    for tenant in tenants:
        try:
            await provision_tenant_key(db, tenant.id)
            counts = await migrate_tenant_credentials(db, tenant.id)
            total["devices"] += counts["devices"]
            total["cas"] += counts["cas"]
            total["certs"] += counts["certs"]
            total["channels"] += counts["channels"]
            total["errors"] += counts["errors"]
        except Exception as e:
            logger.error("Failed to provision/migrate tenant %s: %s", tenant.id, e)
            total["errors"] += 1

    await db.commit()

    logger.info("Existing tenant provisioning complete: %s", total)
    return total
