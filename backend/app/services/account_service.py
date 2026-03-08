"""Account self-service operations: deletion and data export.

Provides GDPR/CCPA-compliant account deletion with full PII erasure
and data portability export (Article 20).

All queries use raw SQL via text() with admin sessions (bypass RLS)
since these are cross-table operations on the authenticated user's data.
"""

import hashlib
import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AdminAsyncSessionLocal
from app.services.audit_service import log_action

logger = structlog.get_logger("account_service")


async def delete_user_account(
    db: AsyncSession,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID | None,
    user_email: str,
) -> dict[str, Any]:
    """Hard-delete a user account with full PII erasure.

    Steps:
    1. Create a deletion receipt audit log (persisted via separate session)
    2. Anonymize PII in existing audit_logs for this user
    3. Hard-delete the user row (CASCADE handles related tables)
    4. Best-effort session invalidation via Redis

    Args:
        db: Admin async session (bypasses RLS).
        user_id: UUID of the user to delete.
        tenant_id: Tenant UUID (None for super_admin).
        user_email: User's email (needed for audit hash before deletion).

    Returns:
        Dict with deleted=True and user_id on success.
    """
    effective_tenant_id = tenant_id or uuid.UUID(int=0)
    email_hash = hashlib.sha256(user_email.encode()).hexdigest()

    # ── 1. Pre-deletion audit receipt (separate session so it persists) ────
    try:
        async with AdminAsyncSessionLocal() as audit_db:
            await log_action(
                audit_db,
                tenant_id=effective_tenant_id,
                user_id=user_id,
                action="account_deleted",
                resource_type="user",
                resource_id=str(user_id),
                details={
                    "deleted_user_id": str(user_id),
                    "email_hash": email_hash,
                    "deletion_type": "self_service",
                    "deleted_at": datetime.now(UTC).isoformat(),
                },
            )
            await audit_db.commit()
    except Exception:
        logger.warning(
            "deletion_receipt_failed",
            user_id=str(user_id),
            exc_info=True,
        )

    # ── 2. Anonymize PII in audit_logs for this user ─────────────────────
    # Strip PII keys from details JSONB (email, name, user_email, user_name)
    await db.execute(
        text(
            "UPDATE audit_logs "
            "SET details = details - 'email' - 'name' - 'user_email' - 'user_name' "
            "WHERE user_id = :user_id"
        ),
        {"user_id": user_id},
    )

    # Null out encrypted_details (may contain encrypted PII)
    await db.execute(
        text(
            "UPDATE audit_logs "
            "SET encrypted_details = NULL "
            "WHERE user_id = :user_id"
        ),
        {"user_id": user_id},
    )

    # ── 3. Hard delete user row ──────────────────────────────────────────
    # CASCADE handles: user_key_sets, api_keys, password_reset_tokens
    # SET NULL handles: audit_logs.user_id, key_access_log.user_id,
    #   maintenance_windows.created_by, alert_events.acknowledged_by
    await db.execute(
        text("DELETE FROM users WHERE id = :user_id"),
        {"user_id": user_id},
    )

    await db.commit()

    # ── 4. Best-effort Redis session invalidation ────────────────────────
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        from app.services.auth import revoke_user_tokens

        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await revoke_user_tokens(r, str(user_id))
        await r.aclose()
    except Exception:
        # JWT expires in 15 min anyway; not critical
        logger.debug("redis_session_invalidation_skipped", user_id=str(user_id))

    logger.info("account_deleted", user_id=str(user_id), email_hash=email_hash)

    return {"deleted": True, "user_id": str(user_id)}


async def export_user_data(
    db: AsyncSession,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID | None,
) -> dict[str, Any]:
    """Assemble all user data for GDPR Art. 20 data portability export.

    Returns a structured dict with user profile, API keys, audit logs,
    and key access log entries.

    Args:
        db: Admin async session (bypasses RLS).
        user_id: UUID of the user whose data to export.
        tenant_id: Tenant UUID (None for super_admin).

    Returns:
        Envelope dict with export_date, format_version, and all user data.
    """

    # ── User profile ─────────────────────────────────────────────────────
    result = await db.execute(
        text(
            "SELECT id, email, name, role, tenant_id, "
            "created_at, last_login, auth_version "
            "FROM users WHERE id = :user_id"
        ),
        {"user_id": user_id},
    )
    user_row = result.mappings().first()
    user_data: dict[str, Any] = {}
    if user_row:
        user_data = {
            "id": str(user_row["id"]),
            "email": user_row["email"],
            "name": user_row["name"],
            "role": user_row["role"],
            "tenant_id": str(user_row["tenant_id"]) if user_row["tenant_id"] else None,
            "created_at": user_row["created_at"].isoformat() if user_row["created_at"] else None,
            "last_login": user_row["last_login"].isoformat() if user_row["last_login"] else None,
            "auth_version": user_row["auth_version"],
        }

    # ── API keys (exclude key_hash for security) ─────────────────────────
    result = await db.execute(
        text(
            "SELECT id, name, key_prefix, scopes, created_at, "
            "expires_at, revoked_at, last_used_at "
            "FROM api_keys WHERE user_id = :user_id "
            "ORDER BY created_at DESC"
        ),
        {"user_id": user_id},
    )
    api_keys = []
    for row in result.mappings().all():
        api_keys.append({
            "id": str(row["id"]),
            "name": row["name"],
            "key_prefix": row["key_prefix"],
            "scopes": row["scopes"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "expires_at": row["expires_at"].isoformat() if row["expires_at"] else None,
            "revoked_at": row["revoked_at"].isoformat() if row["revoked_at"] else None,
            "last_used_at": row["last_used_at"].isoformat() if row["last_used_at"] else None,
        })

    # ── Audit logs (limit 1000, most recent first) ───────────────────────
    result = await db.execute(
        text(
            "SELECT id, action, resource_type, resource_id, "
            "details, ip_address, created_at "
            "FROM audit_logs WHERE user_id = :user_id "
            "ORDER BY created_at DESC LIMIT 1000"
        ),
        {"user_id": user_id},
    )
    audit_logs = []
    for row in result.mappings().all():
        details = row["details"] if row["details"] else {}
        audit_logs.append({
            "id": str(row["id"]),
            "action": row["action"],
            "resource_type": row["resource_type"],
            "resource_id": row["resource_id"],
            "details": details,
            "ip_address": row["ip_address"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        })

    # ── Key access log (limit 1000, most recent first) ───────────────────
    result = await db.execute(
        text(
            "SELECT id, action, resource_type, ip_address, created_at "
            "FROM key_access_log WHERE user_id = :user_id "
            "ORDER BY created_at DESC LIMIT 1000"
        ),
        {"user_id": user_id},
    )
    key_access_entries = []
    for row in result.mappings().all():
        key_access_entries.append({
            "id": str(row["id"]),
            "action": row["action"],
            "resource_type": row["resource_type"],
            "ip_address": row["ip_address"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        })

    return {
        "export_date": datetime.now(UTC).isoformat(),
        "format_version": "1.0",
        "user": user_data,
        "api_keys": api_keys,
        "audit_logs": audit_logs,
        "key_access_log": key_access_entries,
    }
