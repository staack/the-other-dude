"""Add super_admin bypass to devices, device_groups, device_tags RLS policies.

Previously these tables only matched tenant_id, so super_admin context
('super_admin') returned zero rows. Users/tenants tables already had
the bypass — this brings device tables in line.

Revision ID: 022
Revises: 021
Create Date: 2026-03-07
"""

import sqlalchemy as sa
from alembic import op

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None

# Tables that need super_admin bypass added to their RLS policy
_TABLES = ["devices", "device_groups", "device_tags"]


def upgrade() -> None:
    conn = op.get_bind()
    for table in _TABLES:
        conn.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {table}"))
        conn.execute(
            sa.text(f"""
            CREATE POLICY tenant_isolation ON {table}
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


def downgrade() -> None:
    conn = op.get_bind()
    for table in _TABLES:
        conn.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {table}"))
        conn.execute(
            sa.text(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (tenant_id::text = current_setting('app.current_tenant', true))
            WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
        """)
        )
