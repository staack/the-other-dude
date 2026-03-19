"""Site alert service -- CRUD for site/sector alert rules and events.

All functions use raw SQL via the app_user engine (RLS enforced).
Tenant isolation is handled automatically by PostgreSQL RLS policies
once the tenant context is set by the middleware.
"""

import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.site_alert import (
    SiteAlertEventListResponse,
    SiteAlertEventResponse,
    SiteAlertRuleCreate,
    SiteAlertRuleListResponse,
    SiteAlertRuleResponse,
    SiteAlertRuleUpdate,
)


# ---------------------------------------------------------------------------
# Alert Rules CRUD
# ---------------------------------------------------------------------------


async def create_alert_rule(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    data: SiteAlertRuleCreate,
) -> SiteAlertRuleResponse:
    """Create a new site alert rule."""
    result = await db.execute(
        text("""
            INSERT INTO site_alert_rules
                (tenant_id, site_id, sector_id, rule_type, name, description,
                 threshold_value, threshold_unit, enabled)
            VALUES
                (:tenant_id, :site_id, :sector_id, :rule_type, :name, :description,
                 :threshold_value, :threshold_unit, :enabled)
            RETURNING id, tenant_id, site_id, sector_id, rule_type, name, description,
                      threshold_value, threshold_unit, enabled, created_at, updated_at
        """),
        {
            "tenant_id": str(tenant_id),
            "site_id": str(site_id),
            "sector_id": str(data.sector_id) if data.sector_id else None,
            "rule_type": data.rule_type,
            "name": data.name,
            "description": data.description,
            "threshold_value": data.threshold_value,
            "threshold_unit": data.threshold_unit,
            "enabled": data.enabled,
        },
    )
    row = result.fetchone()
    return SiteAlertRuleResponse(
        id=row.id,
        tenant_id=row.tenant_id,
        site_id=row.site_id,
        sector_id=row.sector_id,
        rule_type=row.rule_type,
        name=row.name,
        description=row.description,
        threshold_value=float(row.threshold_value),
        threshold_unit=row.threshold_unit,
        enabled=row.enabled,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_alert_rules(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: Optional[uuid.UUID] = None,
) -> SiteAlertRuleListResponse:
    """List alert rules for a site, optionally filtered by sector."""
    conditions = ["tenant_id = :tenant_id", "site_id = :site_id"]
    params: dict = {"tenant_id": str(tenant_id), "site_id": str(site_id)}

    if sector_id:
        conditions.append("sector_id = :sector_id")
        params["sector_id"] = str(sector_id)

    where_clause = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT id, tenant_id, site_id, sector_id, rule_type, name, description,
                   threshold_value, threshold_unit, enabled, created_at, updated_at
            FROM site_alert_rules
            WHERE {where_clause}
            ORDER BY created_at DESC
        """),
        params,
    )
    rows = result.fetchall()

    items = [
        SiteAlertRuleResponse(
            id=row.id,
            tenant_id=row.tenant_id,
            site_id=row.site_id,
            sector_id=row.sector_id,
            rule_type=row.rule_type,
            name=row.name,
            description=row.description,
            threshold_value=float(row.threshold_value),
            threshold_unit=row.threshold_unit,
            enabled=row.enabled,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]

    return SiteAlertRuleListResponse(items=items, total=len(items))


async def get_alert_rule(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    rule_id: uuid.UUID,
) -> Optional[SiteAlertRuleResponse]:
    """Fetch a single alert rule by ID."""
    result = await db.execute(
        text("""
            SELECT id, tenant_id, site_id, sector_id, rule_type, name, description,
                   threshold_value, threshold_unit, enabled, created_at, updated_at
            FROM site_alert_rules
            WHERE id = :rule_id AND tenant_id = :tenant_id AND site_id = :site_id
        """),
        {
            "rule_id": str(rule_id),
            "tenant_id": str(tenant_id),
            "site_id": str(site_id),
        },
    )
    row = result.fetchone()
    if not row:
        return None

    return SiteAlertRuleResponse(
        id=row.id,
        tenant_id=row.tenant_id,
        site_id=row.site_id,
        sector_id=row.sector_id,
        rule_type=row.rule_type,
        name=row.name,
        description=row.description,
        threshold_value=float(row.threshold_value),
        threshold_unit=row.threshold_unit,
        enabled=row.enabled,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def update_alert_rule(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    rule_id: uuid.UUID,
    data: SiteAlertRuleUpdate,
) -> Optional[SiteAlertRuleResponse]:
    """Update an existing alert rule. Only updates provided fields."""
    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        return await get_alert_rule(db, tenant_id, site_id, rule_id)

    set_clauses = []
    params: dict = {
        "rule_id": str(rule_id),
        "tenant_id": str(tenant_id),
        "site_id": str(site_id),
    }

    for field, value in update_data.items():
        if field == "sector_id" and value is not None:
            params[field] = str(value)
        else:
            params[field] = value
        set_clauses.append(f"{field} = :{field}")

    set_clauses.append("updated_at = now()")
    set_clause = ", ".join(set_clauses)

    result = await db.execute(
        text(f"""
            UPDATE site_alert_rules
            SET {set_clause}
            WHERE id = :rule_id AND tenant_id = :tenant_id AND site_id = :site_id
            RETURNING id, tenant_id, site_id, sector_id, rule_type, name, description,
                      threshold_value, threshold_unit, enabled, created_at, updated_at
        """),
        params,
    )
    row = result.fetchone()
    if not row:
        return None

    return SiteAlertRuleResponse(
        id=row.id,
        tenant_id=row.tenant_id,
        site_id=row.site_id,
        sector_id=row.sector_id,
        rule_type=row.rule_type,
        name=row.name,
        description=row.description,
        threshold_value=float(row.threshold_value),
        threshold_unit=row.threshold_unit,
        enabled=row.enabled,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def delete_alert_rule(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    rule_id: uuid.UUID,
) -> bool:
    """Delete an alert rule. Returns True if deleted, False if not found."""
    result = await db.execute(
        text("""
            DELETE FROM site_alert_rules
            WHERE id = :rule_id AND tenant_id = :tenant_id AND site_id = :site_id
        """),
        {
            "rule_id": str(rule_id),
            "tenant_id": str(tenant_id),
            "site_id": str(site_id),
        },
    )
    return result.rowcount > 0


# ---------------------------------------------------------------------------
# Alert Events
# ---------------------------------------------------------------------------


async def list_alert_events(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    state: Optional[str] = None,
    limit: int = 50,
) -> SiteAlertEventListResponse:
    """List alert events for a site, optionally filtered by state."""
    conditions = ["tenant_id = :tenant_id", "site_id = :site_id"]
    params: dict = {
        "tenant_id": str(tenant_id),
        "site_id": str(site_id),
        "limit": limit,
    }

    if state:
        conditions.append("state = :state")
        params["state"] = state

    where_clause = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT id, tenant_id, site_id, sector_id, rule_id, device_id, link_id,
                   severity, message, state, consecutive_hits,
                   triggered_at, resolved_at, resolved_by
            FROM site_alert_events
            WHERE {where_clause}
            ORDER BY triggered_at DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()

    items = [
        SiteAlertEventResponse(
            id=row.id,
            tenant_id=row.tenant_id,
            site_id=row.site_id,
            sector_id=row.sector_id,
            rule_id=row.rule_id,
            device_id=row.device_id,
            link_id=row.link_id,
            severity=row.severity,
            message=row.message,
            state=row.state,
            consecutive_hits=row.consecutive_hits,
            triggered_at=row.triggered_at,
            resolved_at=row.resolved_at,
            resolved_by=row.resolved_by,
        )
        for row in rows
    ]

    return SiteAlertEventListResponse(items=items, total=len(items))


async def resolve_alert_event(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    event_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Optional[SiteAlertEventResponse]:
    """Resolve an active alert event. Returns None if not found."""
    result = await db.execute(
        text("""
            UPDATE site_alert_events
            SET state = 'resolved', resolved_at = now(), resolved_by = :user_id
            WHERE id = :event_id AND tenant_id = :tenant_id AND state = 'active'
            RETURNING id, tenant_id, site_id, sector_id, rule_id, device_id, link_id,
                      severity, message, state, consecutive_hits,
                      triggered_at, resolved_at, resolved_by
        """),
        {
            "event_id": str(event_id),
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
        },
    )
    row = result.fetchone()
    if not row:
        return None

    return SiteAlertEventResponse(
        id=row.id,
        tenant_id=row.tenant_id,
        site_id=row.site_id,
        sector_id=row.sector_id,
        rule_id=row.rule_id,
        device_id=row.device_id,
        link_id=row.link_id,
        severity=row.severity,
        message=row.message,
        state=row.state,
        consecutive_hits=row.consecutive_hits,
        triggered_at=row.triggered_at,
        resolved_at=row.resolved_at,
        resolved_by=row.resolved_by,
    )


async def get_active_event_count(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> int:
    """Count active site alert events for a tenant (notification bell badge)."""
    result = await db.execute(
        text("""
            SELECT count(*) AS cnt
            FROM site_alert_events
            WHERE tenant_id = :tenant_id AND state = 'active'
        """),
        {"tenant_id": str(tenant_id)},
    )
    row = result.fetchone()
    return row.cnt if row else 0
