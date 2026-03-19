"""Site alert system ORM models: site/sector-scoped alert rules and events.

Separate from the device-level alert system in alert.py. These models support
site-wide and sector-scoped alerting for Phase 15 (signal trending, site alerting).
"""

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SiteAlertRuleType(str, Enum):
    """Types of site/sector alert rules."""

    DEVICE_OFFLINE_PERCENT = "device_offline_percent"
    DEVICE_OFFLINE_COUNT = "device_offline_count"
    SECTOR_SIGNAL_AVG = "sector_signal_avg"
    SECTOR_CLIENT_DROP = "sector_client_drop"
    SIGNAL_DEGRADATION = "signal_degradation"


class AlertSeverity(str, Enum):
    """Alert severity levels."""

    WARNING = "warning"
    CRITICAL = "critical"


class AlertState(str, Enum):
    """Alert event states."""

    ACTIVE = "active"
    RESOLVED = "resolved"


class SiteAlertRule(Base):
    """Configurable site/sector-scoped alert threshold rule.

    Rules are always scoped to a site, and optionally to a specific sector.
    When conditions are met, site_alert_events are created by the evaluation task.
    """

    __tablename__ = "site_alert_rules"

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
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
    )
    sector_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sectors.id", ondelete="SET NULL"),
        nullable=True,
    )
    rule_type: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    threshold_value: Mapped[float] = mapped_column(Numeric, nullable=False)
    threshold_unit: Mapped[str] = mapped_column(String(20), nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    site: Mapped["Site"] = relationship("Site")  # type: ignore[name-defined]
    sector: Mapped["Sector | None"] = relationship("Sector")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<SiteAlertRule id={self.id} name={self.name!r} type={self.rule_type}>"


class SiteAlertEvent(Base):
    """Record of a site/sector alert firing or being resolved.

    Created by the scheduled alert evaluation task (Plan 02).
    Resolved manually by operators via the API.
    """

    __tablename__ = "site_alert_events"

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
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
    )
    sector_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sectors.id", ondelete="SET NULL"),
        nullable=True,
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("site_alert_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
    )
    link_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wireless_links.id", ondelete="SET NULL"),
        nullable=True,
    )
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False, default="warning", server_default="warning"
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active"
    )
    consecutive_hits: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    site: Mapped["Site"] = relationship("Site")  # type: ignore[name-defined]
    sector: Mapped["Sector | None"] = relationship("Sector")  # type: ignore[name-defined]
    rule: Mapped["SiteAlertRule | None"] = relationship("SiteAlertRule")

    def __repr__(self) -> str:
        return f"<SiteAlertEvent id={self.id} state={self.state} severity={self.severity}>"
