"""Add SNMP columns to devices table.

Revision ID: 039
Revises: 038
Create Date: 2026-03-21

Adds device_type (default 'routeros' for backward compatibility),
snmp_port, snmp_version, snmp_profile_id FK, and credential_profile_id FK.

Uses lock_timeout = 3s to fail fast rather than queue behind long-running
queries.  Each ALTER TABLE ADD COLUMN with a non-volatile DEFAULT does NOT
rewrite the table in PostgreSQL 11+ -- the default is stored in pg_attribute
and applied on read, so this is a metadata-only change.
"""

import sqlalchemy as sa
from alembic import op

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Fail fast if devices table is locked by another transaction
    conn.execute(sa.text("SET lock_timeout = '3s'"))

    conn.execute(
        sa.text("ALTER TABLE devices ADD COLUMN device_type TEXT NOT NULL DEFAULT 'routeros'")
    )

    conn.execute(sa.text("ALTER TABLE devices ADD COLUMN snmp_port INTEGER DEFAULT 161"))

    conn.execute(sa.text("ALTER TABLE devices ADD COLUMN snmp_version TEXT"))

    conn.execute(
        sa.text(
            "ALTER TABLE devices"
            " ADD COLUMN snmp_profile_id UUID"
            " REFERENCES snmp_profiles(id) ON DELETE SET NULL"
        )
    )

    conn.execute(
        sa.text(
            "ALTER TABLE devices"
            " ADD COLUMN credential_profile_id UUID"
            " REFERENCES credential_profiles(id) ON DELETE SET NULL"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS credential_profile_id"))
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS snmp_profile_id"))
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS snmp_version"))
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS snmp_port"))
    conn.execute(sa.text("ALTER TABLE devices DROP COLUMN IF EXISTS device_type"))
