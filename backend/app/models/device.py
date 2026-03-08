"""Device, DeviceGroup, DeviceTag, and membership models."""

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DeviceStatus(str, Enum):
    """Device connection status."""
    UNKNOWN = "unknown"
    ONLINE = "online"
    OFFLINE = "offline"


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "hostname", name="uq_devices_tenant_hostname"),
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
    hostname: Mapped[str] = mapped_column(String(255), nullable=False)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)  # IPv4 or IPv6
    api_port: Mapped[int] = mapped_column(Integer, default=8728, nullable=False)
    api_ssl_port: Mapped[int] = mapped_column(Integer, default=8729, nullable=False)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(255), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    routeros_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    routeros_major_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uptime_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_cpu_load: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_memory_used_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    architecture: Mapped[str | None] = mapped_column(Text, nullable=True)  # CPU arch (arm, arm64, mipsbe, etc.)
    preferred_channel: Mapped[str] = mapped_column(
        Text, default="stable", server_default="stable", nullable=False
    )  # Firmware release channel
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # AES-256-GCM encrypted credentials (username + password JSON)
    encrypted_credentials: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # OpenBao Transit ciphertext (dual-write migration)
    encrypted_credentials_transit: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20),
        default=DeviceStatus.UNKNOWN.value,
        nullable=False,
    )
    tls_mode: Mapped[str] = mapped_column(
        String(20),
        default="auto",
        server_default="auto",
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
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="devices")  # type: ignore[name-defined]
    group_memberships: Mapped[list["DeviceGroupMembership"]] = relationship(
        "DeviceGroupMembership", back_populates="device", cascade="all, delete-orphan"
    )
    tag_assignments: Mapped[list["DeviceTagAssignment"]] = relationship(
        "DeviceTagAssignment", back_populates="device", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Device id={self.id} hostname={self.hostname!r} tenant_id={self.tenant_id}>"


class DeviceGroup(Base):
    __tablename__ = "device_groups"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_device_groups_tenant_name"),
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
    preferred_channel: Mapped[str] = mapped_column(
        Text, default="stable", server_default="stable", nullable=False
    )  # Firmware release channel for the group
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="device_groups")  # type: ignore[name-defined]
    memberships: Mapped[list["DeviceGroupMembership"]] = relationship(
        "DeviceGroupMembership", back_populates="group", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<DeviceGroup id={self.id} name={self.name!r} tenant_id={self.tenant_id}>"


class DeviceTag(Base):
    __tablename__ = "device_tags"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_device_tags_tenant_name"),
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
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)  # hex color e.g. #FF5733

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="device_tags")  # type: ignore[name-defined]
    assignments: Mapped[list["DeviceTagAssignment"]] = relationship(
        "DeviceTagAssignment", back_populates="tag", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<DeviceTag id={self.id} name={self.name!r} tenant_id={self.tenant_id}>"


class DeviceGroupMembership(Base):
    __tablename__ = "device_group_memberships"

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_groups.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Relationships
    device: Mapped["Device"] = relationship("Device", back_populates="group_memberships")
    group: Mapped["DeviceGroup"] = relationship("DeviceGroup", back_populates="memberships")


class DeviceTagAssignment(Base):
    __tablename__ = "device_tag_assignments"

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_tags.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Relationships
    device: Mapped["Device"] = relationship("Device", back_populates="tag_assignments")
    tag: Mapped["DeviceTag"] = relationship("DeviceTag", back_populates="assignments")
