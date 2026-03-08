"""Add config management tables: config_backup_runs, config_backup_schedules, config_push_operations.

Revision ID: 004
Revises: 003
Create Date: 2026-02-25

This migration:
1. Creates config_backup_runs table for backup metadata (content lives in git).
2. Creates config_backup_schedules table for per-tenant/per-device schedule config.
3. Creates config_push_operations table for panic-revert recovery (API-restart safety).
4. Applies RLS tenant_isolation policies and appropriate GRANTs on all tables.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # =========================================================================
    # CREATE config_backup_runs TABLE
    # =========================================================================
    # Stores metadata for each backup run. The actual config content lives in
    # the tenant's bare git repository (GIT_STORE_PATH). This table provides
    # the timeline view and change tracking without duplicating file content.
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS config_backup_runs (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            device_id       UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            commit_sha      TEXT        NOT NULL,
            trigger_type    TEXT        NOT NULL,
            lines_added     INT,
            lines_removed   INT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_config_backup_runs_device_created "
        "ON config_backup_runs (device_id, created_at DESC)"
    ))

    conn.execute(sa.text("ALTER TABLE config_backup_runs ENABLE ROW LEVEL SECURITY"))

    conn.execute(sa.text("""
        CREATE POLICY tenant_isolation ON config_backup_runs
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """))

    conn.execute(sa.text("GRANT SELECT, INSERT ON config_backup_runs TO app_user"))
    conn.execute(sa.text("GRANT SELECT ON config_backup_runs TO poller_user"))

    # =========================================================================
    # CREATE config_backup_schedules TABLE
    # =========================================================================
    # Stores per-tenant default and per-device override schedules.
    # device_id = NULL means tenant default (applies to all devices in tenant).
    # A per-device row with a specific device_id overrides the tenant default.
    # UNIQUE(tenant_id, device_id) allows one entry per (tenant, device) pair
    # where device_id NULL is the tenant-level default.
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS config_backup_schedules (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id       UUID        REFERENCES devices(id) ON DELETE CASCADE,
            cron_expression TEXT        NOT NULL DEFAULT '0 2 * * *',
            enabled         BOOL        NOT NULL DEFAULT TRUE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(tenant_id, device_id)
        )
    """))

    conn.execute(sa.text("ALTER TABLE config_backup_schedules ENABLE ROW LEVEL SECURITY"))

    conn.execute(sa.text("""
        CREATE POLICY tenant_isolation ON config_backup_schedules
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """))

    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE ON config_backup_schedules TO app_user"))

    # =========================================================================
    # CREATE config_push_operations TABLE
    # =========================================================================
    # Tracks pending two-phase config push operations for panic-revert recovery.
    # If the API pod restarts during the 60-second verification window, the
    # startup handler checks for 'pending_verification' rows and either verifies
    # connectivity (clean up the RouterOS scheduler job) or marks as failed.
    # See Pitfall 6 in 04-RESEARCH.md.
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS config_push_operations (
            id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            device_id           UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            pre_push_commit_sha TEXT        NOT NULL,
            scheduler_name      TEXT        NOT NULL,
            status              TEXT        NOT NULL DEFAULT 'pending_verification',
            started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at        TIMESTAMPTZ
        )
    """))

    conn.execute(sa.text("ALTER TABLE config_push_operations ENABLE ROW LEVEL SECURITY"))

    conn.execute(sa.text("""
        CREATE POLICY tenant_isolation ON config_push_operations
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """))

    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE ON config_push_operations TO app_user"))


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("DROP TABLE IF EXISTS config_push_operations CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS config_backup_schedules CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS config_backup_runs CASCADE"))
