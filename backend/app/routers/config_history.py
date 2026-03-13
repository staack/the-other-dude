"""Config history timeline API endpoint.

Provides:
    - GET /tenants/{tenant_id}/devices/{device_id}/config-history
      Paginated timeline of config changes for a device.

RBAC: viewer+ can read. Scope: config:read.
"""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import require_min_role, require_scope
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.services.config_history_service import get_config_history

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config-history"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant.

    - super_admin can access any tenant -- re-sets DB tenant context to target tenant.
    - All other roles must match their own tenant_id.
    """
    if current_user.is_super_admin:
        from app.database import set_tenant_context
        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/devices/{device_id}/config-history",
    summary="Get config change timeline for a device",
    dependencies=[require_scope("config:read")],
)
async def list_config_history(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return paginated config change timeline for a device, newest first.

    Each entry includes: id, component, summary, created_at,
    diff_id, lines_added, lines_removed, snapshot_id.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    return await get_config_history(
        device_id=str(device_id),
        tenant_id=str(tenant_id),
        session=db,
        limit=limit,
        offset=offset,
    )
