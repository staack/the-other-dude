"""Add Slack notification channel support.

Revision ID: 023
Revises: 022
"""

from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notification_channels", sa.Column("slack_webhook_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("notification_channels", "slack_webhook_url")
