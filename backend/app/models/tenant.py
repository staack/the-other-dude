"""Tenant model — represents an MSP client organization."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, LargeBinary, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Zero-knowledge key management (Phase 28+29)
    encrypted_vault_key: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    vault_key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    openbao_key_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships — passive_deletes=True lets the DB ON DELETE CASCADE handle cleanup
    users: Mapped[list["User"]] = relationship(
        "User", back_populates="tenant", passive_deletes=True
    )  # type: ignore[name-defined]
    devices: Mapped[list["Device"]] = relationship(
        "Device", back_populates="tenant", passive_deletes=True
    )  # type: ignore[name-defined]
    device_groups: Mapped[list["DeviceGroup"]] = relationship(
        "DeviceGroup", back_populates="tenant", passive_deletes=True
    )  # type: ignore[name-defined]
    device_tags: Mapped[list["DeviceTag"]] = relationship(
        "DeviceTag", back_populates="tenant", passive_deletes=True
    )  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<Tenant id={self.id} name={self.name!r}>"
