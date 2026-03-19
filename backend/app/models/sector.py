"""Sector model -- directional antenna grouping within a site."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Sector(Base):
    __tablename__ = "sectors"
    __table_args__ = (
        UniqueConstraint("tenant_id", "site_id", "name", name="uq_sectors_tenant_site_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    azimuth: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    site: Mapped["Site"] = relationship("Site")  # type: ignore[name-defined]
    devices: Mapped[list["Device"]] = relationship(  # type: ignore[name-defined]
        "Device", back_populates="sector", foreign_keys="[Device.sector_id]"
    )

    def __repr__(self) -> str:
        return f"<Sector id={self.id} name={self.name!r} site_id={self.site_id}>"
