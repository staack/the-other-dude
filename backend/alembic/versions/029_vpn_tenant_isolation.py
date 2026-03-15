"""Add per-tenant VPN subnet isolation with global server keypair.

Revision ID: 029
Revises: 028
Create Date: 2026-03-14
"""

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None

import os
import base64

from alembic import op
import sqlalchemy as sa
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _generate_keypair():
    """Generate WireGuard X25519 keypair."""
    private_key = X25519PrivateKey.generate()
    priv_bytes = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(priv_bytes).decode(), base64.b64encode(pub_bytes).decode()


def _encrypt(plaintext: str, key: bytes) -> bytes:
    """AES-256-GCM encrypt (same as app.services.crypto.encrypt_credentials)."""
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext.encode(), None)


def upgrade() -> None:
    # 1. Generate and store global server keypair
    private_key_b64, public_key_b64 = _generate_keypair()

    encryption_key_b64 = os.environ.get("CREDENTIAL_ENCRYPTION_KEY", "")
    if not encryption_key_b64:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY env var required for VPN migration")
    key_bytes = base64.b64decode(encryption_key_b64)
    encrypted_private = _encrypt(private_key_b64, key_bytes)

    conn = op.get_bind()
    conn.execute(
        sa.text("""
            INSERT INTO system_settings (key, value, encrypted_value, updated_at)
            VALUES ('vpn_server_public_key', :pub, NULL, now())
            ON CONFLICT (key) DO UPDATE SET value = :pub, updated_at = now()
        """),
        {"pub": public_key_b64},
    )
    conn.execute(
        sa.text("""
            INSERT INTO system_settings (key, value, encrypted_value, updated_at)
            VALUES ('vpn_server_private_key', NULL, :enc, now())
            ON CONFLICT (key) DO UPDATE SET encrypted_value = :enc, updated_at = now()
        """),
        {"enc": encrypted_private},
    )

    # 2. Grant app_user access to system_settings for runtime VPN key reads
    conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE ON system_settings TO app_user"))

    # 3. Add subnet_index column (nullable first for existing rows)
    op.add_column("vpn_config", sa.Column("subnet_index", sa.Integer(), nullable=True))

    # 4. Assign sequential subnet_index to existing rows and remap IPs
    existing = conn.execute(
        sa.text("SELECT id, tenant_id FROM vpn_config ORDER BY created_at")
    ).fetchall()

    for i, row in enumerate(existing, start=1):
        config_id = row[0]
        tenant_id = row[1]
        subnet = f"10.10.{i}.0/24"
        server_address = f"10.10.{i}.1/24"
        conn.execute(
            sa.text("""
                UPDATE vpn_config
                SET subnet_index = :idx, subnet = :subnet, server_address = :addr
                WHERE id = :id
            """),
            {"idx": i, "subnet": subnet, "addr": server_address, "id": config_id},
        )

        # Remap existing peer IPs: 10.10.0.X → 10.10.{index}.X
        peers = conn.execute(
            sa.text("SELECT id, assigned_ip FROM vpn_peers WHERE tenant_id = :tid"),
            {"tid": tenant_id},
        ).fetchall()

        for peer_row in peers:
            peer_id = peer_row[0]
            old_ip = peer_row[1]  # e.g. "10.10.0.5/24"
            parts = old_ip.split("/")
            octets = parts[0].split(".")
            cidr = parts[1] if len(parts) > 1 else "24"
            new_ip = f"10.10.{i}.{octets[3]}/{cidr}"
            conn.execute(
                sa.text("UPDATE vpn_peers SET assigned_ip = :ip WHERE id = :id"),
                {"ip": new_ip, "id": peer_id},
            )

    # 5. Make subnet_index NOT NULL and add unique constraint
    op.alter_column("vpn_config", "subnet_index", nullable=False)
    op.create_unique_constraint("uq_vpn_config_subnet_index", "vpn_config", ["subnet_index"])

    # 6. Remove old server_defaults (subnets are now dynamically assigned)
    op.alter_column("vpn_config", "subnet", server_default=None)
    op.alter_column("vpn_config", "server_address", server_default=None)


def downgrade() -> None:
    op.drop_constraint("uq_vpn_config_subnet_index", "vpn_config", type_="unique")
    op.drop_column("vpn_config", "subnet_index")
    op.alter_column("vpn_config", "subnet", server_default="10.10.0.0/24")
    op.alter_column("vpn_config", "server_address", server_default="10.10.0.1/24")
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM system_settings WHERE key IN ('vpn_server_public_key', 'vpn_server_private_key')"
        )
    )
    # NOTE: downgrade does not remap peer IPs back. Manual cleanup may be needed.
