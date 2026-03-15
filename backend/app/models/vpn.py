"""VPN configuration and peer models for WireGuard management."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VpnConfig(Base):
    """Per-tenant WireGuard server configuration."""

    __tablename__ = "vpn_config"

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
    server_private_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    server_public_key: Mapped[str] = mapped_column(String(64), nullable=False)
    subnet_index: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    subnet: Mapped[str] = mapped_column(String(32), nullable=False)
    server_port: Mapped[int] = mapped_column(Integer, nullable=False, server_default="51820")
    server_address: Mapped[str] = mapped_column(String(32), nullable=False)
    endpoint: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, onupdate=func.now()
    )

    # Peers are queried separately via tenant_id — no ORM relationship needed


class VpnPeer(Base):
    """WireGuard peer representing a device's VPN connection."""

    __tablename__ = "vpn_peers"

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
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    peer_private_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    peer_public_key: Mapped[str] = mapped_column(String(64), nullable=False)
    preshared_key: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    assigned_ip: Mapped[str] = mapped_column(String(32), nullable=False)
    additional_allowed_ips: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    last_handshake: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, onupdate=func.now()
    )

    # Config is queried separately via tenant_id — no ORM relationship needed
