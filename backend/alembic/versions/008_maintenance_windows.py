"""Add maintenance_windows table with RLS.

Revision ID: 008
Revises: 007
Create Date: 2026-03-02

This migration:
1. Creates maintenance_windows table for scheduling maintenance periods.
2. Adds CHECK constraint (end_at > start_at).
3. Creates composite index on (tenant_id, start_at, end_at) for active window queries.
4. Applies RLS policy matching the standard tenant_id isolation pattern.
5. Grants permissions to app_user role.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Create maintenance_windows table ────────────────────────────────
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS maintenance_windows (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name          VARCHAR(200) NOT NULL,
            device_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
            start_at      TIMESTAMPTZ NOT NULL,
            end_at        TIMESTAMPTZ NOT NULL,
            suppress_alerts BOOLEAN NOT NULL DEFAULT true,
            notes         TEXT,
            created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT chk_maintenance_window_dates CHECK (end_at > start_at)
        )
    """)
    )

    # ── 2. Composite index for active window queries ───────────────────────
    conn.execute(
        sa.text("""
        CREATE INDEX IF NOT EXISTS idx_maintenance_windows_tenant_time
        ON maintenance_windows (tenant_id, start_at, end_at)
    """)
    )

    # ── 3. RLS policy ─────────────────────────────────────────────────────
    conn.execute(sa.text("ALTER TABLE maintenance_windows ENABLE ROW LEVEL SECURITY"))

    conn.execute(
        sa.text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'maintenance_windows' AND policyname = 'maintenance_windows_tenant_isolation'
            ) THEN
                CREATE POLICY maintenance_windows_tenant_isolation ON maintenance_windows
                    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
            END IF;
        END
        $$
    """)
    )

    # ── 4. Grant permissions to app_user ───────────────────────────────────
    conn.execute(
        sa.text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_windows TO app_user;
            END IF;
        END
        $$
    """)
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS maintenance_windows CASCADE"))
