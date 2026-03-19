"""Add performance indexes for fleet dashboard and link discovery queries.

Revision ID: 036
Revises: 035
Create Date: 2026-03-19

At ~400 devices, sequential scans on the devices table accounted for 58M
row reads. These indexes cover the hot query paths: fleet summary
(tenant_id + hostname sort), dashboard status counts (tenant_id + status),
and key_access_log time-range queries.
"""

import sqlalchemy as sa
from alembic import op

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Fleet summary query: SELECT ... FROM devices JOIN tenants ORDER BY hostname
    op.create_index(
        "idx_devices_tenant_hostname",
        "devices",
        ["tenant_id", "hostname"],
        if_not_exists=True,
    )

    # Dashboard status count queries
    op.create_index(
        "idx_devices_tenant_status",
        "devices",
        ["tenant_id", "status"],
        if_not_exists=True,
    )

    # key_access_log: growing unbounded, queried by tenant + time range
    op.create_index(
        "idx_key_access_log_tenant_time",
        "key_access_log",
        [sa.text("tenant_id"), sa.text("created_at DESC")],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("idx_key_access_log_tenant_time", table_name="key_access_log")
    op.drop_index("idx_devices_tenant_status", table_name="devices")
    op.drop_index("idx_devices_tenant_hostname", table_name="devices")
