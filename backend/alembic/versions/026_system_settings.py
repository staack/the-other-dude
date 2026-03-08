"""Add system_settings table for instance-wide configuration.

Revision ID: 026
Revises: 025
Create Date: 2026-03-08
"""

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("value", sa.Text, nullable=True),
        sa.Column("encrypted_value", sa.LargeBinary, nullable=True),
        sa.Column("encrypted_value_transit", sa.Text, nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("system_settings")
