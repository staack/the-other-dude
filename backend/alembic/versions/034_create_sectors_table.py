"""Create sectors table with RLS and add sector_id FK to devices.

Revision ID: 034
Revises: 033
Create Date: 2026-03-19
"""

import sqlalchemy as sa
from alembic import op

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create sectors table
    op.create_table(
        "sectors",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "site_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("azimuth", sa.Float, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
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
        sa.UniqueConstraint("tenant_id", "site_id", "name", name="uq_sectors_tenant_site_name"),
    )

    # 2. Enable RLS on sectors table
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE sectors ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE sectors FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
            CREATE POLICY tenant_isolation ON sectors
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

    # 3. Grant app_user and poller_user access
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON sectors TO app_user"))
    conn.execute(sa.text("GRANT SELECT ON sectors TO poller_user"))

    # 4. Add nullable sector_id FK column to devices table
    op.add_column(
        "devices",
        sa.Column(
            "sector_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sectors.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_devices_sector_id", "devices", ["sector_id"])


def downgrade() -> None:
    # Drop devices.sector_id column (index drops automatically with column)
    op.drop_index("ix_devices_sector_id", table_name="devices")
    op.drop_column("devices", "sector_id")

    # Drop RLS policy and sectors table
    conn = op.get_bind()
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON sectors"))
    op.drop_table("sectors")
