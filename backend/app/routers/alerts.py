"""Alert management API endpoints.

Tenant-scoped routes under /api/tenants/{tenant_id}/ for:
- Alert rules CRUD (list, create, update, delete, toggle)
- Notification channels CRUD (list, create, update, delete, test)
- Alert events listing with pagination and filtering
- Active alert count for nav badge
- Acknowledge and silence actions
- Device-scoped alert listing

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: viewer = read-only (GET); operator and above = write (POST/PUT/PATCH/DELETE).
"""

import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
import re

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, set_tenant_context
from app.middleware.rate_limit import limiter
from app.middleware.rbac import require_scope
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.services.audit_service import log_action

logger = logging.getLogger(__name__)

router = APIRouter(tags=["alerts"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    if current_user.is_super_admin:
        await set_tenant_context(db, str(tenant_id))
    elif current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant",
        )


def _require_write(current_user: CurrentUser) -> None:
    """Raise 403 if user is a viewer (read-only)."""
    if current_user.role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers have read-only access.",
        )


EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

ALLOWED_METRICS = {
    "cpu_load",
    "memory_used_pct",
    "disk_used_pct",
    "temperature",
    "signal_strength",
    "ccq",
    "client_count",
}
ALLOWED_OPERATORS = {"gt", "lt", "gte", "lte"}
ALLOWED_SEVERITIES = {"critical", "warning", "info"}


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class AlertRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    metric: str
    operator: str
    threshold: float
    duration_polls: int = 1
    severity: str = "warning"
    device_id: Optional[str] = None
    group_id: Optional[str] = None
    channel_ids: list[str] = []
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    metric: str
    operator: str
    threshold: float
    duration_polls: int = 1
    severity: str = "warning"
    device_id: Optional[str] = None
    group_id: Optional[str] = None
    channel_ids: list[str] = []
    enabled: bool = True


class ChannelCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    channel_type: str  # "email", "webhook", or "slack"
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None  # plaintext — will be encrypted before storage
    smtp_use_tls: bool = False
    from_address: Optional[str] = None
    to_address: Optional[str] = None
    webhook_url: Optional[str] = None
    slack_webhook_url: Optional[str] = None

    @model_validator(mode="after")
    def validate_email_fields(self):
        if self.channel_type == "email":
            missing = []
            if not self.smtp_host:
                missing.append("smtp_host")
            if not self.smtp_port:
                missing.append("smtp_port")
            if not self.to_address:
                missing.append("to_address")
            if missing:
                raise ValueError(f"Email channels require: {', '.join(missing)}")
            if self.to_address and not EMAIL_REGEX.match(self.to_address):
                raise ValueError(f"Invalid email address: {self.to_address}")
            if self.from_address and not EMAIL_REGEX.match(self.from_address):
                raise ValueError(f"Invalid from address: {self.from_address}")
        return self


class ChannelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    channel_type: str
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None  # if None, keep existing
    smtp_use_tls: bool = False
    from_address: Optional[str] = None
    to_address: Optional[str] = None
    webhook_url: Optional[str] = None
    slack_webhook_url: Optional[str] = None


class SilenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    duration_minutes: int


# =========================================================================
# ALERT RULES CRUD
# =========================================================================


