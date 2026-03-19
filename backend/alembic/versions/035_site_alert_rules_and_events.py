"""Create site_alert_rules and site_alert_events tables with RLS.

Revision ID: 035
Revises: 034
Create Date: 2026-03-19
"""

import sqlalchemy as sa
from alembic import op

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create site_alert_rules table
    op.create_table(
        "site_alert_rules",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sector_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sectors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rule_type", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("threshold_value", sa.Numeric, nullable=False),
        sa.Column("threshold_unit", sa.String(20), nullable=False),
        sa.Column(
            "enabled",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_site_alert_rules_tenant_site",
        "site_alert_rules",
        ["tenant_id", "site_id"],
    )
    op.create_index(
        "ix_site_alert_rules_tenant_site_sector",
        "site_alert_rules",
        ["tenant_id", "site_id", "sector_id"],
        postgresql_where=sa.text("sector_id IS NOT NULL"),
    )

    # 2. Create site_alert_events table
    op.create_table(
        "site_alert_events",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sector_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sectors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "rule_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("site_alert_rules.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "device_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "link_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("wireless_links.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "severity",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'warning'"),
        ),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column(
            "state",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column(
            "consecutive_hits",
            sa.Integer,
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "triggered_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_site_alert_events_tenant_site_state",
        "site_alert_events",
        ["tenant_id", "site_id", "state"],
    )

    # 3. Enable RLS on both tables
    conn = op.get_bind()

    # site_alert_rules RLS
    conn.execute(sa.text("ALTER TABLE site_alert_rules ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE site_alert_rules FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
            CREATE POLICY tenant_isolation ON site_alert_rules
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
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON site_alert_rules TO app_user"))

    # site_alert_events RLS
    conn.execute(sa.text("ALTER TABLE site_alert_events ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE site_alert_events FORCE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("""
            CREATE POLICY tenant_isolation ON site_alert_events
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
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON site_alert_events TO app_user"))


def downgrade() -> None:
    conn = op.get_bind()

    # Drop RLS policies
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON site_alert_events"))
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON site_alert_rules"))

    # Drop tables (indexes drop automatically with tables)
    op.drop_table("site_alert_events")
    op.drop_table("site_alert_rules")
