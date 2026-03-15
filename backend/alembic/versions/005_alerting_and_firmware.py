"""Add alerting and firmware management tables.

Revision ID: 005
Revises: 004
Create Date: 2026-02-25

This migration:
1. ALTERs devices table: adds architecture and preferred_channel columns.
2. ALTERs device_groups table: adds preferred_channel column.
3. Creates alert_rules, notification_channels, alert_rule_channels, alert_events tables.
4. Creates firmware_versions, firmware_upgrade_jobs tables.
5. Applies RLS policies on tenant-scoped tables.
6. Seeds default alert rules for all existing tenants.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # =========================================================================
    # ALTER devices TABLE — add architecture and preferred_channel columns
    # =========================================================================
    conn.execute(sa.text("ALTER TABLE devices ADD COLUMN IF NOT EXISTS architecture TEXT"))
    conn.execute(
        sa.text(
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS preferred_channel TEXT DEFAULT 'stable' NOT NULL"
        )
    )

    # =========================================================================
    # ALTER device_groups TABLE — add preferred_channel column
    # =========================================================================
    conn.execute(
        sa.text(
            "ALTER TABLE device_groups ADD COLUMN IF NOT EXISTS preferred_channel TEXT DEFAULT 'stable' NOT NULL"
        )
    )

    # =========================================================================
    # CREATE alert_rules TABLE
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS alert_rules (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id       UUID        REFERENCES devices(id) ON DELETE CASCADE,
            group_id        UUID        REFERENCES device_groups(id) ON DELETE SET NULL,
            name            TEXT        NOT NULL,
            metric          TEXT        NOT NULL,
            operator        TEXT        NOT NULL,
            threshold       NUMERIC     NOT NULL,
            duration_polls  INTEGER     NOT NULL DEFAULT 1,
            severity        TEXT        NOT NULL,
            enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
            is_default      BOOLEAN     NOT NULL DEFAULT FALSE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant_enabled "
            "ON alert_rules (tenant_id, enabled)"
        )
    )

    conn.execute(sa.text("ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON alert_rules
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """)
    )
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rules TO app_user"))
    conn.execute(sa.text("GRANT ALL ON alert_rules TO poller_user"))

    # =========================================================================
    # CREATE notification_channels TABLE
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS notification_channels (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name            TEXT        NOT NULL,
            channel_type    TEXT        NOT NULL,
            smtp_host       TEXT,
            smtp_port       INTEGER,
            smtp_user       TEXT,
            smtp_password   BYTEA,
            smtp_use_tls    BOOLEAN     DEFAULT FALSE,
            from_address    TEXT,
            to_address      TEXT,
            webhook_url     TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_notification_channels_tenant "
            "ON notification_channels (tenant_id)"
        )
    )

    conn.execute(sa.text("ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON notification_channels
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """)
    )
    conn.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON notification_channels TO app_user")
    )
    conn.execute(sa.text("GRANT ALL ON notification_channels TO poller_user"))

    # =========================================================================
    # CREATE alert_rule_channels TABLE (M2M association)
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS alert_rule_channels (
            rule_id     UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
            channel_id  UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
            PRIMARY KEY (rule_id, channel_id)
        )
    """)
    )

    conn.execute(sa.text("ALTER TABLE alert_rule_channels ENABLE ROW LEVEL SECURITY"))
    # RLS for M2M: join through parent table's tenant_id via rule_id
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON alert_rule_channels
            USING (rule_id IN (
                SELECT id FROM alert_rules
                WHERE tenant_id::text = current_setting('app.current_tenant')
            ))
    """)
    )
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rule_channels TO app_user"))
    conn.execute(sa.text("GRANT ALL ON alert_rule_channels TO poller_user"))

    # =========================================================================
    # CREATE alert_events TABLE
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS alert_events (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            rule_id         UUID        REFERENCES alert_rules(id) ON DELETE SET NULL,
            device_id       UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            status          TEXT        NOT NULL,
            severity        TEXT        NOT NULL,
            metric          TEXT,
            value           NUMERIC,
            threshold       NUMERIC,
            message         TEXT,
            is_flapping     BOOLEAN     NOT NULL DEFAULT FALSE,
            acknowledged_at TIMESTAMPTZ,
            acknowledged_by UUID        REFERENCES users(id) ON DELETE SET NULL,
            silenced_until  TIMESTAMPTZ,
            fired_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at     TIMESTAMPTZ
        )
    """)
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_alert_events_device_rule_status "
            "ON alert_events (device_id, rule_id, status)"
        )
    )
    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_alert_events_tenant_fired "
            "ON alert_events (tenant_id, fired_at)"
        )
    )

    conn.execute(sa.text("ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON alert_events
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """)
    )
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON alert_events TO app_user"))
    conn.execute(sa.text("GRANT ALL ON alert_events TO poller_user"))

    # =========================================================================
    # CREATE firmware_versions TABLE (global — NOT tenant-scoped)
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS firmware_versions (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            architecture    TEXT        NOT NULL,
            channel         TEXT        NOT NULL,
            version         TEXT        NOT NULL,
            npk_url         TEXT        NOT NULL,
            npk_local_path  TEXT,
            npk_size_bytes  BIGINT,
            checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(architecture, channel, version)
        )
    """)
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_firmware_versions_arch_channel "
            "ON firmware_versions (architecture, channel)"
        )
    )

    # No RLS on firmware_versions — global cache table
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE ON firmware_versions TO app_user"))
    conn.execute(sa.text("GRANT ALL ON firmware_versions TO poller_user"))

    # =========================================================================
    # CREATE firmware_upgrade_jobs TABLE
    # =========================================================================
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS firmware_upgrade_jobs (
            id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id               UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            rollout_group_id        UUID,
            target_version          TEXT        NOT NULL,
            architecture            TEXT        NOT NULL,
            channel                 TEXT        NOT NULL,
            status                  TEXT        NOT NULL DEFAULT 'pending',
            pre_upgrade_backup_sha  TEXT,
            scheduled_at            TIMESTAMPTZ,
            started_at              TIMESTAMPTZ,
            completed_at            TIMESTAMPTZ,
            error_message           TEXT,
            confirmed_major_upgrade BOOLEAN     NOT NULL DEFAULT FALSE,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    )

    conn.execute(sa.text("ALTER TABLE firmware_upgrade_jobs ENABLE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON firmware_upgrade_jobs
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """)
    )
    conn.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON firmware_upgrade_jobs TO app_user")
    )
    conn.execute(sa.text("GRANT ALL ON firmware_upgrade_jobs TO poller_user"))

    # =========================================================================
    # SEED DEFAULT ALERT RULES for all existing tenants
    # =========================================================================
    # Note: New tenant creation (in the tenants API router) should also seed
    # these three default rules. A _seed_default_alert_rules(tenant_id) helper
    # should be created in the alerts router or a shared service for this.
    conn.execute(
        sa.text("""
        INSERT INTO alert_rules (id, tenant_id, name, metric, operator, threshold, duration_polls, severity, enabled, is_default)
        SELECT gen_random_uuid(), t.id, 'High CPU Usage', 'cpu_load', 'gt', 90, 5, 'warning', TRUE, TRUE
        FROM tenants t
    """)
    )
    conn.execute(
        sa.text("""
        INSERT INTO alert_rules (id, tenant_id, name, metric, operator, threshold, duration_polls, severity, enabled, is_default)
        SELECT gen_random_uuid(), t.id, 'High Memory Usage', 'memory_used_pct', 'gt', 90, 5, 'warning', TRUE, TRUE
        FROM tenants t
    """)
    )
    conn.execute(
        sa.text("""
        INSERT INTO alert_rules (id, tenant_id, name, metric, operator, threshold, duration_polls, severity, enabled, is_default)
        SELECT gen_random_uuid(), t.id, 'High Disk Usage', 'disk_used_pct', 'gt', 85, 3, 'warning', TRUE, TRUE
        FROM tenants t
    """)
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Drop tables in reverse dependency order
    conn.execute(sa.text("DROP TABLE IF EXISTS firmware_upgrade_jobs CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS firmware_versions CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS alert_events CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS alert_rule_channels CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS notification_channels CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS alert_rules CASCADE"))

    # Drop added columns
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS architecture"))
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS preferred_channel"))
    conn.execute(sa.text("ALTER TABLE device_groups DROP COLUMN IF EXISTS preferred_channel"))
