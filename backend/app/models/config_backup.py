"""SQLAlchemy models for config backup tables."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, SmallInteger, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ConfigBackupRun(Base):
    """Metadata for a single config backup run.

    The actual config content (export.rsc and backup.bin) lives in the tenant's
    bare git repository at GIT_STORE_PATH/{tenant_id}.git. This table provides
    the timeline view and per-run metadata without duplicating file content in
    PostgreSQL.
    """

    __tablename__ = "config_backup_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Git commit hash in the tenant's bare repo where this backup is stored.
    commit_sha: Mapped[str] = mapped_column(Text, nullable=False)
    # Trigger type: 'scheduled' | 'manual' | 'pre-restore' | 'checkpoint' | 'config-change'
    trigger_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Lines added/removed vs the prior export.rsc for this device.
    # NULL for the first backup (no prior version to diff against).
    lines_added: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lines_removed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Encryption metadata: NULL=plaintext, 1=client-side AES-GCM, 2=OpenBao Transit
    encryption_tier: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # 12-byte AES-GCM nonce for Tier 1 (client-side) backups; NULL for plaintext/Transit
    encryption_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<ConfigBackupRun id={self.id} device_id={self.device_id} "
            f"trigger={self.trigger_type!r} sha={self.commit_sha[:8]!r}>"
        )


class ConfigBackupSchedule(Base):
    """Per-tenant default and per-device override backup schedule config.

    A row with device_id=NULL is the tenant-level default (daily at 2am).
    A row with a specific device_id overrides the tenant default for that device.
    """

    __tablename__ = "config_backup_schedules"
    __table_args__ = (
        UniqueConstraint("tenant_id", "device_id", name="uq_backup_schedule_tenant_device"),
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
    # NULL = tenant-level default schedule; non-NULL = device-specific override.
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Standard cron expression (5 fields). Default: daily at 2am UTC.
    cron_expression: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="0 2 * * *",
        server_default="0 2 * * *",
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="TRUE",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        scope = f"device={self.device_id}" if self.device_id else f"tenant={self.tenant_id}"
        return f"<ConfigBackupSchedule {scope} cron={self.cron_expression!r} enabled={self.enabled}>"


class ConfigPushOperation(Base):
    """Tracks pending two-phase config push operations for panic-revert recovery.

    Before pushing a config, a row is inserted with status='pending_verification'.
    If the API pod restarts during the 60-second verification window, the startup
    handler checks this table and either commits (deletes the RouterOS scheduler
    job) or marks the operation as 'failed'. This prevents the panic-revert
    scheduler from firing and reverting a successful push after an API restart.

    See Pitfall 6 in 04-RESEARCH.md for the full failure scenario.
    """

    __tablename__ = "config_push_operations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Git commit SHA we'd revert to if the push fails.
    pre_push_commit_sha: Mapped[str] = mapped_column(Text, nullable=False)
    # RouterOS scheduler job name created on the device for panic-revert.
    scheduler_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 'pending_verification' | 'committed' | 'reverted' | 'failed'
    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="pending_verification",
        server_default="pending_verification",
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    def __repr__(self) -> str:
        return (
            f"<ConfigPushOperation id={self.id} device_id={self.device_id} "
            f"status={self.status!r}>"
        )
