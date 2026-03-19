"""Create device_interfaces table for MAC-to-device resolution.

Revision ID: 032
Revises: 031
Create Date: 2026-03-19

Stores interface metadata (name, MAC, type, running state) per device.
Used by link discovery to resolve MAC addresses to specific devices.
"""

import sqlalchemy as sa
from alembic import op

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_interfaces",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "device_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("mac_address", sa.String(17), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("running", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("device_id", "name", name="uq_device_interfaces_device_name"),
    )

    op.create_index("idx_device_interfaces_mac", "device_interfaces", ["mac_address"])
    op.create_index("idx_device_interfaces_tenant", "device_interfaces", ["tenant_id"])

    # Enable RLS with tenant isolation policy
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE device_interfaces ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE device_interfaces FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
            CREATE POLICY tenant_isolation ON device_interfaces
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
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON device_interfaces"))
    op.drop_table("device_interfaces")
