"""Add TimescaleDB hypertables for metrics and denormalized columns on devices.

Revision ID: 003
Revises: 002
Create Date: 2026-02-25

This migration:
1. Creates interface_metrics hypertable for per-interface traffic counters.
2. Creates health_metrics hypertable for per-device CPU/memory/disk/temperature.
3. Creates wireless_metrics hypertable for per-interface wireless client stats.
4. Adds last_cpu_load and last_memory_used_pct denormalized columns to devices
   for efficient fleet table display without joining hypertables.
5. Applies RLS tenant_isolation policies and appropriate GRANTs on all hypertables.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # =========================================================================
    # CREATE interface_metrics HYPERTABLE
    # =========================================================================
    # Stores per-interface byte counters from /interface/print on every poll cycle.
    # rx_bps/tx_bps are stored as NULL — computed at query time via LAG() window
    # function to avoid delta state in the poller.
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS interface_metrics (
            time        TIMESTAMPTZ NOT NULL,
            device_id   UUID        NOT NULL,
            tenant_id   UUID        NOT NULL,
            interface   TEXT        NOT NULL,
            rx_bytes    BIGINT,
            tx_bytes    BIGINT,
            rx_bps      BIGINT,
            tx_bps      BIGINT
        )
    """)
    )

    conn.execute(
        sa.text("SELECT create_hypertable('interface_metrics', 'time', if_not_exists => TRUE)")
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_interface_metrics_device_time "
            "ON interface_metrics (device_id, time DESC)"
        )
    )

    conn.execute(sa.text("ALTER TABLE interface_metrics ENABLE ROW LEVEL SECURITY"))

    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON interface_metrics
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """)
    )

    conn.execute(sa.text("GRANT SELECT, INSERT ON interface_metrics TO app_user"))
    conn.execute(sa.text("GRANT SELECT, INSERT ON interface_metrics TO poller_user"))

    # =========================================================================
    # CREATE health_metrics HYPERTABLE
    # =========================================================================
    # Stores per-device system health metrics from /system/resource/print and
    # /system/health/print on every poll cycle.
    # temperature is nullable — not all RouterOS devices have temperature sensors.
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS health_metrics (
            time         TIMESTAMPTZ NOT NULL,
            device_id    UUID        NOT NULL,
            tenant_id    UUID        NOT NULL,
            cpu_load     SMALLINT,
            free_memory  BIGINT,
            total_memory BIGINT,
            free_disk    BIGINT,
            total_disk   BIGINT,
            temperature  SMALLINT
        )
    """)
    )

    conn.execute(
        sa.text("SELECT create_hypertable('health_metrics', 'time', if_not_exists => TRUE)")
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_health_metrics_device_time "
            "ON health_metrics (device_id, time DESC)"
        )
    )

    conn.execute(sa.text("ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY"))

    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON health_metrics
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """)
    )

    conn.execute(sa.text("GRANT SELECT, INSERT ON health_metrics TO app_user"))
    conn.execute(sa.text("GRANT SELECT, INSERT ON health_metrics TO poller_user"))

    # =========================================================================
    # CREATE wireless_metrics HYPERTABLE
    # =========================================================================
    # Stores per-wireless-interface aggregated client stats from
    # /interface/wireless/registration-table/print (v6) or
    # /interface/wifi/registration-table/print (v7).
    # ccq may be 0 on RouterOS v7 (not available in the WiFi API path).
    # avg_signal is dBm (negative integer, e.g. -67).
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS wireless_metrics (
            time         TIMESTAMPTZ NOT NULL,
            device_id    UUID        NOT NULL,
            tenant_id    UUID        NOT NULL,
            interface    TEXT        NOT NULL,
            client_count SMALLINT,
            avg_signal   SMALLINT,
            ccq          SMALLINT,
            frequency    INTEGER
        )
    """)
    )

    conn.execute(
        sa.text("SELECT create_hypertable('wireless_metrics', 'time', if_not_exists => TRUE)")
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_wireless_metrics_device_time "
            "ON wireless_metrics (device_id, time DESC)"
        )
    )

    conn.execute(sa.text("ALTER TABLE wireless_metrics ENABLE ROW LEVEL SECURITY"))

    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON wireless_metrics
            USING (tenant_id::text = current_setting('app.current_tenant'))
    """)
    )

    conn.execute(sa.text("GRANT SELECT, INSERT ON wireless_metrics TO app_user"))
    conn.execute(sa.text("GRANT SELECT, INSERT ON wireless_metrics TO poller_user"))

    # =========================================================================
    # ADD DENORMALIZED COLUMNS TO devices TABLE
    # =========================================================================
    # These columns are updated by the metrics subscriber alongside each
    # health_metrics insert, enabling the fleet table to display CPU and memory
    # usage without a JOIN to the hypertable.
    op.add_column(
        "devices",
        sa.Column("last_cpu_load", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "devices",
        sa.Column("last_memory_used_pct", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    # Remove denormalized columns from devices first
    op.drop_column("devices", "last_memory_used_pct")
    op.drop_column("devices", "last_cpu_load")

    conn = op.get_bind()

    # Drop hypertables (CASCADE handles indexes, policies, and chunks)
    conn.execute(sa.text("DROP TABLE IF EXISTS wireless_metrics CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS health_metrics CASCADE"))
    conn.execute(sa.text("DROP TABLE IF EXISTS interface_metrics CASCADE"))
