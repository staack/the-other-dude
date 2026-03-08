"""Create audit_logs table with RLS policy.

Revision ID: 007
Revises: 006
Create Date: 2026-03-02

This migration:
1. Creates audit_logs table for centralized audit trail.
2. Applies RLS policy for tenant isolation.
3. Creates indexes for fast paginated and filtered queries.
4. Grants SELECT, INSERT to app_user (read and write audit entries).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # =========================================================================
    # CREATE audit_logs TABLE
    # =========================================================================
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(50),
            resource_id VARCHAR(255),
            device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            ip_address VARCHAR(45),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))

    # =========================================================================
    # RLS POLICY
    # =========================================================================
    conn.execute(sa.text(
        "ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY"
    ))
    conn.execute(sa.text("""
        CREATE POLICY audit_logs_tenant_isolation ON audit_logs
        USING (tenant_id = current_setting('app.current_tenant')::uuid)
    """))

    # Grant SELECT + INSERT to app_user (no UPDATE/DELETE -- audit logs are immutable)
    conn.execute(sa.text(
        "GRANT SELECT, INSERT ON audit_logs TO app_user"
    ))
    # Poller user gets full access for cross-tenant audit logging
    conn.execute(sa.text(
        "GRANT ALL ON audit_logs TO poller_user"
    ))

    # =========================================================================
    # INDEXES
    # =========================================================================
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created "
        "ON audit_logs (tenant_id, created_at DESC)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action "
        "ON audit_logs (tenant_id, action)"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS audit_logs CASCADE"))
