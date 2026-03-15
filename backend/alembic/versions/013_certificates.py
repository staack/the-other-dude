"""Add certificate authority and device certificate tables.

Revision ID: 013
Revises: 012
Create Date: 2026-03-03

Creates the `certificate_authorities` (one per tenant) and `device_certificates`
(one per device) tables for the Internal Certificate Authority feature.
Also adds a `tls_mode` column to the `devices` table to track per-device
TLS verification mode (insecure vs portal_ca).

Both tables have RLS policies for tenant isolation, plus poller_user read
access (the poller needs CA cert PEM to verify device TLS connections).
"""

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade() -> None:
    # --- certificate_authorities table ---
    op.create_table(
        "certificate_authorities",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("common_name", sa.String(255), nullable=False),
        sa.Column("cert_pem", sa.Text(), nullable=False),
        sa.Column("encrypted_private_key", sa.LargeBinary(), nullable=False),
        sa.Column("serial_number", sa.String(64), nullable=False),
        sa.Column("fingerprint_sha256", sa.String(95), nullable=False),
        sa.Column(
            "not_valid_before",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "not_valid_after",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )

    # --- device_certificates table ---
    op.create_table(
        "device_certificates",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ca_id",
            UUID(as_uuid=True),
            sa.ForeignKey("certificate_authorities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("common_name", sa.String(255), nullable=False),
        sa.Column("serial_number", sa.String(64), nullable=False),
        sa.Column("fingerprint_sha256", sa.String(95), nullable=False),
        sa.Column("cert_pem", sa.Text(), nullable=False),
        sa.Column("encrypted_private_key", sa.LargeBinary(), nullable=False),
        sa.Column(
            "not_valid_before",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "not_valid_after",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="issued",
        ),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )

    # --- Add tls_mode column to devices table ---
    op.add_column(
        "devices",
        sa.Column(
            "tls_mode",
            sa.String(20),
            nullable=False,
            server_default="insecure",
        ),
    )

    # --- RLS policies ---
    conn = op.get_bind()

    # certificate_authorities RLS
    conn.execute(sa.text("ALTER TABLE certificate_authorities ENABLE ROW LEVEL SECURITY"))
    conn.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON certificate_authorities TO app_user")
    )
    conn.execute(
        sa.text(
            "CREATE POLICY tenant_isolation ON certificate_authorities FOR ALL "
            "USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) "
            "WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)"
        )
    )
    conn.execute(sa.text("GRANT SELECT ON certificate_authorities TO poller_user"))

    # device_certificates RLS
    conn.execute(sa.text("ALTER TABLE device_certificates ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON device_certificates TO app_user"))
    conn.execute(
        sa.text(
            "CREATE POLICY tenant_isolation ON device_certificates FOR ALL "
            "USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) "
            "WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)"
        )
    )
    conn.execute(sa.text("GRANT SELECT ON device_certificates TO poller_user"))


def downgrade() -> None:
    conn = op.get_bind()

    # Drop RLS policies
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON device_certificates"))
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON certificate_authorities"))

    # Revoke grants
    conn.execute(sa.text("REVOKE ALL ON device_certificates FROM app_user"))
    conn.execute(sa.text("REVOKE ALL ON device_certificates FROM poller_user"))
    conn.execute(sa.text("REVOKE ALL ON certificate_authorities FROM app_user"))
    conn.execute(sa.text("REVOKE ALL ON certificate_authorities FROM poller_user"))

    # Drop tls_mode column from devices
    op.drop_column("devices", "tls_mode")

    # Drop tables
    op.drop_table("device_certificates")
    op.drop_table("certificate_authorities")
