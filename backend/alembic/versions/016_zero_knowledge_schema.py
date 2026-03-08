"""Add zero-knowledge authentication schema.

Revision ID: 016
Revises: 015
Create Date: 2026-03-03

Adds SRP columns to users, creates user_key_sets table for encrypted
key bundles, creates immutable key_access_log audit trail, and adds
vault key columns to tenants (Phase 29 preparation).

Both new tables have RLS policies. key_access_log is append-only
(INSERT+SELECT only, no UPDATE/DELETE).
"""

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade() -> None:
    # --- Add SRP columns to users table ---
    op.add_column(
        "users",
        sa.Column("srp_salt", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("srp_verifier", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "auth_version",
            sa.SmallInteger(),
            server_default=sa.text("1"),
            nullable=False,
        ),
    )

    # --- Create user_key_sets table ---
    op.create_table(
        "user_key_sets",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,  # NULL for super_admin
        ),
        sa.Column("encrypted_private_key", sa.LargeBinary(), nullable=False),
        sa.Column("private_key_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("encrypted_vault_key", sa.LargeBinary(), nullable=False),
        sa.Column("vault_key_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column(
            "pbkdf2_iterations",
            sa.Integer(),
            server_default=sa.text("650000"),
            nullable=False,
        ),
        sa.Column("pbkdf2_salt", sa.LargeBinary(), nullable=False),
        sa.Column("hkdf_salt", sa.LargeBinary(), nullable=False),
        sa.Column(
            "key_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
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

    # --- Create key_access_log table (immutable audit trail) ---
    op.create_table(
        "key_access_log",
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
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("resource_type", sa.Text(), nullable=True),
        sa.Column("resource_id", sa.Text(), nullable=True),
        sa.Column("key_version", sa.Integer(), nullable=True),
        sa.Column("ip_address", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # --- Add vault key columns to tenants (Phase 29 preparation) ---
    op.add_column(
        "tenants",
        sa.Column("encrypted_vault_key", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column(
            "vault_key_version",
            sa.Integer(),
            server_default=sa.text("1"),
        ),
    )

    # --- RLS policies ---
    conn = op.get_bind()

    # user_key_sets RLS
    conn.execute(sa.text(
        "ALTER TABLE user_key_sets ENABLE ROW LEVEL SECURITY"
    ))
    conn.execute(sa.text(
        "CREATE POLICY user_key_sets_tenant_isolation ON user_key_sets "
        "USING (tenant_id::text = current_setting('app.current_tenant', true) "
        "OR current_setting('app.current_tenant', true) = 'super_admin')"
    ))
    conn.execute(sa.text(
        "GRANT SELECT, INSERT, UPDATE ON user_key_sets TO app_user"
    ))

    # key_access_log RLS (append-only: INSERT+SELECT only, no UPDATE/DELETE)
    conn.execute(sa.text(
        "ALTER TABLE key_access_log ENABLE ROW LEVEL SECURITY"
    ))
    conn.execute(sa.text(
        "CREATE POLICY key_access_log_tenant_isolation ON key_access_log "
        "USING (tenant_id::text = current_setting('app.current_tenant', true) "
        "OR current_setting('app.current_tenant', true) = 'super_admin')"
    ))
    conn.execute(sa.text(
        "GRANT INSERT, SELECT ON key_access_log TO app_user"
    ))
    # poller_user needs INSERT to log key access events when decrypting credentials
    conn.execute(sa.text(
        "GRANT INSERT, SELECT ON key_access_log TO poller_user"
    ))


def downgrade() -> None:
    conn = op.get_bind()

    # Drop RLS policies
    conn.execute(sa.text(
        "DROP POLICY IF EXISTS key_access_log_tenant_isolation ON key_access_log"
    ))
    conn.execute(sa.text(
        "DROP POLICY IF EXISTS user_key_sets_tenant_isolation ON user_key_sets"
    ))

    # Revoke grants
    conn.execute(sa.text("REVOKE ALL ON key_access_log FROM app_user"))
    conn.execute(sa.text("REVOKE ALL ON key_access_log FROM poller_user"))
    conn.execute(sa.text("REVOKE ALL ON user_key_sets FROM app_user"))

    # Drop vault key columns from tenants
    op.drop_column("tenants", "vault_key_version")
    op.drop_column("tenants", "encrypted_vault_key")

    # Drop tables
    op.drop_table("key_access_log")
    op.drop_table("user_key_sets")

    # Drop SRP columns from users
    op.drop_column("users", "auth_version")
    op.drop_column("users", "srp_verifier")
    op.drop_column("users", "srp_salt")
