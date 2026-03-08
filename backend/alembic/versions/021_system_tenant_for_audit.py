"""Add system tenant for super_admin audit log entries.

Revision ID: 021
Revises: 020
Create Date: 2026-03-04

The super_admin has NULL tenant_id, but audit_logs.tenant_id has a FK
to tenants and is NOT NULL.  Code was using uuid.UUID(int=0) as a
substitute, but that row didn't exist — causing FK violations that
silently dropped every super_admin audit entry.

This migration inserts a sentinel 'System (Internal)' tenant so
audit_logs can reference it.
"""

from alembic import op

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO tenants (id, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000000',
            'System (Internal)',
            'Internal tenant for super_admin audit entries'
        )
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM tenants
        WHERE id = '00000000-0000-0000-0000-000000000000'
        """
    )
