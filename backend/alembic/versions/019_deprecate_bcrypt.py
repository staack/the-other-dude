"""Deprecate bcrypt: add must_upgrade_auth flag and make hashed_password nullable.

Revision ID: 019
Revises: 018
Create Date: 2026-03-03

Conservative migration that flags legacy bcrypt users for SRP upgrade
rather than dropping data. hashed_password is made nullable so SRP-only
users no longer need a dummy value. A future migration (post-v6.0) can
drop hashed_password once all users have upgraded.
"""

import sqlalchemy as sa
from alembic import op

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add must_upgrade_auth flag
    op.add_column(
        "users",
        sa.Column(
            "must_upgrade_auth",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
    )

    # Flag all bcrypt-only users for upgrade (auth_version=1 and no SRP verifier)
    op.execute(
        "UPDATE users SET must_upgrade_auth = true "
        "WHERE auth_version = 1 AND srp_verifier IS NULL"
    )

    # Make hashed_password nullable (SRP users don't need it)
    op.alter_column("users", "hashed_password", nullable=True)


def downgrade() -> None:
    # Restore NOT NULL (set a dummy value for any NULLs first)
    op.execute(
        "UPDATE users SET hashed_password = '$2b$12$placeholder' "
        "WHERE hashed_password IS NULL"
    )
    op.alter_column("users", "hashed_password", nullable=False)

    op.drop_column("users", "must_upgrade_auth")