@router.get(
    "/tenants/{tenant_id}/alert-rules",
    summary="List all alert rules for tenant",
    dependencies=[require_scope("alerts:read")],
)
async def list_alert_rules(
    tenant_id: uuid.UUID,
    enabled: Optional[bool] = Query(None),
    metric: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    await _check_tenant_access(current_user, tenant_id, db)

    filters = ["1=1"]
    params: dict[str, Any] = {}

    if enabled is not None:
        filters.append("ar.enabled = :enabled")
        params["enabled"] = enabled
    if metric:
        filters.append("ar.metric = :metric")
        params["metric"] = metric

    where = " AND ".join(filters)

    result = await db.execute(
        text(f"""
            SELECT ar.id, ar.tenant_id, ar.device_id, ar.group_id,
                   ar.name, ar.metric, ar.operator, ar.threshold,
                   ar.duration_polls, ar.severity, ar.enabled, ar.is_default,
                   ar.created_at,
                   COALESCE(
                       (SELECT json_agg(arc.channel_id)
                        FROM alert_rule_channels arc
                        WHERE arc.rule_id = ar.id),
                       '[]'::json
                   ) AS channel_ids
            FROM alert_rules ar
            WHERE {where}
            ORDER BY ar.created_at DESC
        """),
        params,
    )

    rows = result.fetchall()
    return [
        {
            "id": str(row[0]),
            "tenant_id": str(row[1]),
            "device_id": str(row[2]) if row[2] else None,
            "group_id": str(row[3]) if row[3] else None,
            "name": row[4],
            "metric": row[5],
            "operator": row[6],
            "threshold": float(row[7]),
            "duration_polls": row[8],
            "severity": row[9],
            "enabled": row[10],
            "is_default": row[11],
            "created_at": row[12].isoformat() if row[12] else None,
            "channel_ids": [str(c) for c in (row[13] if isinstance(row[13], list) else [])],
        }
        for row in rows
    ]


@router.post(
    "/tenants/{tenant_id}/alert-rules",
    summary="Create alert rule",
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def create_alert_rule(
    request: Request,
    tenant_id: uuid.UUID,
    body: AlertRuleCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    if body.metric not in ALLOWED_METRICS:
        raise HTTPException(422, f"metric must be one of: {', '.join(sorted(ALLOWED_METRICS))}")
    if body.operator not in ALLOWED_OPERATORS:
        raise HTTPException(422, f"operator must be one of: {', '.join(sorted(ALLOWED_OPERATORS))}")
    if body.severity not in ALLOWED_SEVERITIES:
        raise HTTPException(
            422, f"severity must be one of: {', '.join(sorted(ALLOWED_SEVERITIES))}"
        )

    rule_id = str(uuid.uuid4())

    await db.execute(
        text("""
            INSERT INTO alert_rules
                (id, tenant_id, device_id, group_id, name, metric, operator,
                 threshold, duration_polls, severity, enabled)
            VALUES
                (CAST(:id AS uuid), CAST(:tenant_id AS uuid),
                 CAST(:device_id AS uuid), CAST(:group_id AS uuid),
                 :name, :metric, :operator, :threshold, :duration_polls,
                 :severity, :enabled)
        """),
        {
            "id": rule_id,
            "tenant_id": str(tenant_id),
            "device_id": body.device_id,
            "group_id": body.group_id,
            "name": body.name,
            "metric": body.metric,
            "operator": body.operator,
            "threshold": body.threshold,
            "duration_polls": body.duration_polls,
            "severity": body.severity,
            "enabled": body.enabled,
        },
    )

    # Create channel associations
    for ch_id in body.channel_ids:
        await db.execute(
            text("""
                INSERT INTO alert_rule_channels (rule_id, channel_id)
                VALUES (CAST(:rule_id AS uuid), CAST(:channel_id AS uuid))
            """),
            {"rule_id": rule_id, "channel_id": ch_id},
        )

    await db.commit()

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "alert_rule_create",
            resource_type="alert_rule",
            resource_id=rule_id,
            details={"name": body.name, "metric": body.metric, "severity": body.severity},
        )
    except Exception:
        pass

    return {
        "id": rule_id,
        "tenant_id": str(tenant_id),
        "name": body.name,
        "metric": body.metric,
        "operator": body.operator,
        "threshold": body.threshold,
        "duration_polls": body.duration_polls,
        "severity": body.severity,
        "enabled": body.enabled,
        "channel_ids": body.channel_ids,
    }


@router.put(
    "/tenants/{tenant_id}/alert-rules/{rule_id}",
    summary="Update alert rule",
)
@limiter.limit("20/minute")
async def update_alert_rule(
    request: Request,
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    body: AlertRuleUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    if body.metric not in ALLOWED_METRICS:
        raise HTTPException(422, f"metric must be one of: {', '.join(sorted(ALLOWED_METRICS))}")
    if body.operator not in ALLOWED_OPERATORS:
        raise HTTPException(422, f"operator must be one of: {', '.join(sorted(ALLOWED_OPERATORS))}")
    if body.severity not in ALLOWED_SEVERITIES:
        raise HTTPException(
            422, f"severity must be one of: {', '.join(sorted(ALLOWED_SEVERITIES))}"
        )

    result = await db.execute(
        text("""
            UPDATE alert_rules
            SET name = :name, metric = :metric, operator = :operator,
                threshold = :threshold, duration_polls = :duration_polls,
                severity = :severity, device_id = CAST(:device_id AS uuid),
                group_id = CAST(:group_id AS uuid), enabled = :enabled
            WHERE id = CAST(:rule_id AS uuid)
            RETURNING id
        """),
        {
            "rule_id": str(rule_id),
            "name": body.name,
            "metric": body.metric,
            "operator": body.operator,
            "threshold": body.threshold,
            "duration_polls": body.duration_polls,
            "severity": body.severity,
            "device_id": body.device_id,
            "group_id": body.group_id,
            "enabled": body.enabled,
        },
    )
    if not result.fetchone():
        raise HTTPException(404, "Alert rule not found")

    # Replace channel associations
    await db.execute(
        text("DELETE FROM alert_rule_channels WHERE rule_id = CAST(:rule_id AS uuid)"),
        {"rule_id": str(rule_id)},
    )
    for ch_id in body.channel_ids:
        await db.execute(
            text("""
                INSERT INTO alert_rule_channels (rule_id, channel_id)
                VALUES (CAST(:rule_id AS uuid), CAST(:channel_id AS uuid))
            """),
            {"rule_id": str(rule_id), "channel_id": ch_id},
        )

    await db.commit()

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "alert_rule_update",
            resource_type="alert_rule",
            resource_id=str(rule_id),
            details={"name": body.name, "metric": body.metric, "severity": body.severity},
        )
    except Exception:
        pass

    return {
        "id": str(rule_id),
        "name": body.name,
        "metric": body.metric,
        "operator": body.operator,
        "threshold": body.threshold,
        "duration_polls": body.duration_polls,
        "severity": body.severity,
        "enabled": body.enabled,
        "channel_ids": body.channel_ids,
    }


@router.delete(
    "/tenants/{tenant_id}/alert-rules/{rule_id}",
    summary="Delete alert rule",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("5/minute")
async def delete_alert_rule(
    request: Request,
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    # Prevent deletion of default rules
    check = await db.execute(
        text("SELECT is_default FROM alert_rules WHERE id = CAST(:id AS uuid)"),
        {"id": str(rule_id)},
    )
    row = check.fetchone()
    if not row:
        raise HTTPException(404, "Alert rule not found")
    if row[0]:
        raise HTTPException(422, "Cannot delete default alert rules. Disable them instead.")

    await db.execute(
        text("DELETE FROM alert_rules WHERE id = CAST(:id AS uuid)"),
        {"id": str(rule_id)},
    )
    await db.commit()

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "alert_rule_delete",
            resource_type="alert_rule",
            resource_id=str(rule_id),
        )
    except Exception:
        pass


@router.patch(
    "/tenants/{tenant_id}/alert-rules/{rule_id}/toggle",
    summary="Toggle alert rule enabled/disabled",
)
@limiter.limit("20/minute")
async def toggle_alert_rule(
    request: Request,
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    result = await db.execute(
        text("""
            UPDATE alert_rules SET enabled = NOT enabled
            WHERE id = CAST(:id AS uuid)
            RETURNING id, enabled
        """),
        {"id": str(rule_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Alert rule not found")
    await db.commit()

    return {"id": str(row[0]), "enabled": row[1]}


# =========================================================================
# NOTIFICATION CHANNELS CRUD
# =========================================================================


class SMTPTestRequest(BaseModel):
    smtp_host: str
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_use_tls: bool = False
    from_address: str = "alerts@example.com"
    to_address: str


@router.post(
    "/tenants/{tenant_id}/notification-channels/test-smtp",
    summary="Test SMTP settings before creating a channel",
)
async def test_channel_smtp(
    tenant_id: uuid.UUID,
    data: SMTPTestRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Test SMTP settings before creating a channel."""
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    from app.services.email_service import SMTPConfig, send_test_email

    config = SMTPConfig(
        host=data.smtp_host,
        port=data.smtp_port,
        user=data.smtp_user,
        password=data.smtp_password,
        use_tls=data.smtp_use_tls,
        from_address=data.from_address,
    )
    result = await send_test_email(data.to_address, config)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.get(
    "/tenants/{tenant_id}/notification-channels",
    summary="List notification channels for tenant",
    dependencies=[require_scope("alerts:read")],
)
async def list_notification_channels(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT id, tenant_id, name, channel_type,
                   smtp_host, smtp_port, smtp_user, smtp_use_tls,
                   from_address, to_address, webhook_url,
                   created_at, slack_webhook_url
            FROM notification_channels
            ORDER BY created_at DESC
        """)
    )

    return [
        {
            "id": str(row[0]),
            "tenant_id": str(row[1]),
            "name": row[2],
            "channel_type": row[3],
            "smtp_host": row[4],
            "smtp_port": row[5],
            "smtp_user": row[6],
            "smtp_use_tls": row[7],
            "from_address": row[8],
            "to_address": row[9],
            "webhook_url": row[10],
            "created_at": row[11].isoformat() if row[11] else None,
            "slack_webhook_url": row[12],
        }
        for row in result.fetchall()
    ]


@router.post(
    "/tenants/{tenant_id}/notification-channels",
    summary="Create notification channel",
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def create_notification_channel(
    request: Request,
    tenant_id: uuid.UUID,
    body: ChannelCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    if body.channel_type not in ("email", "webhook", "slack"):
        raise HTTPException(422, "channel_type must be 'email', 'webhook', or 'slack'")

    channel_id = str(uuid.uuid4())

    from app.services.crypto import encrypt_credentials_transit

    # Encrypt SMTP password via Transit if provided
    encrypted_password_transit = None
    if body.smtp_password:
        encrypted_password_transit = await encrypt_credentials_transit(
            body.smtp_password,
            str(tenant_id),
        )

    await db.execute(
        text("""
            INSERT INTO notification_channels
                (id, tenant_id, name, channel_type, smtp_host, smtp_port,
                 smtp_user, smtp_password_transit, smtp_use_tls, from_address,
                 to_address, webhook_url, slack_webhook_url)
            VALUES
                (CAST(:id AS uuid), CAST(:tenant_id AS uuid),
                 :name, :channel_type, :smtp_host, :smtp_port,
                 :smtp_user, :smtp_password_transit, :smtp_use_tls,
                 :from_address, :to_address, :webhook_url,
                 :slack_webhook_url)
        """),
        {
            "id": channel_id,
            "tenant_id": str(tenant_id),
            "name": body.name,
            "channel_type": body.channel_type,
            "smtp_host": body.smtp_host,
            "smtp_port": body.smtp_port,
            "smtp_user": body.smtp_user,
            "smtp_password_transit": encrypted_password_transit,
            "smtp_use_tls": body.smtp_use_tls,
            "from_address": body.from_address,
            "to_address": body.to_address,
            "webhook_url": body.webhook_url,
            "slack_webhook_url": body.slack_webhook_url,
        },
    )
    await db.commit()

    return {
        "id": channel_id,
        "tenant_id": str(tenant_id),
        "name": body.name,
        "channel_type": body.channel_type,
        "smtp_host": body.smtp_host,
        "smtp_port": body.smtp_port,
        "smtp_user": body.smtp_user,
        "smtp_use_tls": body.smtp_use_tls,
        "from_address": body.from_address,
        "to_address": body.to_address,
        "webhook_url": body.webhook_url,
        "slack_webhook_url": body.slack_webhook_url,
    }


@router.put(
    "/tenants/{tenant_id}/notification-channels/{channel_id}",
    summary="Update notification channel",
)
@limiter.limit("20/minute")
async def update_notification_channel(
    request: Request,
    tenant_id: uuid.UUID,
    channel_id: uuid.UUID,
    body: ChannelUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    if body.channel_type not in ("email", "webhook", "slack"):
        raise HTTPException(422, "channel_type must be 'email', 'webhook', or 'slack'")

    from app.services.crypto import encrypt_credentials_transit

    # Build SET clauses dynamically based on which secrets are provided
    set_parts = [
        "name = :name",
        "channel_type = :channel_type",
        "smtp_host = :smtp_host",
        "smtp_port = :smtp_port",
        "smtp_user = :smtp_user",
        "smtp_use_tls = :smtp_use_tls",
        "from_address = :from_address",
        "to_address = :to_address",
        "webhook_url = :webhook_url",
        "slack_webhook_url = :slack_webhook_url",
    ]
    params: dict[str, Any] = {
        "id": str(channel_id),
        "name": body.name,
        "channel_type": body.channel_type,
        "smtp_host": body.smtp_host,
        "smtp_port": body.smtp_port,
        "smtp_user": body.smtp_user,
        "smtp_use_tls": body.smtp_use_tls,
        "from_address": body.from_address,
        "to_address": body.to_address,
        "webhook_url": body.webhook_url,
        "slack_webhook_url": body.slack_webhook_url,
    }

    if body.smtp_password:
        set_parts.append("smtp_password_transit = :smtp_password_transit")
        params["smtp_password_transit"] = await encrypt_credentials_transit(
            body.smtp_password,
            str(tenant_id),
        )
        # Clear legacy column
        set_parts.append("smtp_password = NULL")

    set_clause = ", ".join(set_parts)
    result = await db.execute(
        text(f"""
            UPDATE notification_channels
            SET {set_clause}
            WHERE id = CAST(:id AS uuid)
            RETURNING id
        """),
        params,
    )

    if not result.fetchone():
        raise HTTPException(404, "Notification channel not found")
    await db.commit()

    return {
        "id": str(channel_id),
        "name": body.name,
        "channel_type": body.channel_type,
        "smtp_host": body.smtp_host,
        "smtp_port": body.smtp_port,
        "smtp_user": body.smtp_user,
        "smtp_use_tls": body.smtp_use_tls,
        "from_address": body.from_address,
        "to_address": body.to_address,
        "webhook_url": body.webhook_url,
        "slack_webhook_url": body.slack_webhook_url,
    }


@router.delete(
    "/tenants/{tenant_id}/notification-channels/{channel_id}",
    summary="Delete notification channel",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("5/minute")
async def delete_notification_channel(
    request: Request,
    tenant_id: uuid.UUID,
    channel_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    result = await db.execute(
        text("DELETE FROM notification_channels WHERE id = CAST(:id AS uuid) RETURNING id"),
        {"id": str(channel_id)},
    )
    if not result.fetchone():
        raise HTTPException(404, "Notification channel not found")
    await db.commit()


@router.post(
    "/tenants/{tenant_id}/notification-channels/{channel_id}/test",
    summary="Send test notification via channel",
)
@limiter.limit("5/minute")
async def test_notification_channel(
    request: Request,
    tenant_id: uuid.UUID,
    channel_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    # Fetch channel as dict for notification_service
    result = await db.execute(
        text("""
            SELECT id, tenant_id, name, channel_type,
                   smtp_host, smtp_port, smtp_user, smtp_password,
                   smtp_use_tls, from_address, to_address,
                   webhook_url, smtp_password_transit,
                   slack_webhook_url
            FROM notification_channels
            WHERE id = CAST(:id AS uuid)
        """),
        {"id": str(channel_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Notification channel not found")

    channel = {
        "id": str(row[0]),
        "tenant_id": str(row[1]),
        "name": row[2],
        "channel_type": row[3],
        "smtp_host": row[4],
        "smtp_port": row[5],
        "smtp_user": row[6],
        "smtp_password": row[7],
        "smtp_use_tls": row[8],
        "from_address": row[9],
        "to_address": row[10],
        "webhook_url": row[11],
        "smtp_password_transit": row[12],
        "slack_webhook_url": row[13],
    }

    from app.services.notification_service import send_test_notification

    try:
        success = await send_test_notification(channel)
        if success:
            return {"status": "ok", "message": "Test notification sent successfully"}
        else:
            raise HTTPException(422, "Test notification delivery failed")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, f"Test notification failed: {str(exc)}")


# =========================================================================
# ALERT EVENTS (read + actions)
# =========================================================================


@router.get(
    "/tenants/{tenant_id}/alerts",
    summary="List alert events with filtering and pagination",
    dependencies=[require_scope("alerts:read")],
)
async def list_alerts(
    tenant_id: uuid.UUID,
    alert_status: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    device_id: Optional[str] = Query(None),
    rule_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    filters = ["1=1"]
    params: dict[str, Any] = {}

    if alert_status:
        filters.append("ae.status = :status")
        params["status"] = alert_status
    if severity:
        filters.append("ae.severity = :severity")
        params["severity"] = severity
    if device_id:
        filters.append("ae.device_id = CAST(:device_id AS uuid)")
        params["device_id"] = device_id
    if rule_id:
        filters.append("ae.rule_id = CAST(:rule_id AS uuid)")
        params["rule_id"] = rule_id
    if start_date:
        filters.append("ae.fired_at >= CAST(:start_date AS timestamptz)")
        params["start_date"] = start_date
    if end_date:
        filters.append("ae.fired_at <= CAST(:end_date AS timestamptz)")
        params["end_date"] = end_date

    where = " AND ".join(filters)
    offset = (page - 1) * per_page

    # Get total count
    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM alert_events ae WHERE {where}"),
        params,
    )
    total = count_result.scalar() or 0

    # Get page of results with device hostname and rule name
    result = await db.execute(
        text(f"""
            SELECT ae.id, ae.rule_id, ae.device_id, ae.tenant_id,
                   ae.status, ae.severity, ae.metric, ae.value,
                   ae.threshold, ae.message, ae.is_flapping,
                   ae.acknowledged_at, ae.silenced_until,
                   ae.fired_at, ae.resolved_at,
                   d.hostname AS device_hostname,
                   ar.name AS rule_name
            FROM alert_events ae
            LEFT JOIN devices d ON d.id = ae.device_id
            LEFT JOIN alert_rules ar ON ar.id = ae.rule_id
            WHERE {where}
            ORDER BY ae.fired_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": per_page, "offset": offset},
    )

    items = [
        {
            "id": str(row[0]),
            "rule_id": str(row[1]) if row[1] else None,
            "device_id": str(row[2]),
            "tenant_id": str(row[3]),
            "status": row[4],
            "severity": row[5],
            "metric": row[6],
            "value": float(row[7]) if row[7] is not None else None,
            "threshold": float(row[8]) if row[8] is not None else None,
            "message": row[9],
            "is_flapping": row[10],
            "acknowledged_at": row[11].isoformat() if row[11] else None,
            "silenced_until": row[12].isoformat() if row[12] else None,
            "fired_at": row[13].isoformat() if row[13] else None,
            "resolved_at": row[14].isoformat() if row[14] else None,
            "device_hostname": row[15],
            "rule_name": row[16],
        }
        for row in result.fetchall()
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get(
    "/tenants/{tenant_id}/alerts/active-count",
    summary="Get count of active (firing) alerts for nav badge",
    dependencies=[require_scope("alerts:read")],
)
async def get_active_alert_count(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT COUNT(*) FROM alert_events
            WHERE status = 'firing'
              AND resolved_at IS NULL
              AND (silenced_until IS NULL OR silenced_until < NOW())
        """)
    )
    count = result.scalar() or 0
    return {"count": count}


@router.post(
    "/tenants/{tenant_id}/alerts/{alert_id}/acknowledge",
    summary="Acknowledge an active alert",
)
@limiter.limit("20/minute")
async def acknowledge_alert(
    request: Request,
    tenant_id: uuid.UUID,
    alert_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    result = await db.execute(
        text("""
            UPDATE alert_events
            SET acknowledged_at = NOW(), acknowledged_by = CAST(:user_id AS uuid)
            WHERE id = CAST(:id AS uuid)
            RETURNING id
        """),
        {"id": str(alert_id), "user_id": str(current_user.user_id)},
    )
    if not result.fetchone():
        raise HTTPException(404, "Alert not found")
    await db.commit()

    return {"status": "ok", "message": "Alert acknowledged"}


@router.post(
    "/tenants/{tenant_id}/alerts/{alert_id}/silence",
    summary="Silence an alert for a specified duration",
)
@limiter.limit("20/minute")
async def silence_alert(
    request: Request,
    tenant_id: uuid.UUID,
    alert_id: uuid.UUID,
    body: SilenceRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _check_tenant_access(current_user, tenant_id, db)
    _require_write(current_user)

    if body.duration_minutes < 1:
        raise HTTPException(422, "duration_minutes must be at least 1")

    result = await db.execute(
        text("""
            UPDATE alert_events
            SET silenced_until = NOW() + (:minutes || ' minutes')::interval
            WHERE id = CAST(:id AS uuid)
            RETURNING id
        """),
        {"id": str(alert_id), "minutes": str(body.duration_minutes)},
    )
    if not result.fetchone():
        raise HTTPException(404, "Alert not found")
    await db.commit()

    return {"status": "ok", "message": f"Alert silenced for {body.duration_minutes} minutes"}


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/alerts",
    summary="List alerts for a specific device",
    dependencies=[require_scope("alerts:read")],
)
async def list_device_alerts(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    alert_status: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_tenant_access(current_user, tenant_id, db)

    filters = ["ae.device_id = CAST(:device_id AS uuid)"]
    params: dict[str, Any] = {"device_id": str(device_id)}

    if alert_status:
        filters.append("ae.status = :status")
        params["status"] = alert_status

    where = " AND ".join(filters)
    offset = (page - 1) * per_page

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM alert_events ae WHERE {where}"),
        params,
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        text(f"""
            SELECT ae.id, ae.rule_id, ae.device_id, ae.tenant_id,
                   ae.status, ae.severity, ae.metric, ae.value,
                   ae.threshold, ae.message, ae.is_flapping,
                   ae.acknowledged_at, ae.silenced_until,
                   ae.fired_at, ae.resolved_at,
                   ar.name AS rule_name
            FROM alert_events ae
            LEFT JOIN alert_rules ar ON ar.id = ae.rule_id
            WHERE {where}
            ORDER BY ae.fired_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": per_page, "offset": offset},
    )

    items = [
        {
            "id": str(row[0]),
            "rule_id": str(row[1]) if row[1] else None,
            "device_id": str(row[2]),
            "tenant_id": str(row[3]),
            "status": row[4],
            "severity": row[5],
            "metric": row[6],
            "value": float(row[7]) if row[7] is not None else None,
            "threshold": float(row[8]) if row[8] is not None else None,
            "message": row[9],
            "is_flapping": row[10],
            "acknowledged_at": row[11].isoformat() if row[11] else None,
            "silenced_until": row[12].isoformat() if row[12] else None,
            "fired_at": row[13].isoformat() if row[13] else None,
            "resolved_at": row[14].isoformat() if row[14] else None,
            "rule_name": row[15],
        }
        for row in result.fetchall()
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
    }
