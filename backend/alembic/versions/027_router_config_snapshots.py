"""Add router config snapshot, diff, and change tables.

Creates three tables for config snapshot storage:
- router_config_snapshots: point-in-time config captures (Transit-encrypted)
- router_config_diffs: unified diffs between consecutive snapshots
- router_config_changes: parsed semantic changes from diffs

All tables have RLS tenant isolation and performance indexes.

Revision ID: 027
Revises: 026
Create Date: 2026-03-12
"""

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    conn = op.get_bind()

    # ── router_config_snapshots ──────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE router_config_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            config_text TEXT NOT NULL,
            sha256_hash VARCHAR(64) NOT NULL,
            collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    # RLS
    conn.execute(sa.text("ALTER TABLE router_config_snapshots ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE router_config_snapshots FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text("""
        CREATE POLICY tenant_isolation ON router_config_snapshots
            USING (tenant_id::text = current_setting('app.current_tenant', true))
            WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    """))

    # Grants
    conn.execute(sa.text("GRANT SELECT, INSERT, DELETE ON router_config_snapshots TO app_user"))

    # Indexes
    conn.execute(sa.text(
        "CREATE INDEX idx_rcs_device_collected ON router_config_snapshots (device_id, collected_at DESC)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX idx_rcs_device_hash ON router_config_snapshots (device_id, sha256_hash)"
    ))

    # ── router_config_diffs ──────────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE router_config_diffs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            old_snapshot_id UUID NOT NULL REFERENCES router_config_snapshots(id) ON DELETE CASCADE,
            new_snapshot_id UUID NOT NULL REFERENCES router_config_snapshots(id) ON DELETE CASCADE,
            diff_text TEXT NOT NULL,
            lines_added INT NOT NULL DEFAULT 0,
            lines_removed INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    # RLS
    conn.execute(sa.text("ALTER TABLE router_config_diffs ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE router_config_diffs FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text("""
        CREATE POLICY tenant_isolation ON router_config_diffs
            USING (tenant_id::text = current_setting('app.current_tenant', true))
            WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    """))

    # Grants
    conn.execute(sa.text("GRANT SELECT, INSERT, DELETE ON router_config_diffs TO app_user"))

    # Indexes
    conn.execute(sa.text(
        "CREATE UNIQUE INDEX idx_rcd_snapshot_pair ON router_config_diffs (old_snapshot_id, new_snapshot_id)"
    ))

    # ── router_config_changes ────────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE router_config_changes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            diff_id UUID NOT NULL REFERENCES router_config_diffs(id) ON DELETE CASCADE,
            device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            component TEXT NOT NULL,
            summary TEXT NOT NULL,
            raw_line TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    # RLS
    conn.execute(sa.text("ALTER TABLE router_config_changes ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE router_config_changes FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text("""
        CREATE POLICY tenant_isolation ON router_config_changes
            USING (tenant_id::text = current_setting('app.current_tenant', true))
            WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    """))

    # Grants
    conn.execute(sa.text("GRANT SELECT, INSERT, DELETE ON router_config_changes TO app_user"))

    # Indexes
    conn.execute(sa.text(
        "CREATE INDEX idx_rcc_diff_id ON router_config_changes (diff_id)"
    ))


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("DROP TABLE IF EXISTS router_config_changes"))
    conn.execute(sa.text("DROP TABLE IF EXISTS router_config_diffs"))
    conn.execute(sa.text("DROP TABLE IF EXISTS router_config_snapshots"))
