"""Add routeros_major_version column and poller_user PostgreSQL role.

Revision ID: 002
Revises: 001
Create Date: 2026-02-24

This migration:
1. Adds routeros_major_version INTEGER column to devices table (nullable).
   Stores the detected major version (6 or 7) as populated by the Go poller.
2. Creates the poller_user PostgreSQL role with SELECT-only access to the
   devices table. The poller_user bypasses RLS intentionally — it must read
   all devices across all tenants to poll them.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # =========================================================================
    # ADD routeros_major_version COLUMN
    # =========================================================================
    # Stores the detected RouterOS major version (6 or 7) as an INTEGER.
    # Populated by the Go poller after a successful connection and
    # /system/resource/print query. NULL until the poller has connected at
    # least once.
    op.add_column(
        "devices",
        sa.Column("routeros_major_version", sa.Integer(), nullable=True),
    )

    # =========================================================================
    # CREATE poller_user ROLE AND GRANT PERMISSIONS
    # =========================================================================
    # The poller_user role is used exclusively by the Go poller service.
    # It has SELECT-only access to the devices table and does NOT enforce
    # RLS policies (RLS is applied to app_user only). This allows the poller
    # to read all devices across all tenants, which is required for polling.
    conn = op.get_bind()

    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'poller_user') THEN
                CREATE ROLE poller_user WITH LOGIN PASSWORD 'poller_password' BYPASSRLS;
            END IF;
        END
        $$
    """))

    conn.execute(sa.text("GRANT CONNECT ON DATABASE mikrotik TO poller_user"))
    conn.execute(sa.text("GRANT USAGE ON SCHEMA public TO poller_user"))

    # SELECT on devices only — poller needs to read encrypted_credentials
    # and other device fields. No INSERT/UPDATE/DELETE needed.
    conn.execute(sa.text("GRANT SELECT ON devices TO poller_user"))


def downgrade() -> None:
    conn = op.get_bind()

    # Revoke grants from poller_user
    try:
        conn.execute(sa.text("REVOKE SELECT ON devices FROM poller_user"))
    except Exception:
        pass

    try:
        conn.execute(sa.text("REVOKE USAGE ON SCHEMA public FROM poller_user"))
    except Exception:
        pass

    try:
        conn.execute(sa.text("REVOKE CONNECT ON DATABASE mikrotik FROM poller_user"))
    except Exception:
        pass

    try:
        conn.execute(sa.text("DROP ROLE IF EXISTS poller_user"))
    except Exception:
        pass

    # Drop the column
    op.drop_column("devices", "routeros_major_version")
