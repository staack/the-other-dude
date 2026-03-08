"""Add api_keys table with RLS for tenant-scoped API key management.

Revision ID: 009
Revises: 008
Create Date: 2026-03-02

This migration:
1. Creates api_keys table (UUID PK, tenant_id FK, user_id FK, key_hash, scopes JSONB).
2. Adds unique index on key_hash for O(1) validation lookups.
3. Adds composite index on (tenant_id, revoked_at) for listing active keys.
4. Applies RLS policy on tenant_id.
5. Grants SELECT, INSERT, UPDATE to app_user.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Create api_keys table
    conn.execute(
        sa.text("""
            CREATE TABLE IF NOT EXISTS api_keys (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(200) NOT NULL,
                key_prefix VARCHAR(12) NOT NULL,
                key_hash VARCHAR(64) NOT NULL,
                scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
                expires_at TIMESTAMPTZ,
                last_used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                revoked_at TIMESTAMPTZ
            );
        """)
    )

    # 2. Unique index on key_hash for fast validation lookups
    conn.execute(
        sa.text("""
            CREATE UNIQUE INDEX IF NOT EXISTS ix_api_keys_key_hash
            ON api_keys (key_hash);
        """)
    )

    # 3. Composite index for listing active keys per tenant
    conn.execute(
        sa.text("""
            CREATE INDEX IF NOT EXISTS ix_api_keys_tenant_revoked
            ON api_keys (tenant_id, revoked_at);
        """)
    )

    # 4. Enable RLS and create tenant isolation policy
    conn.execute(sa.text("ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;"))
    conn.execute(sa.text("ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;"))

    conn.execute(
        sa.text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE tablename = 'api_keys' AND policyname = 'tenant_isolation'
                ) THEN
                    CREATE POLICY tenant_isolation ON api_keys
                    USING (
                        tenant_id::text = current_setting('app.current_tenant', true)
                        OR current_setting('app.current_tenant', true) = 'super_admin'
                    );
                END IF;
            END $$;
        """)
    )

    # 5. Grant permissions to app_user role
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE ON api_keys TO app_user;"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS api_keys CASCADE;"))
