"""Create wireless_links table for AP-CPE link state tracking.

Revision ID: 033
Revises: 032
Create Date: 2026-03-19

Stores discovered wireless links between AP and CPE devices with
state machine columns for link health tracking (discovered -> active ->
degraded -> down -> stale).
"""

import sqlalchemy as sa
from alembic import op

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wireless_links",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "ap_device_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "cpe_device_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("interface", sa.String(255), nullable=True),
        sa.Column("client_mac", sa.String(17), nullable=False),
        sa.Column("signal_strength", sa.Integer, nullable=True),
        sa.Column("tx_ccq", sa.Integer, nullable=True),
        sa.Column("tx_rate", sa.String(50), nullable=True),
        sa.Column("rx_rate", sa.String(50), nullable=True),
        sa.Column(
            "state",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'discovered'"),
        ),
        sa.Column("missed_polls", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column(
            "discovered_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_seen",
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
        sa.UniqueConstraint("ap_device_id", "cpe_device_id", name="uq_wireless_links_ap_cpe"),
    )

    op.create_index("idx_wireless_links_ap", "wireless_links", ["ap_device_id"])
    op.create_index("idx_wireless_links_cpe", "wireless_links", ["cpe_device_id"])
    op.create_index("idx_wireless_links_tenant_state", "wireless_links", ["tenant_id", "state"])
    op.create_index("idx_wireless_links_client_mac", "wireless_links", ["client_mac"])

    # Enable RLS with tenant isolation policy
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE wireless_links ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE wireless_links FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
            CREATE POLICY tenant_isolation ON wireless_links
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
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON wireless_links"))
    op.drop_table("wireless_links")
