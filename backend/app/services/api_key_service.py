"""API key generation, validation, and management service.

Keys use the mktp_ prefix for easy identification in logs.
Storage uses SHA-256 hash -- the plaintext key is never persisted.
Validation uses AdminAsyncSessionLocal since it runs before tenant context is set.
"""

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text

from app.database import AdminAsyncSessionLocal

# Allowed scopes for API keys
ALLOWED_SCOPES: set[str] = {
    "devices:read",
    "devices:write",
    "config:read",
    "config:write",
    "alerts:read",
    "firmware:write",
}


def generate_raw_key() -> str:
    """Generate a raw API key with mktp_ prefix + 32 URL-safe random chars."""
    random_part = secrets.token_urlsafe(32)
    return f"mktp_{random_part}"


def hash_key(raw_key: str) -> str:
    """SHA-256 hex digest of a raw API key."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


async def create_api_key(
    db,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str,
    scopes: list[str],
    expires_at: Optional[datetime] = None,
) -> dict:
    """Create a new API key.

    Returns dict with:
      - key: the plaintext key (shown once, never again)
      - id: the key UUID
      - key_prefix: first 9 chars of the key (e.g. "mktp_abc1")
    """
    raw_key = generate_raw_key()
    key_hash_value = hash_key(raw_key)
    key_prefix = raw_key[:9]  # "mktp_" + first 4 random chars

    result = await db.execute(
        text("""
            INSERT INTO api_keys (tenant_id, user_id, name, key_prefix, key_hash, scopes, expires_at)
            VALUES (:tenant_id, :user_id, :name, :key_prefix, :key_hash, CAST(:scopes AS jsonb), :expires_at)
            RETURNING id, created_at
        """),
        {
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "name": name,
            "key_prefix": key_prefix,
            "key_hash": key_hash_value,
            "scopes": json.dumps(scopes),
            "expires_at": expires_at,
        },
    )
    row = result.fetchone()
    await db.commit()

    return {
        "key": raw_key,
        "id": row.id,
        "key_prefix": key_prefix,
        "name": name,
        "scopes": scopes,
        "expires_at": expires_at,
        "created_at": row.created_at,
    }


async def validate_api_key(raw_key: str) -> Optional[dict]:
    """Validate an API key and return context if valid.

    Uses AdminAsyncSessionLocal since this runs before tenant context is set.

    Returns dict with tenant_id, user_id, scopes, key_id on success.
    Returns None for invalid, expired, or revoked keys.
    Updates last_used_at on successful validation.
    """
    key_hash_value = hash_key(raw_key)

    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT id, tenant_id, user_id, scopes, expires_at, revoked_at
                FROM api_keys
                WHERE key_hash = :key_hash
            """),
            {"key_hash": key_hash_value},
        )
        row = result.fetchone()

        if not row:
            return None

        # Check revoked
        if row.revoked_at is not None:
            return None

        # Check expired
        if row.expires_at is not None and row.expires_at <= datetime.now(timezone.utc):
            return None

        # Update last_used_at
        await session.execute(
            text("""
                UPDATE api_keys SET last_used_at = now()
                WHERE id = :key_id
            """),
            {"key_id": str(row.id)},
        )
        await session.commit()

        return {
            "tenant_id": row.tenant_id,
            "user_id": row.user_id,
            "scopes": row.scopes if row.scopes else [],
            "key_id": row.id,
        }


async def list_api_keys(db, tenant_id: uuid.UUID) -> list[dict]:
    """List all API keys for a tenant (active and revoked).

    Returns keys with masked display (key_prefix + "...").
    """
    result = await db.execute(
        text("""
            SELECT id, name, key_prefix, scopes, expires_at, last_used_at,
                   created_at, revoked_at, user_id
            FROM api_keys
            WHERE tenant_id = :tenant_id
            ORDER BY created_at DESC
        """),
        {"tenant_id": str(tenant_id)},
    )
    rows = result.fetchall()

    return [
        {
            "id": row.id,
            "name": row.name,
            "key_prefix": row.key_prefix,
            "scopes": row.scopes if row.scopes else [],
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
            "user_id": str(row.user_id),
        }
        for row in rows
    ]


async def revoke_api_key(db, tenant_id: uuid.UUID, key_id: uuid.UUID) -> bool:
    """Revoke an API key by setting revoked_at = now().

    Returns True if a key was actually revoked, False if not found or already revoked.
    """
    result = await db.execute(
        text("""
            UPDATE api_keys
            SET revoked_at = now()
            WHERE id = :key_id AND tenant_id = :tenant_id AND revoked_at IS NULL
            RETURNING id
        """),
        {"key_id": str(key_id), "tenant_id": str(tenant_id)},
    )
    row = result.fetchone()
    await db.commit()
    return row is not None
