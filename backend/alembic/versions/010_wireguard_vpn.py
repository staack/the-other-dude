"""Add vpn_config and vpn_peers tables for WireGuard VPN management.

Revision ID: 010
Revises: 009
Create Date: 2026-03-02

This migration:
1. Creates vpn_config table (one row per tenant — server keys, subnet, port).
2. Creates vpn_peers table (one row per device VPN connection).
3. Applies RLS policies on tenant_id.
4. Grants SELECT, INSERT, UPDATE, DELETE to app_user.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── vpn_config: one row per tenant ──
    op.create_table(
        "vpn_config",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("server_private_key", sa.LargeBinary(), nullable=False),  # AES-256-GCM encrypted
        sa.Column("server_public_key", sa.String(64), nullable=False),
        sa.Column("subnet", sa.String(32), nullable=False, server_default="10.10.0.0/24"),
        sa.Column("server_port", sa.Integer(), nullable=False, server_default="51820"),
        sa.Column("server_address", sa.String(32), nullable=False, server_default="10.10.0.1/24"),
        sa.Column("endpoint", sa.String(255), nullable=True),  # public hostname:port for devices to connect to
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    # ── vpn_peers: one per device VPN connection ──
    op.create_table(
        "vpn_peers",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("peer_private_key", sa.LargeBinary(), nullable=False),  # AES-256-GCM encrypted
        sa.Column("peer_public_key", sa.String(64), nullable=False),
        sa.Column("preshared_key", sa.LargeBinary(), nullable=True),  # AES-256-GCM encrypted, optional
        sa.Column("assigned_ip", sa.String(32), nullable=False),  # e.g. 10.10.0.2/24
        sa.Column("additional_allowed_ips", sa.String(512), nullable=True),  # comma-separated subnets for site-to-site
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_handshake", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    # Indexes
    op.create_index("ix_vpn_peers_tenant_id", "vpn_peers", ["tenant_id"])

    # ── RLS policies ──
    op.execute("ALTER TABLE vpn_config ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY vpn_config_tenant_isolation ON vpn_config
        FOR ALL
        TO app_user
        USING (CAST(tenant_id AS text) = current_setting('app.current_tenant', true))
    """)

    op.execute("ALTER TABLE vpn_peers ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY vpn_peers_tenant_isolation ON vpn_peers
        FOR ALL
        TO app_user
        USING (CAST(tenant_id AS text) = current_setting('app.current_tenant', true))
    """)

    # ── Grants ──
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON vpn_config TO app_user")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON vpn_peers TO app_user")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS vpn_peers_tenant_isolation ON vpn_peers")
    op.execute("DROP POLICY IF EXISTS vpn_config_tenant_isolation ON vpn_config")
    op.drop_table("vpn_peers")
    op.drop_table("vpn_config")
