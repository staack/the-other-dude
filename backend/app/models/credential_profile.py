"""CredentialProfile model -- reusable credential sets for devices."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class CredentialProfile(Base):
    __tablename__ = "credential_profiles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_credential_profiles_tenant_name"),
    )

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
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_type: Mapped[str] = mapped_column(String(50), nullable=False)
    encrypted_credentials: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    encrypted_credentials_transit: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant")  # type: ignore[name-defined]
    devices: Mapped[list["Device"]] = relationship(  # type: ignore[name-defined]
        "Device",
        back_populates="credential_profile",
        foreign_keys="[Device.credential_profile_id]",
    )

    def __repr__(self) -> str:
        return (
            f"<CredentialProfile id={self.id} name={self.name!r}"
            f" type={self.credential_type!r} tenant_id={self.tenant_id}>"
        )
