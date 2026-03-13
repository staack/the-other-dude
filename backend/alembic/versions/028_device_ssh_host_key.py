"""Add SSH host key columns to devices table.

Adds columns for SSH config backup support:
- ssh_port: SSH port override (default 22)
- ssh_host_key_fingerprint: TOFU host key fingerprint (SHA256:base64)
- ssh_host_key_first_seen: when the host key was first observed
- ssh_host_key_last_verified: when the host key was last verified

Grants UPDATE on SSH columns to poller_user for TOFU persistence.

Revision ID: 028
Revises: 027
Create Date: 2026-03-13
"""

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text(
        "ALTER TABLE devices ADD COLUMN ssh_port INTEGER DEFAULT 22"
    ))
    conn.execute(sa.text(
        "ALTER TABLE devices ADD COLUMN ssh_host_key_fingerprint TEXT"
    ))
    conn.execute(sa.text(
        "ALTER TABLE devices ADD COLUMN ssh_host_key_first_seen TIMESTAMPTZ"
    ))
    conn.execute(sa.text(
        "ALTER TABLE devices ADD COLUMN ssh_host_key_last_verified TIMESTAMPTZ"
    ))

    # Grant poller_user UPDATE on SSH columns for TOFU host key persistence
    conn.execute(sa.text(
        "GRANT UPDATE (ssh_host_key_fingerprint, ssh_host_key_first_seen, ssh_host_key_last_verified) ON devices TO poller_user"
    ))


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text(
        "REVOKE UPDATE (ssh_host_key_fingerprint, ssh_host_key_first_seen, ssh_host_key_last_verified) ON devices FROM poller_user"
    ))
    conn.execute(sa.text(
        "ALTER TABLE devices DROP COLUMN ssh_host_key_last_verified"
    ))
    conn.execute(sa.text(
        "ALTER TABLE devices DROP COLUMN ssh_host_key_first_seen"
    ))
    conn.execute(sa.text(
        "ALTER TABLE devices DROP COLUMN ssh_host_key_fingerprint"
    ))
    conn.execute(sa.text(
        "ALTER TABLE devices DROP COLUMN ssh_port"
    ))
