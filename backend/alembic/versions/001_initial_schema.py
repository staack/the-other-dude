"""Initial schema with RLS policies for multi-tenant isolation.

Revision ID: 001
Revises: None
Create Date: 2026-02-24

This migration creates:
1. All database tables (tenants, users, devices, device_groups, device_tags,
   device_group_memberships, device_tag_assignments)
2. Composite unique indexes for tenant-scoped uniqueness
3. Row Level Security (RLS) on all tenant-scoped tables
4. RLS policies using app.current_tenant PostgreSQL setting
5. The app_user role with appropriate grants (cannot bypass RLS)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # =========================================================================
    # TENANTS TABLE
    # =========================================================================
    op.create_table(
        "tenants",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_tenants_name", "tenants", ["name"], unique=True)

    # =========================================================================
    # USERS TABLE
    # =========================================================================
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default="viewer"),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])

    # =========================================================================
    # DEVICES TABLE
    # =========================================================================
    op.create_table(
        "devices",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hostname", sa.String(255), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=False),
        sa.Column("api_port", sa.Integer, nullable=False, server_default="8728"),
        sa.Column("api_ssl_port", sa.Integer, nullable=False, server_default="8729"),
        sa.Column("model", sa.String(255), nullable=True),
        sa.Column("serial_number", sa.String(255), nullable=True),
        sa.Column("firmware_version", sa.String(100), nullable=True),
        sa.Column("routeros_version", sa.String(100), nullable=True),
        sa.Column("uptime_seconds", sa.Integer, nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encrypted_credentials", sa.LargeBinary, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "hostname", name="uq_devices_tenant_hostname"),
    )
    op.create_index("ix_devices_tenant_id", "devices", ["tenant_id"])

    # =========================================================================
    # DEVICE GROUPS TABLE
    # =========================================================================
    op.create_table(
        "device_groups",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_device_groups_tenant_name"),
    )
    op.create_index("ix_device_groups_tenant_id", "device_groups", ["tenant_id"])

    # =========================================================================
    # DEVICE TAGS TABLE
    # =========================================================================
    op.create_table(
        "device_tags",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(7), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_device_tags_tenant_name"),
    )
    op.create_index("ix_device_tags_tenant_id", "device_tags", ["tenant_id"])

    # =========================================================================
    # DEVICE GROUP MEMBERSHIPS TABLE
    # =========================================================================
    op.create_table(
        "device_group_memberships",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("device_id", "group_id"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["device_groups.id"], ondelete="CASCADE"),
    )

    # =========================================================================
    # DEVICE TAG ASSIGNMENTS TABLE
    # =========================================================================
    op.create_table(
        "device_tag_assignments",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("device_id", "tag_id"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["device_tags.id"], ondelete="CASCADE"),
    )

    # =========================================================================
    # ROW LEVEL SECURITY (RLS)
    # =========================================================================
    # RLS is the core tenant isolation mechanism. The app_user role CANNOT
    # bypass RLS (only superusers can). All queries through app_user will
    # be filtered by the current_setting('app.current_tenant') value which
    # is set per-request by the tenant_context middleware.

    conn = op.get_bind()

    # --- TENANTS RLS ---
    # Super admin sees all; tenant users see only their tenant
    conn.execute(sa.text("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE tenants FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON tenants
        USING (
            id::text = current_setting('app.current_tenant', true)
            OR current_setting('app.current_tenant', true) = 'super_admin'
        )
        WITH CHECK (
            id::text = current_setting('app.current_tenant', true)
            OR current_setting('app.current_tenant', true) = 'super_admin'
        )
    """)
    )

    # --- USERS RLS ---
    # Users see only other users in their tenant; super_admin sees all
    conn.execute(sa.text("ALTER TABLE users ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE users FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON users
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

    # --- DEVICES RLS ---
    conn.execute(sa.text("ALTER TABLE devices ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE devices FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON devices
        USING (tenant_id::text = current_setting('app.current_tenant', true))
        WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    """)
    )

    # --- DEVICE GROUPS RLS ---
    conn.execute(sa.text("ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE device_groups FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON device_groups
        USING (tenant_id::text = current_setting('app.current_tenant', true))
        WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    """)
    )

    # --- DEVICE TAGS RLS ---
    conn.execute(sa.text("ALTER TABLE device_tags ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE device_tags FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON device_tags
        USING (tenant_id::text = current_setting('app.current_tenant', true))
        WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    """)
    )

    # --- DEVICE GROUP MEMBERSHIPS RLS ---
    # These are filtered by joining through devices/groups (which already have RLS)
    # But we also add direct RLS via a join to the devices table
    conn.execute(sa.text("ALTER TABLE device_group_memberships ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE device_group_memberships FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON device_group_memberships
        USING (
            EXISTS (
                SELECT 1 FROM devices d
                WHERE d.id = device_id
                AND d.tenant_id::text = current_setting('app.current_tenant', true)
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM devices d
                WHERE d.id = device_id
                AND d.tenant_id::text = current_setting('app.current_tenant', true)
            )
        )
    """)
    )

    # --- DEVICE TAG ASSIGNMENTS RLS ---
    conn.execute(sa.text("ALTER TABLE device_tag_assignments ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE device_tag_assignments FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON device_tag_assignments
        USING (
            EXISTS (
                SELECT 1 FROM devices d
                WHERE d.id = device_id
                AND d.tenant_id::text = current_setting('app.current_tenant', true)
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM devices d
                WHERE d.id = device_id
                AND d.tenant_id::text = current_setting('app.current_tenant', true)
            )
        )
    """)
    )

    # =========================================================================
    # GRANT PERMISSIONS TO app_user (RLS-enforcing application role)
    # =========================================================================
    # app_user is a non-superuser role — it CANNOT bypass RLS policies.
    # All API queries use this role to ensure tenant isolation.

    tables = [
        "tenants",
        "users",
        "devices",
        "device_groups",
        "device_tags",
        "device_group_memberships",
        "device_tag_assignments",
    ]

    for table in tables:
        conn.execute(sa.text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO app_user"))

    # Grant sequence usage for UUID generation (gen_random_uuid is built-in, but just in case)
    conn.execute(sa.text("GRANT USAGE ON SCHEMA public TO app_user"))

    # Allow app_user to set the tenant context variable
    conn.execute(sa.text("GRANT SET ON PARAMETER app.current_tenant TO app_user"))


def downgrade() -> None:
    conn = op.get_bind()

    # Revoke grants
    tables = [
        "tenants",
        "users",
        "devices",
        "device_groups",
        "device_tags",
        "device_group_memberships",
        "device_tag_assignments",
    ]
    for table in tables:
        try:
            conn.execute(sa.text(f"REVOKE ALL ON {table} FROM app_user"))
        except Exception:
            pass

    # Drop tables (in reverse dependency order)
    op.drop_table("device_tag_assignments")
    op.drop_table("device_group_memberships")
    op.drop_table("device_tags")
    op.drop_table("device_groups")
    op.drop_table("devices")
    op.drop_table("users")
    op.drop_table("tenants")
