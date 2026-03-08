"""Fix key_access_log device_id FK to SET NULL on delete.

Revision ID: 025
Revises: 024
"""

from alembic import op

revision = "025"
down_revision = "024"


def upgrade() -> None:
    op.drop_constraint(
        "fk_key_access_log_device_id", "key_access_log", type_="foreignkey"
    )
    op.create_foreign_key(
        "fk_key_access_log_device_id",
        "key_access_log",
        "devices",
        ["device_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_key_access_log_device_id", "key_access_log", type_="foreignkey"
    )
    op.create_foreign_key(
        "fk_key_access_log_device_id",
        "key_access_log",
        "devices",
        ["device_id"],
        ["id"],
    )
