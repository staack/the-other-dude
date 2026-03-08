"""Add opt-in plain-text TLS mode and change default from insecure to auto.

Revision ID: 020
Revises: 019
Create Date: 2026-03-04

Reclassifies tls_mode values:
- 'auto': CA-verified -> InsecureSkipVerify (NO plain-text fallback)
- 'insecure': Skip directly to InsecureSkipVerify
- 'plain': Explicit opt-in for plain-text API (dangerous)
- 'portal_ca': Existing CA-verified mode (unchanged)

Existing 'insecure' devices become 'auto' since the old behavior was
an implicit auto-fallback. portal_ca devices keep their mode.
"""

import sqlalchemy as sa
from alembic import op

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migrate existing 'insecure' devices to 'auto' (the new default).
    # 'portal_ca' devices keep their mode (they already have CA verification).
    op.execute("UPDATE devices SET tls_mode = 'auto' WHERE tls_mode = 'insecure'")

    # Change the server default from 'insecure' to 'auto'
    op.alter_column(
        "devices",
        "tls_mode",
        server_default="auto",
    )


def downgrade() -> None:
    # Revert 'auto' devices back to 'insecure'
    op.execute("UPDATE devices SET tls_mode = 'insecure' WHERE tls_mode = 'auto'")

    # Revert 'plain' devices to 'insecure' (plain didn't exist before)
    op.execute("UPDATE devices SET tls_mode = 'insecure' WHERE tls_mode = 'plain'")

    # Restore old server default
    op.alter_column(
        "devices",
        "tls_mode",
        server_default="insecure",
    )
