"""Add TimescaleDB retention policies.

Revision ID: 014
Revises: 013
Create Date: 2026-03-03

Adds retention (drop after 90 days) on all three hypertables:
interface_metrics, health_metrics, wireless_metrics.

Note: Compression is skipped because TimescaleDB 2.17.x does not support
compression on tables with row-level security (RLS) policies.
Compression can be re-added when upgrading to TimescaleDB >= 2.19.

Without retention policies the database grows ~5 GB/month unbounded.
"""

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


HYPERTABLES = [
    "interface_metrics",
    "health_metrics",
    "wireless_metrics",
]


def upgrade() -> None:
    conn = op.get_bind()

    for table in HYPERTABLES:
        # Drop chunks older than 90 days
        conn.execute(sa.text(
            f"SELECT add_retention_policy('{table}', INTERVAL '90 days')"
        ))


def downgrade() -> None:
    conn = op.get_bind()

    for table in HYPERTABLES:
        # Remove retention policy
        conn.execute(sa.text(
            f"SELECT remove_retention_policy('{table}', if_exists => true)"
        ))
