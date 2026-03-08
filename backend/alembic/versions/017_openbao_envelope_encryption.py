"""OpenBao envelope encryption columns and key_access_log extensions.

Revision ID: 017
Revises: 016
Create Date: 2026-03-03

Adds Transit ciphertext columns (TEXT) alongside existing BYTEA columns
for dual-write migration strategy. Extends key_access_log with device_id,
justification, and correlation_id for Phase 29 audit trail.
"""

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade() -> None:
    # --- Transit ciphertext columns (TEXT, alongside existing BYTEA) ---

    # devices: store OpenBao Transit ciphertext for credentials
    op.add_column(
        "devices",
        sa.Column("encrypted_credentials_transit", sa.Text(), nullable=True),
    )

    # certificate_authorities: Transit-encrypted CA private keys
    op.add_column(
        "certificate_authorities",
        sa.Column("encrypted_private_key_transit", sa.Text(), nullable=True),
    )

    # device_certificates: Transit-encrypted device cert private keys
    op.add_column(
        "device_certificates",
        sa.Column("encrypted_private_key_transit", sa.Text(), nullable=True),
    )

    # notification_channels: Transit-encrypted SMTP password
    op.add_column(
        "notification_channels",
        sa.Column("smtp_password_transit", sa.Text(), nullable=True),
    )

    # --- Tenant OpenBao key tracking ---
    op.add_column(
        "tenants",
        sa.Column("openbao_key_name", sa.Text(), nullable=True),
    )

    # --- Extend key_access_log for Phase 29 ---
    op.add_column(
        "key_access_log",
        sa.Column("device_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "key_access_log",
        sa.Column("justification", sa.Text(), nullable=True),
    )
    op.add_column(
        "key_access_log",
        sa.Column("correlation_id", sa.Text(), nullable=True),
    )

    # Add FK constraint for device_id -> devices(id) (nullable, so no cascade needed)
    op.create_foreign_key(
        "fk_key_access_log_device_id",
        "key_access_log",
        "devices",
        ["device_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_key_access_log_device_id", "key_access_log", type_="foreignkey"
    )
    op.drop_column("key_access_log", "correlation_id")
    op.drop_column("key_access_log", "justification")
    op.drop_column("key_access_log", "device_id")
    op.drop_column("tenants", "openbao_key_name")
    op.drop_column("notification_channels", "smtp_password_transit")
    op.drop_column("device_certificates", "encrypted_private_key_transit")
    op.drop_column("certificate_authorities", "encrypted_private_key_transit")
    op.drop_column("devices", "encrypted_credentials_transit")
