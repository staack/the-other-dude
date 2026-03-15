"""Certificate Authority service — CA generation, device cert signing, lifecycle.

This module provides the core PKI functionality for the Internal Certificate
Authority feature.  All functions receive an ``AsyncSession`` and an
``encryption_key`` as parameters (no direct Settings access) for testability.

Security notes:
- CA private keys are encrypted with AES-256-GCM before database storage.
- PEM key material is NEVER logged.
- Device keys are decrypted only when needed for NATS transmission.
"""

from __future__ import annotations

import datetime
import ipaddress
import logging
from uuid import UUID

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.certificate import CertificateAuthority, DeviceCertificate
from app.services.crypto import (
    decrypt_credentials_hybrid,
    encrypt_credentials_transit,
)

logger = logging.getLogger(__name__)

# Valid status transitions for the device certificate lifecycle.
_VALID_TRANSITIONS: dict[str, set[str]] = {
    "issued": {"deploying"},
    "deploying": {"deployed", "issued"},  # issued = rollback on deploy failure
    "deployed": {"expiring", "revoked", "superseded"},
    "expiring": {"expired", "revoked", "superseded"},
    "expired": {"superseded"},
    "revoked": set(),
    "superseded": set(),
}


# ---------------------------------------------------------------------------
# CA Generation
# ---------------------------------------------------------------------------


async def generate_ca(
    db: AsyncSession,
    tenant_id: UUID,
    common_name: str,
    validity_years: int,
    encryption_key: bytes,
) -> CertificateAuthority:
    """Generate a self-signed root CA for a tenant.

    Args:
        db: Async database session.
        tenant_id: Tenant UUID — only one CA per tenant.
        common_name: CN for the CA certificate (e.g., "Portal Root CA").
        validity_years: How many years the CA cert is valid.
        encryption_key: 32-byte AES-256-GCM key for encrypting the CA private key.

    Returns:
        The newly created ``CertificateAuthority`` model instance.

    Raises:
        ValueError: If the tenant already has a CA.
    """
    # Ensure one CA per tenant
    existing = await get_ca_for_tenant(db, tenant_id)
    if existing is not None:
        raise ValueError(
            f"Tenant {tenant_id} already has a CA (id={existing.id}). "
            "Delete the existing CA before creating a new one."
        )

    # Generate RSA 2048 key pair
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    now = datetime.datetime.now(datetime.timezone.utc)
    expiry = now + datetime.timedelta(days=365 * validity_years)

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "The Other Dude"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ]
    )

    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(expiry)
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )

    # Serialize public cert to PEM
    cert_pem = ca_cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")

    # Serialize private key to PEM, then encrypt with OpenBao Transit
    key_pem = ca_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("utf-8")
    encrypted_key_transit = await encrypt_credentials_transit(key_pem, str(tenant_id))

    # Compute SHA-256 fingerprint (colon-separated hex)
    fingerprint_bytes = ca_cert.fingerprint(hashes.SHA256())
    fingerprint = ":".join(f"{b:02X}" for b in fingerprint_bytes)

    # Serial number as hex string
    serial_hex = format(ca_cert.serial_number, "X")

    model = CertificateAuthority(
        tenant_id=tenant_id,
        common_name=common_name,
        cert_pem=cert_pem,
        encrypted_private_key=b"",  # Legacy column kept for schema compat
        encrypted_private_key_transit=encrypted_key_transit,
        serial_number=serial_hex,
        fingerprint_sha256=fingerprint,
        not_valid_before=now,
        not_valid_after=expiry,
    )
    db.add(model)
    await db.flush()

    logger.info(
        "Generated CA for tenant %s: cn=%s fingerprint=%s",
        tenant_id,
        common_name,
        fingerprint,
    )
    return model


# ---------------------------------------------------------------------------
# Device Certificate Signing
# ---------------------------------------------------------------------------


async def sign_device_cert(
    db: AsyncSession,
    ca: CertificateAuthority,
    device_id: UUID,
    hostname: str,
    ip_address: str,
    validity_days: int,
    encryption_key: bytes,
) -> DeviceCertificate:
    """Sign a per-device TLS certificate using the tenant's CA.

    Args:
        db: Async database session.
        ca: The tenant's CertificateAuthority model instance.
        device_id: UUID of the device receiving the cert.
        hostname: Device hostname — used as CN and SAN DNSName.
        ip_address: Device IP — used as SAN IPAddress.
        validity_days: Certificate validity in days.
        encryption_key: 32-byte AES-256-GCM key for encrypting the device private key.

    Returns:
        The newly created ``DeviceCertificate`` model instance (status='issued').
    """
    # Decrypt CA private key (dual-read: Transit preferred, legacy fallback)
    ca_key_pem = await decrypt_credentials_hybrid(
        ca.encrypted_private_key_transit,
        ca.encrypted_private_key,
        str(ca.tenant_id),
        encryption_key,
    )
    ca_key = serialization.load_pem_private_key(ca_key_pem.encode("utf-8"), password=None)

    # Load CA certificate for issuer info and AuthorityKeyIdentifier
    ca_cert = x509.load_pem_x509_certificate(ca.cert_pem.encode("utf-8"))

    # Generate device RSA 2048 key
    device_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    now = datetime.datetime.now(datetime.timezone.utc)
    expiry = now + datetime.timedelta(days=validity_days)

    device_cert = (
        x509.CertificateBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "The Other Dude"),
                    x509.NameAttribute(NameOID.COMMON_NAME, hostname),
                ]
            )
        )
        .issuer_name(ca_cert.subject)
        .public_key(device_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(expiry)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.IPAddress(ipaddress.ip_address(ip_address)),
                    x509.DNSName(hostname),
                ]
            ),
            critical=False,
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(
                ca_cert.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).value
            ),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )

    # Serialize device cert and key to PEM
    cert_pem = device_cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")
    key_pem = device_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("utf-8")

    # Encrypt device private key via OpenBao Transit
    encrypted_key_transit = await encrypt_credentials_transit(key_pem, str(ca.tenant_id))

    # Compute fingerprint
    fingerprint_bytes = device_cert.fingerprint(hashes.SHA256())
    fingerprint = ":".join(f"{b:02X}" for b in fingerprint_bytes)

    serial_hex = format(device_cert.serial_number, "X")

    model = DeviceCertificate(
        tenant_id=ca.tenant_id,
        device_id=device_id,
        ca_id=ca.id,
        common_name=hostname,
        serial_number=serial_hex,
        fingerprint_sha256=fingerprint,
        cert_pem=cert_pem,
        encrypted_private_key=b"",  # Legacy column kept for schema compat
        encrypted_private_key_transit=encrypted_key_transit,
        not_valid_before=now,
        not_valid_after=expiry,
        status="issued",
    )
    db.add(model)
    await db.flush()

    logger.info(
        "Signed device cert for device %s: cn=%s fingerprint=%s",
        device_id,
        hostname,
        fingerprint,
    )
    return model


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


