"""Key set and key access log models for zero-knowledge architecture."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UserKeySet(Base):
    """Encrypted key bundle for a user.

    Stores the RSA private key (wrapped by AUK), tenant vault key
    (wrapped by AUK), RSA public key, and key derivation salts.
    One key set per user (UNIQUE on user_id).
    """

    __tablename__ = "user_key_sets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True,  # NULL for super_admin
    )
    encrypted_private_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    private_key_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    encrypted_vault_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    vault_key_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    public_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    pbkdf2_iterations: Mapped[int] = mapped_column(
        Integer,
        server_default=func.literal_column("650000"),
        nullable=False,
    )
    pbkdf2_salt: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    hkdf_salt: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_version: Mapped[int] = mapped_column(
        Integer,
        server_default=func.literal_column("1"),
        nullable=False,
    )
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

    # Relationships
    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
    tenant: Mapped["Tenant | None"] = relationship("Tenant")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<UserKeySet id={self.id} user_id={self.user_id} version={self.key_version}>"


class KeyAccessLog(Base):
    """Immutable audit trail for key operations.

    Append-only: INSERT+SELECT only, no UPDATE/DELETE via RLS.
    """

    __tablename__ = "key_access_log"

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
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    resource_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 29 extensions for device credential access tracking
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id"),
        nullable=True,
    )
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<KeyAccessLog id={self.id} action={self.action!r}>"
