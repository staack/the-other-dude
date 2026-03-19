"""Create wireless_registrations hypertable for per-client wireless data.

Revision ID: 031
Revises: 030
Create Date: 2026-03-19

Stores per-client registration table rows from RouterOS devices:
- Each row = one wireless client connected to one AP interface
- Collected every poll cycle by the Go poller
- Published via WIRELESS_REGISTRATIONS NATS stream
- 30-day retention (shorter than 90-day health/interface metrics)

Also creates rf_monitor_stats hypertable for per-interface RF environment
data (noise floor, channel width, tx power, registered client count).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # =========================================================================
    # CREATE wireless_registrations HYPERTABLE
    # =========================================================================
    # Stores per-client registration table rows from RouterOS wireless interfaces.
    # One row per connected client per poll cycle.
    # signal_strength is dBm (negative integer, e.g. -67).
    # tx_ccq is 0-100 percentage (may be 0 on RouterOS v7 WiFi path).
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS wireless_registrations (
            time                TIMESTAMPTZ NOT NULL,
            device_id           UUID        NOT NULL,
            tenant_id           UUID        NOT NULL,
            interface           TEXT        NOT NULL,
            mac_address         TEXT        NOT NULL,
            signal_strength     SMALLINT,
            tx_ccq              SMALLINT,
            tx_rate             TEXT,
            rx_rate             TEXT,
            uptime              TEXT,
            distance            INTEGER,
            last_ip             TEXT,
            tx_signal_strength  SMALLINT,
            bytes               TEXT
        )
    """)
    )

    conn.execute(
        sa.text(
            "SELECT create_hypertable('wireless_registrations', 'time', if_not_exists => TRUE)"
        )
    )

    # Primary lookup: device + time range
    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_wireless_reg_device_time "
            "ON wireless_registrations (device_id, time DESC)"
        )
    )

    # MAC lookup for Phase 13 link discovery MAC resolution
    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_wireless_reg_mac_time "
            "ON wireless_registrations (mac_address, time DESC)"
        )
    )

    conn.execute(sa.text("ALTER TABLE wireless_registrations ENABLE ROW LEVEL SECURITY"))

    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON wireless_registrations
            USING (
                tenant_id::text = current_setting('app.current_tenant', true)
                OR current_setting('app.current_tenant', true) = 'super_admin'
            )
            WITH CHECK (
                tenant_id::text = current_setting('app.current_tenant', true)
                OR current_setting('app.current_tenant', true) = 'super_admin'
            )
    """)
    )

    conn.execute(sa.text("GRANT SELECT, INSERT ON wireless_registrations TO app_user"))
    conn.execute(sa.text("GRANT SELECT, INSERT ON wireless_registrations TO poller_user"))

    # 30-day retention (shorter than 90-day health/interface metrics -- wireless
    # registration data is high-volume and primarily useful for recent analysis)
    conn.execute(
        sa.text("SELECT add_retention_policy('wireless_registrations', INTERVAL '30 days')")
    )

    # =========================================================================
    # CREATE rf_monitor_stats HYPERTABLE
    # =========================================================================
    # Stores per-interface RF environment data from the wireless monitor:
    # noise floor, channel width, tx power, and registered client count.
    # Time-series for trending RF conditions across the fleet.
    conn.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS rf_monitor_stats (
            time                TIMESTAMPTZ NOT NULL,
            device_id           UUID        NOT NULL,
            tenant_id           UUID        NOT NULL,
            interface           TEXT        NOT NULL,
            noise_floor         SMALLINT,
            channel_width       TEXT,
            tx_power            SMALLINT,
            registered_clients  SMALLINT
        )
    """)
    )

    conn.execute(
        sa.text(
            "SELECT create_hypertable('rf_monitor_stats', 'time', if_not_exists => TRUE)"
        )
    )

    conn.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_rf_monitor_device_time "
            "ON rf_monitor_stats (device_id, time DESC)"
        )
    )

    conn.execute(sa.text("ALTER TABLE rf_monitor_stats ENABLE ROW LEVEL SECURITY"))

    conn.execute(
        sa.text("""
        CREATE POLICY tenant_isolation ON rf_monitor_stats
            USING (
                tenant_id::text = current_setting('app.current_tenant', true)
                OR current_setting('app.current_tenant', true) = 'super_admin'
            )
            WITH CHECK (
                tenant_id::text = current_setting('app.current_tenant', true)
                OR current_setting('app.current_tenant', true) = 'super_admin'
            )
    """)
    )

    conn.execute(sa.text("GRANT SELECT, INSERT ON rf_monitor_stats TO app_user"))
    conn.execute(sa.text("GRANT SELECT, INSERT ON rf_monitor_stats TO poller_user"))

    conn.execute(
        sa.text("SELECT add_retention_policy('rf_monitor_stats', INTERVAL '30 days')")
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Remove retention policies before dropping tables
    conn.execute(
        sa.text("SELECT remove_retention_policy('rf_monitor_stats', if_exists => true)")
    )
    conn.execute(sa.text("DROP TABLE IF EXISTS rf_monitor_stats CASCADE"))

    conn.execute(
        sa.text(
            "SELECT remove_retention_policy('wireless_registrations', if_exists => true)"
        )
    )
    conn.execute(sa.text("DROP TABLE IF EXISTS wireless_registrations CASCADE"))
