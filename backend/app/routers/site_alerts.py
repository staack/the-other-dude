"""
Site alert rules and events API endpoints.

Routes:
  /api/tenants/{tenant_id}/sites/{site_id}/alert-rules (CRUD)
  /api/tenants/{tenant_id}/sites/{site_id}/alert-events (list)
  /api/tenants/{tenant_id}/alert-events/{event_id}/resolve (resolve)
  /api/tenants/{tenant_id}/alert-events/count (active count for bell badge)

RBAC:
- viewer: GET endpoints (read-only)
- operator: POST, PUT, DELETE, resolve (write)
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import require_operator_or_above
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.site_alert import (
    SiteAlertEventListResponse,
    SiteAlertEventResponse,
    SiteAlertRuleCreate,
    SiteAlertRuleListResponse,
    SiteAlertRuleResponse,
    SiteAlertRuleUpdate,
)
from app.services import site_alert_service

router = APIRouter(tags=["site-alerts"])


# ---------------------------------------------------------------------------
# Alert Rules CRUD
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/sites/{site_id}/alert-rules",
    response_model=SiteAlertRuleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a site alert rule",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_alert_rule(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    data: SiteAlertRuleCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteAlertRuleResponse:
    """Create a new site/sector alert rule. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await site_alert_service.create_alert_rule(
        db=db, tenant_id=tenant_id, site_id=site_id, data=data
    )


@router.get(
    "/tenants/{tenant_id}/sites/{site_id}/alert-rules",
    response_model=SiteAlertRuleListResponse,
    summary="List site alert rules",
)
async def list_alert_rules(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    sector_id: Optional[uuid.UUID] = Query(None, description="Filter by sector"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteAlertRuleListResponse:
    """List alert rules for a site, optionally filtered by sector. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await site_alert_service.list_alert_rules(
        db=db, tenant_id=tenant_id, site_id=site_id, sector_id=sector_id
    )


@router.get(
    "/tenants/{tenant_id}/sites/{site_id}/alert-rules/{rule_id}",
    response_model=SiteAlertRuleResponse,
    summary="Get a site alert rule",
)
async def get_alert_rule(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    rule_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteAlertRuleResponse:
    """Get a single site alert rule by ID. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    result = await site_alert_service.get_alert_rule(
        db=db, tenant_id=tenant_id, site_id=site_id, rule_id=rule_id
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert rule not found"
        )
    return result


@router.put(
    "/tenants/{tenant_id}/sites/{site_id}/alert-rules/{rule_id}",
    response_model=SiteAlertRuleResponse,
    summary="Update a site alert rule",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_alert_rule(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    rule_id: uuid.UUID,
    data: SiteAlertRuleUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteAlertRuleResponse:
    """Update a site alert rule. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    result = await site_alert_service.update_alert_rule(
        db=db, tenant_id=tenant_id, site_id=site_id, rule_id=rule_id, data=data
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert rule not found"
        )
    return result


@router.delete(
    "/tenants/{tenant_id}/sites/{site_id}/alert-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a site alert rule",
    dependencies=[Depends(require_operator_or_above)],
)
async def delete_alert_rule(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    rule_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a site alert rule. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    deleted = await site_alert_service.delete_alert_rule(
        db=db, tenant_id=tenant_id, site_id=site_id, rule_id=rule_id
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert rule not found"
        )


# ---------------------------------------------------------------------------
# Alert Events
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/sites/{site_id}/alert-events",
    response_model=SiteAlertEventListResponse,
    summary="List site alert events",
)
async def list_alert_events(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    state: Optional[str] = Query(None, description="Filter by state (active, resolved)"),
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteAlertEventListResponse:
    """List alert events for a site. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    return await site_alert_service.list_alert_events(
        db=db, tenant_id=tenant_id, site_id=site_id, state=state, limit=limit
    )


@router.post(
    "/tenants/{tenant_id}/alert-events/{event_id}/resolve",
    response_model=SiteAlertEventResponse,
    summary="Resolve a site alert event",
    dependencies=[Depends(require_operator_or_above)],
)
async def resolve_alert_event(
    tenant_id: uuid.UUID,
    event_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteAlertEventResponse:
    """Resolve an active alert event. Requires operator role or above."""
    await _check_tenant_access(current_user, tenant_id, db)
    result = await site_alert_service.resolve_alert_event(
        db=db, tenant_id=tenant_id, event_id=event_id, user_id=current_user.user_id
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert event not found or already resolved",
        )
    return result


@router.get(
    "/tenants/{tenant_id}/alert-events/count",
    summary="Get active alert event count",
)
async def get_active_event_count(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get count of active site alert events for notification bell badge. Viewer role and above."""
    await _check_tenant_access(current_user, tenant_id, db)
    count = await site_alert_service.get_active_event_count(db=db, tenant_id=tenant_id)
    return {"count": count}
