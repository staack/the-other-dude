"""Certificate Authority and Device Certificate ORM models.

Supports the Internal Certificate Authority feature:
- CertificateAuthority: one per tenant, stores encrypted CA private key + public cert
- DeviceCertificate: per-device signed certificate with lifecycle status tracking
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CertificateAuthority(Base):
    """Per-tenant root Certificate Authority.

    Each tenant has at most one CA. The CA private key is encrypted with
    AES-256-GCM before storage (using the same pattern as device credentials).
    The public cert_pem is not sensitive and can be distributed freely.
    """

    __tablename__ = "certificate_authorities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    common_name: Mapped[str] = mapped_column(String(255), nullable=False)
    cert_pem: Mapped[str] = mapped_column(Text, nullable=False)
    encrypted_private_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    serial_number: Mapped[str] = mapped_column(String(64), nullable=False)
    fingerprint_sha256: Mapped[str] = mapped_column(String(95), nullable=False)
    not_valid_before: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    not_valid_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # OpenBao Transit ciphertext (dual-write migration)
    encrypted_private_key_transit: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<CertificateAuthority id={self.id} cn={self.common_name!r} tenant={self.tenant_id}>"
        )


class DeviceCertificate(Base):
    """Per-device TLS certificate signed by the tenant's CA.

    Status lifecycle:
        issued -> deploying -> deployed -> expiring -> expired
                                        \\-> revoked
                                        \\-> superseded (when rotated)
    """

    __tablename__ = "device_certificates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )
    ca_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("certificate_authorities.id", ondelete="CASCADE"),
        nullable=False,
    )
    common_name: Mapped[str] = mapped_column(String(255), nullable=False)
    serial_number: Mapped[str] = mapped_column(String(64), nullable=False)
    fingerprint_sha256: Mapped[str] = mapped_column(String(95), nullable=False)
    cert_pem: Mapped[str] = mapped_column(Text, nullable=False)
    encrypted_private_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    not_valid_before: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    not_valid_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # OpenBao Transit ciphertext (dual-write migration)
    encrypted_private_key_transit: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="issued")
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<DeviceCertificate id={self.id} cn={self.common_name!r} status={self.status}>"