async def get_ca_for_tenant(
    db: AsyncSession,
    tenant_id: UUID,
) -> CertificateAuthority | None:
    """Return the tenant's CA, or None if not yet initialized."""
    result = await db.execute(
        select(CertificateAuthority).where(CertificateAuthority.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def get_device_certs(
    db: AsyncSession,
    tenant_id: UUID,
    device_id: UUID | None = None,
) -> list[DeviceCertificate]:
    """List device certificates for a tenant.

    Args:
        db: Async database session.
        tenant_id: Tenant UUID.
        device_id: If provided, filter to certs for this device only.

    Returns:
        List of DeviceCertificate models (excludes superseded by default).
    """
    stmt = (
        select(DeviceCertificate)
        .where(DeviceCertificate.tenant_id == tenant_id)
        .where(DeviceCertificate.status != "superseded")
    )
    if device_id is not None:
        stmt = stmt.where(DeviceCertificate.device_id == device_id)
    stmt = stmt.order_by(DeviceCertificate.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Status Management
# ---------------------------------------------------------------------------


async def update_cert_status(
    db: AsyncSession,
    cert_id: UUID,
    status: str,
    deployed_at: datetime.datetime | None = None,
) -> DeviceCertificate:
    """Update a device certificate's lifecycle status.

    Validates that the transition is allowed by the state machine:
        issued -> deploying -> deployed -> expiring -> expired
                                        \\-> revoked
                                        \\-> superseded

    Args:
        db: Async database session.
        cert_id: Certificate UUID.
        status: New status value.
        deployed_at: Timestamp to set when transitioning to 'deployed'.

    Returns:
        The updated DeviceCertificate model.

    Raises:
        ValueError: If the certificate is not found or the transition is invalid.
    """
    result = await db.execute(select(DeviceCertificate).where(DeviceCertificate.id == cert_id))
    cert = result.scalar_one_or_none()
    if cert is None:
        raise ValueError(f"Device certificate {cert_id} not found")

    allowed = _VALID_TRANSITIONS.get(cert.status, set())
    if status not in allowed:
        raise ValueError(
            f"Invalid status transition: {cert.status} -> {status}. "
            f"Allowed transitions from '{cert.status}': {allowed or 'none'}"
        )

    cert.status = status
    cert.updated_at = datetime.datetime.now(datetime.timezone.utc)

    if status == "deployed" and deployed_at is not None:
        cert.deployed_at = deployed_at
    elif status == "deployed":
        cert.deployed_at = cert.updated_at

    await db.flush()

    logger.info(
        "Updated cert %s status to %s",
        cert_id,
        status,
    )
    return cert


# ---------------------------------------------------------------------------
# Cert Data for Deployment
# ---------------------------------------------------------------------------


async def get_cert_for_deploy(
    db: AsyncSession,
    cert_id: UUID,
    encryption_key: bytes,
) -> tuple[str, str, str]:
    """Retrieve and decrypt certificate data for NATS deployment.

    Returns the device cert PEM, decrypted device key PEM, and the CA cert
    PEM — everything needed to push to a device via the Go poller.

    Args:
        db: Async database session.
        cert_id: Device certificate UUID.
        encryption_key: 32-byte AES-256-GCM key to decrypt the device private key.

    Returns:
        Tuple of (cert_pem, key_pem_decrypted, ca_cert_pem).

    Raises:
        ValueError: If the certificate or its CA is not found.
    """
    result = await db.execute(select(DeviceCertificate).where(DeviceCertificate.id == cert_id))
    cert = result.scalar_one_or_none()
    if cert is None:
        raise ValueError(f"Device certificate {cert_id} not found")

    # Fetch the CA for the ca_cert_pem
    ca_result = await db.execute(
        select(CertificateAuthority).where(CertificateAuthority.id == cert.ca_id)
    )
    ca = ca_result.scalar_one_or_none()
    if ca is None:
        raise ValueError(f"CA {cert.ca_id} not found for certificate {cert_id}")

    # Decrypt device private key (dual-read: Transit preferred, legacy fallback)
    key_pem = await decrypt_credentials_hybrid(
        cert.encrypted_private_key_transit,
        cert.encrypted_private_key,
        str(cert.tenant_id),
        encryption_key,
    )

    return cert.cert_pem, key_pem, ca.cert_pem
