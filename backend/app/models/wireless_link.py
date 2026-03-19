"""WirelessLink model -- AP-to-CPE link state tracking for link discovery."""

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class LinkState(str, Enum):
    """Link health state machine values."""

    DISCOVERED = "discovered"
    ACTIVE = "active"
    DEGRADED = "degraded"
    DOWN = "down"
    STALE = "stale"


class WirelessLink(Base):
    __tablename__ = "wireless_links"
    __table_args__ = (
        UniqueConstraint("ap_device_id", "cpe_device_id", name="uq_wireless_links_ap_cpe"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    ap_device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )
    cpe_device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    interface: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_mac: Mapped[str] = mapped_column(String(17), nullable=False)
    signal_strength: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tx_ccq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tx_rate: Mapped[str | None] = mapped_column(String(50), nullable=True)
    rx_rate: Mapped[str | None] = mapped_column(String(50), nullable=True)
    state: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=LinkState.DISCOVERED.value,
    )
    missed_polls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    discovered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    ap_device: Mapped["Device"] = relationship(  # type: ignore[name-defined]
        "Device", foreign_keys=[ap_device_id]
    )
    cpe_device: Mapped["Device"] = relationship(  # type: ignore[name-defined]
        "Device", foreign_keys=[cpe_device_id]
    )

    def __repr__(self) -> str:
        return (
            f"<WirelessLink id={self.id} ap={self.ap_device_id} "
            f"cpe={self.cpe_device_id} state={self.state!r}>"
        )
