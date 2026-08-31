"""Add ssh_public_key_fingerprint to credential_profiles.

Revision ID: 042
Revises: 041
Create Date: 2026-08-30

Supports ssh_key credential profiles. The private key itself lives inside the
existing Transit-encrypted credential envelope and is never readable back
through the API; this column stores only the derived public key fingerprint
("SHA256:..."), which is not secret, so an operator can identify which key is
loaded on a write-only profile.

Nullable with no default, so this is a metadata-only change in PostgreSQL 11+
and does not rewrite the table. lock_timeout is set to fail fast rather than
queue behind long-running queries.
"""

import sqlalchemy as sa
from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Fail fast if credential_profiles is locked by another transaction
    conn.execute(sa.text("SET lock_timeout = '3s'"))

    op.add_column(
        "credential_profiles",
        sa.Column("ssh_public_key_fingerprint", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("credential_profiles", "ssh_public_key_fingerprint")
