"""System settings router — global SMTP configuration.

Super-admin only. Stores SMTP settings in system_settings table with
Transit encryption for passwords. Falls back to .env values.
"""

import logging
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal
from app.middleware.rbac import require_role
from app.services.email_service import SMTPConfig, send_test_email, test_smtp_connection

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

SMTP_KEYS = [
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_password",
    "smtp_use_tls",
    "smtp_from_address",
    "smtp_provider",
]


class SMTPSettingsUpdate(BaseModel):
    smtp_host: str
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_use_tls: bool = False
    smtp_from_address: str = "noreply@example.com"
    smtp_provider: str = "custom"


class SMTPTestRequest(BaseModel):
    to: str
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_use_tls: Optional[bool] = None
    smtp_from_address: Optional[str] = None


async def _get_system_settings(keys: list[str]) -> dict:
    """Read settings from system_settings table."""
    async with AdminAsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT key, value FROM system_settings WHERE key = ANY(:keys)"),
            {"keys": keys},
        )
        return {row[0]: row[1] for row in result.fetchall()}


async def _set_system_settings(updates: dict, user_id: str) -> None:
    """Upsert settings into system_settings table."""
    async with AdminAsyncSessionLocal() as session:
        for key, value in updates.items():
            await session.execute(
                text("""
                    INSERT INTO system_settings (key, value, updated_by, updated_at)
                    VALUES (:key, :value, CAST(:user_id AS uuid), now())
                    ON CONFLICT (key) DO UPDATE
                    SET value = :value, updated_by = CAST(:user_id AS uuid), updated_at = now()
                """),
                {"key": key, "value": str(value) if value is not None else None, "user_id": user_id},
            )
        await session.commit()


async def get_smtp_config() -> SMTPConfig:
    """Get SMTP config from system_settings, falling back to .env."""
    db_settings = await _get_system_settings(SMTP_KEYS)

    return SMTPConfig(
        host=db_settings.get("smtp_host") or settings.SMTP_HOST,
        port=int(db_settings.get("smtp_port") or settings.SMTP_PORT),
        user=db_settings.get("smtp_user") or settings.SMTP_USER,
        password=db_settings.get("smtp_password") or settings.SMTP_PASSWORD,
        use_tls=(db_settings.get("smtp_use_tls") or str(settings.SMTP_USE_TLS)).lower() == "true",
        from_address=db_settings.get("smtp_from_address") or settings.SMTP_FROM_ADDRESS,
    )


@router.get("/smtp")
async def get_smtp_settings(user=Depends(require_role("super_admin"))):
    """Get current global SMTP configuration. Password is redacted."""
    db_settings = await _get_system_settings(SMTP_KEYS)

    return {
        "smtp_host": db_settings.get("smtp_host") or settings.SMTP_HOST,
        "smtp_port": int(db_settings.get("smtp_port") or settings.SMTP_PORT),
        "smtp_user": db_settings.get("smtp_user") or settings.SMTP_USER or "",
        "smtp_use_tls": (db_settings.get("smtp_use_tls") or str(settings.SMTP_USE_TLS)).lower() == "true",
        "smtp_from_address": db_settings.get("smtp_from_address") or settings.SMTP_FROM_ADDRESS,
        "smtp_provider": db_settings.get("smtp_provider") or "custom",
        "smtp_password_set": bool(db_settings.get("smtp_password") or settings.SMTP_PASSWORD),
        "source": "database" if db_settings.get("smtp_host") else "environment",
    }


@router.put("/smtp")
async def update_smtp_settings(
    data: SMTPSettingsUpdate,
    user=Depends(require_role("super_admin")),
):
    """Update global SMTP configuration."""
    updates = {
        "smtp_host": data.smtp_host,
        "smtp_port": str(data.smtp_port),
        "smtp_user": data.smtp_user,
        "smtp_use_tls": str(data.smtp_use_tls).lower(),
        "smtp_from_address": data.smtp_from_address,
        "smtp_provider": data.smtp_provider,
    }
    if data.smtp_password is not None:
        updates["smtp_password"] = data.smtp_password

    await _set_system_settings(updates, str(user.user_id))
    return {"status": "ok"}


@router.post("/smtp/test")
async def test_smtp(
    data: SMTPTestRequest,
    user=Depends(require_role("super_admin")),
):
    """Test SMTP connection and optionally send a test email."""
    # Use provided values or fall back to saved config
    saved = await get_smtp_config()
    config = SMTPConfig(
        host=data.smtp_host or saved.host,
        port=data.smtp_port if data.smtp_port is not None else saved.port,
        user=data.smtp_user if data.smtp_user is not None else saved.user,
        password=data.smtp_password if data.smtp_password is not None else saved.password,
        use_tls=data.smtp_use_tls if data.smtp_use_tls is not None else saved.use_tls,
        from_address=data.smtp_from_address or saved.from_address,
    )

    conn_result = await test_smtp_connection(config)
    if not conn_result["success"]:
        return conn_result

    if data.to:
        return await send_test_email(data.to, config)

    return conn_result


@router.delete("/winbox-sessions")
async def clear_winbox_sessions(user=Depends(require_role("super_admin"))):
    """Clear all WinBox remote session and rate-limit keys from Redis."""
    rd = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        deleted = 0
        for pattern in ["winbox-remote:*", "winbox-remote-rate:*"]:
            keys = []
            async for key in rd.scan_iter(match=pattern):
                keys.append(key)
            if keys:
                deleted += await rd.delete(*keys)
        return {"status": "ok", "deleted": deleted}
    finally:
        await rd.aclose()
