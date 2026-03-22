"""Create credential_profiles table for unified credential management.

Revision ID: 037
Revises: 036
Create Date: 2026-03-21

Stores named credential sets (RouterOS, SNMPv1/v2c/v3) that can be
shared across multiple devices.  Enables fleet-wide credential rotation
by updating a single profile instead of N individual devices.

Encrypted credentials use the same OpenBao Transit envelope scheme as
the per-device encrypted_credentials columns on the devices table.
"""

import sqlalchemy as sa
from alembic import op

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("""
            CREATE TABLE credential_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                credential_type TEXT NOT NULL,
                encrypted_credentials BYTEA,
                encrypted_credentials_transit TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(tenant_id, name)
            )
        """)
    )

    conn.execute(
        sa.text("ALTER TABLE credential_profiles ENABLE ROW LEVEL SECURITY")
    )
    conn.execute(
        sa.text("ALTER TABLE credential_profiles FORCE ROW LEVEL SECURITY")
    )

    conn.execute(
        sa.text("""
            CREATE POLICY credential_profiles_tenant_isolation
                ON credential_profiles
                USING (
                    tenant_id::text = current_setting('app.current_tenant', true)
                    OR current_setting('app.current_tenant', true) = 'super_admin'
                )
                WITH CHECK (
                    tenant_id::text = current_setting('app.current_tenant', true)
                    OR current_setting('app.current_tenant', true) = 'super_admin'
                )
        """)
    )

    conn.execute(
        sa.text("GRANT SELECT ON credential_profiles TO poller_user")
    )
    conn.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON credential_profiles TO app_user")
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DROP POLICY IF EXISTS credential_profiles_tenant_isolation"
            " ON credential_profiles"
        )
    )
    op.drop_table("credential_profiles")
