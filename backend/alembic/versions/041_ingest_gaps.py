"""Create ingest_gaps and poller_heartbeats so a hole in the metrics is visible.

Revision ID: 041
Revises: 040
Create Date: 2026-08-30

Until now, a metric sample the poller collected but could not deliver simply
did not exist.  Every publish failure in poller/internal/poller/worker.go was a
slog.Warn and a drop; nothing in the database distinguished "no sample because
the device was fine and we failed to record it" from "no sample because nothing
happened".  The only signal was a Prometheus counter, and Prometheus ships in
docker-compose.observability.yml, which is not part of a production deployment.

Two tables, because two different failures need two different mechanisms:

  ingest_gaps        Intervals during which collected data could not be
                     delivered.  Written by the poller when a publish fails and
                     closed when publishing recovers.

  poller_heartbeats  A liveness row per poller instance.  A dead process cannot
                     record its own absence, so on startup the poller compares
                     the last heartbeat against now and writes an ingest_gaps
                     row covering the window it was not running.  This is the
                     only mechanism here that survives an OOM kill, a host
                     reboot, or PostgreSQL itself being unreachable -- the
                     heartbeat write fails then too, which is precisely the
                     signal.

Deliberately NOT included: any attempt to recover the lost samples.  A disk
spool in the poller would mean a new volume, deduplication on the consumer, and
a new class of bug, to recover metrics nobody will look at.  The requirement is
that a gap not be silently unrecorded, not that the data come back.
"""

import sqlalchemy as sa
from alembic import op

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("""
            CREATE TABLE ingest_gaps (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                -- 'publish_failure': the poller collected data it could not
                -- deliver.  'poller_outage': the poller was not running.
                kind TEXT NOT NULL,
                -- NULL for stack-wide gaps, which belong to no tenant and are
                -- visible only to super_admin.
                tenant_id UUID,
                device_id UUID,
                -- Which event family was lost: metrics, status, interfaces,
                -- wireless_registrations, firmware, config_changed.
                stream TEXT,
                started_at TIMESTAMPTZ NOT NULL,
                -- NULL while the gap is still open.
                ended_at TIMESTAMPTZ,
                dropped_samples INTEGER NOT NULL DEFAULT 0,
                reason TEXT NOT NULL,
                poller_instance TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
    )

    conn.execute(
        sa.text("""
            CREATE INDEX idx_ingest_gaps_device_started
                ON ingest_gaps (device_id, started_at DESC)
        """)
    )
    conn.execute(
        sa.text("""
            CREATE INDEX idx_ingest_gaps_started
                ON ingest_gaps (started_at DESC)
        """)
    )
    # Open gaps are the ones an operator wants first and are a tiny subset.
    conn.execute(
        sa.text("""
            CREATE INDEX idx_ingest_gaps_open
                ON ingest_gaps (started_at DESC)
                WHERE ended_at IS NULL
        """)
    )

    conn.execute(sa.text("ALTER TABLE ingest_gaps ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE ingest_gaps FORCE ROW LEVEL SECURITY"))
    # A NULL tenant_id compares as NULL rather than true, so stack-wide gaps are
    # invisible to tenants and visible to super_admin. That is intended.
    conn.execute(
        sa.text("""
            CREATE POLICY ingest_gaps_tenant_isolation
                ON ingest_gaps
                USING (
                    current_setting('app.current_tenant', true) = 'super_admin'
                    OR tenant_id::text = current_setting('app.current_tenant', true)
                )
        """)
    )

    conn.execute(
        sa.text("""
            CREATE TABLE poller_heartbeats (
                instance TEXT PRIMARY KEY,
                last_seen_at TIMESTAMPTZ NOT NULL,
                started_at TIMESTAMPTZ NOT NULL
            )
        """)
    )

    # The API reads both to surface gaps; it never writes them.
    conn.execute(sa.text("GRANT SELECT ON ingest_gaps TO app_user"))
    conn.execute(sa.text("GRANT SELECT ON poller_heartbeats TO app_user"))

    # The poller opens a gap, then closes it when delivery recovers, so it needs
    # UPDATE as well as INSERT. poller_user has BYPASSRLS, so the policy above
    # does not apply to it.
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE ON ingest_gaps TO poller_user"))
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE ON poller_heartbeats TO poller_user"))


def downgrade() -> None:
    op.drop_table("poller_heartbeats")
    op.drop_table("ingest_gaps")
