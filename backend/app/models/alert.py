"""Alert system ORM models: rules, notification channels, and alert events."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AlertRule(Base):
    """Configurable alert threshold rule.

    Rules can be tenant-wide (device_id=NULL), device-specific, or group-scoped.
    When a metric breaches the threshold for duration_polls consecutive polls,
    an alert fires.
    """
    __tablename__ = "alert_rules"

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
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,
    )
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_groups.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    metric: Mapped[str] = mapped_column(Text, nullable=False)
    operator: Mapped[str] = mapped_column(Text, nullable=False)
    threshold: Mapped[float] = mapped_column(Numeric, nullable=False)
    duration_polls: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AlertRule id={self.id} name={self.name!r} metric={self.metric}>"


class NotificationChannel(Base):
    """Email, webhook, or Slack notification destination."""
    __tablename__ = "notification_channels"

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
    name: Mapped[str] = mapped_column(Text, nullable=False)
    channel_type: Mapped[str] = mapped_column(Text, nullable=False)  # "email", "webhook", or "slack"
    # SMTP fields (email channels)
    smtp_host: Mapped[str | None] = mapped_column(Text, nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smtp_user: Mapped[str | None] = mapped_column(Text, nullable=True)
    smtp_password: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)  # AES-256-GCM encrypted
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    from_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    to_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Webhook fields
    webhook_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Slack fields
    slack_webhook_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # OpenBao Transit ciphertext (dual-write migration)
    smtp_password_transit: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<NotificationChannel id={self.id} name={self.name!r} type={self.channel_type}>"


class AlertRuleChannel(Base):
    """Many-to-many association between alert rules and notification channels."""
    __tablename__ = "alert_rule_channels"

    rule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("alert_rules.id", ondelete="CASCADE"),
        primary_key=True,
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notification_channels.id", ondelete="CASCADE"),
        primary_key=True,
    )


class AlertEvent(Base):
    """Record of an alert firing, resolving, or flapping.

    rule_id is NULL for system-level alerts (e.g., device offline).
    """
    __tablename__ = "alert_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("alert_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)  # "firing", "resolved", "flapping"
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    metric: Mapped[str | None] = mapped_column(Text, nullable=True)
    value: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    threshold: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_flapping: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    silenced_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<AlertEvent id={self.id} status={self.status} severity={self.severity}>"
