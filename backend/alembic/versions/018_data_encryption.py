"""Data encryption columns for config backups and audit logs.

Revision ID: 018
Revises: 017
Create Date: 2026-03-03

Adds encryption metadata columns to config_backup_runs (encryption_tier,
encryption_nonce) and encrypted_details TEXT column to audit_logs for
Transit-encrypted audit detail storage.
"""

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    # --- config_backup_runs: encryption metadata ---

    # NULL = plaintext, 1 = client-side AES-GCM, 2 = OpenBao Transit
    op.add_column(
        "config_backup_runs",
        sa.Column(
            "encryption_tier",
            sa.SmallInteger(),
            nullable=True,
            comment="NULL=plaintext, 1=client-side AES-GCM, 2=OpenBao Transit",
        ),
    )

    # 12-byte AES-GCM nonce for Tier 1 (client-side) backups
    op.add_column(
        "config_backup_runs",
        sa.Column(
            "encryption_nonce",
            sa.LargeBinary(),
            nullable=True,
            comment="12-byte AES-GCM nonce for Tier 1 backups",
        ),
    )

    # --- audit_logs: Transit-encrypted details ---

    op.add_column(
        "audit_logs",
        sa.Column(
            "encrypted_details",
            sa.Text(),
            nullable=True,
            comment="Transit-encrypted details JSON (vault:v1:...)",
        ),
    )


def downgrade() -> None:
    op.drop_column("audit_logs", "encrypted_details")
    op.drop_column("config_backup_runs", "encryption_nonce")
    op.drop_column("config_backup_runs", "encryption_tier")
