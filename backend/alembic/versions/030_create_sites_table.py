"""Create sites table with RLS and add site_id FK to devices.

Revision ID: 030
Revises: 029
Create Date: 2026-03-19
"""

import sqlalchemy as sa
from alembic import op

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create sites table
    op.create_table(
        "sites",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("elevation", sa.Float, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("tenant_id", "name", name="uq_sites_tenant_name"),
    )

    # 2. Enable RLS on sites table
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE sites ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE sites FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
            CREATE POLICY tenant_isolation ON sites
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

    # 3. Grant app_user access
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON sites TO app_user"))
    conn.execute(sa.text("GRANT SELECT ON sites TO poller_user"))

    # 4. Add nullable site_id FK column to devices table
    op.add_column(
        "devices",
        sa.Column(
            "site_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_devices_site_id", "devices", ["site_id"])


def downgrade() -> None:
    # Drop devices.site_id column (index drops automatically with column)
    op.drop_index("ix_devices_site_id", table_name="devices")
    op.drop_column("devices", "site_id")

    # Drop RLS policy and sites table
    conn = op.get_bind()
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON sites"))
    op.drop_table("sites")
