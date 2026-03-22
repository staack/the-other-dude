"""Create snmp_metrics hypertable for custom SNMP metric storage.

Revision ID: 040
Revises: 039
Create Date: 2026-03-21

Stores OID data that does not map to the standard interface_metrics or
health_metrics hypertables (e.g., UPS battery voltage, vendor-specific
counters, custom profile OIDs).  Structured as a flexible key-value
time-series: metric_name + metric_group identify the series, value_numeric
and value_text hold typed values, index_value tracks SNMP table row index.

90-day retention matches existing hypertable policy.  RLS enforces
tenant isolation.
"""

import sqlalchemy as sa
from alembic import op

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("""
            CREATE TABLE snmp_metrics (
                time TIMESTAMPTZ NOT NULL,
                device_id UUID NOT NULL,
                tenant_id UUID NOT NULL,
                metric_name TEXT NOT NULL,
                metric_group TEXT NOT NULL,
                value_numeric DOUBLE PRECISION,
                value_text TEXT,
                oid TEXT NOT NULL,
                index_value TEXT
            )
        """)
    )

    conn.execute(sa.text("SELECT create_hypertable('snmp_metrics', 'time')"))

    conn.execute(
        sa.text(
            "SELECT add_retention_policy('snmp_metrics', INTERVAL '90 days')"
        )
    )

    conn.execute(
        sa.text("""
            CREATE INDEX idx_snmp_metrics_device_metric_time
                ON snmp_metrics (device_id, metric_name, time DESC)
        """)
    )

    conn.execute(
        sa.text("ALTER TABLE snmp_metrics ENABLE ROW LEVEL SECURITY")
    )
    conn.execute(
        sa.text("ALTER TABLE snmp_metrics FORCE ROW LEVEL SECURITY")
    )

    conn.execute(
        sa.text("""
            CREATE POLICY snmp_metrics_tenant_isolation
                ON snmp_metrics
                USING (
                    tenant_id::text = current_setting('app.current_tenant', true)
                    OR current_setting('app.current_tenant', true) = 'super_admin'
                )
        """)
    )

    conn.execute(
        sa.text("GRANT SELECT, INSERT ON snmp_metrics TO app_user")
    )


def downgrade() -> None:
    op.drop_table("snmp_metrics")
