"""Centralized audit logging service.

Provides a fire-and-forget ``log_action`` coroutine that inserts a row into
the ``audit_logs`` table.  Uses raw SQL INSERT (not ORM) for minimal overhead.

The function is wrapped in a try/except so that a logging failure **never**
breaks the parent operation.

Phase 30: When details are non-empty, they are encrypted via OpenBao Transit
(per-tenant data key) and stored in encrypted_details. The plaintext details
column is set to '{}' for column compatibility. If Transit encryption fails
(e.g., OpenBao unavailable), details are stored in plaintext as a fallback.
"""

import uuid
from typing import Any, Optional

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger("audit")


async def log_action(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    device_id: Optional[uuid.UUID] = None,
    details: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Insert a row into audit_logs.  Swallows all exceptions on failure."""
    try:
        import json as _json

        details_dict = details or {}
        details_json = _json.dumps(details_dict)
        encrypted_details: Optional[str] = None

        # Attempt Transit encryption for non-empty details
        if details_dict:
            try:
                from app.services.crypto import encrypt_data_transit

                encrypted_details = await encrypt_data_transit(
                    details_json, str(tenant_id)
                )
                # Encryption succeeded — clear plaintext details
                details_json = _json.dumps({})
            except Exception:
                # Transit unavailable — fall back to plaintext details
                logger.warning(
                    "audit_transit_encryption_failed",
                    action=action,
                    tenant_id=str(tenant_id),
                    exc_info=True,
                )
                # Keep details_json as-is (plaintext fallback)
                encrypted_details = None

        await db.execute(
            text(
                "INSERT INTO audit_logs "
                "(tenant_id, user_id, action, resource_type, resource_id, "
                "device_id, details, encrypted_details, ip_address) "
                "VALUES (:tenant_id, :user_id, :action, :resource_type, "
                ":resource_id, :device_id, CAST(:details AS jsonb), "
                ":encrypted_details, :ip_address)"
            ),
            {
                "tenant_id": str(tenant_id),
                "user_id": str(user_id),
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "device_id": str(device_id) if device_id else None,
                "details": details_json,
                "encrypted_details": encrypted_details,
                "ip_address": ip_address,
            },
        )
    except Exception:
        logger.warning(
            "audit_log_insert_failed",
            action=action,
            tenant_id=str(tenant_id),
            exc_info=True,
        )
