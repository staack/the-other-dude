"""Add contact_email to tenants and seed device_offline default alert rule.

Revision ID: 024
Revises: 023
"""

from alembic import op
import sqlalchemy as sa


revision = "024"
down_revision = "023"


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add contact_email column to tenants
    op.add_column("tenants", sa.Column("contact_email", sa.String(255), nullable=True))

    # 2. Seed device_offline default alert rule for all existing tenants
    conn.execute(
        sa.text("""
        INSERT INTO alert_rules (id, tenant_id, name, metric, operator, threshold, duration_polls, severity, enabled, is_default)
        SELECT gen_random_uuid(), t.id, 'Device Offline', 'device_offline', 'eq', 1, 1, 'critical', TRUE, TRUE
        FROM tenants t
        WHERE t.id != '00000000-0000-0000-0000-000000000000'
          AND NOT EXISTS (
            SELECT 1 FROM alert_rules ar
            WHERE ar.tenant_id = t.id AND ar.metric = 'device_offline' AND ar.is_default = TRUE
          )
    """)
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("""
        DELETE FROM alert_rules WHERE metric = 'device_offline' AND is_default = TRUE
    """)
    )

    op.drop_column("tenants", "contact_email")
