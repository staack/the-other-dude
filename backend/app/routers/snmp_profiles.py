"""
SNMP Profile CRUD API endpoints.

Routes: /api/tenants/{tenant_id}/snmp-profiles

Provides listing, creation, update, and deletion of SNMP device profiles.
System-shipped profiles (is_system=True, tenant_id IS NULL) are visible to
all tenants but cannot be modified or deleted.

RBAC:
- devices:read scope: GET (list, detail)
- operator+: POST, PUT (create, update tenant profiles)
- tenant_admin+: DELETE (delete tenant profiles)
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import require_operator_or_above, require_scope, require_tenant_admin_or_above
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.snmp_profile import (
    SNMPProfileCreate,
    SNMPProfileDetailResponse,
    SNMPProfileListResponse,
    SNMPProfileResponse,
    SNMPProfileUpdate,
)

router = APIRouter(tags=["snmp-profiles"])


# ---------------------------------------------------------------------------
# List profiles (system + tenant)
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/snmp-profiles",
    response_model=SNMPProfileListResponse,
    summary="List SNMP profiles (system + tenant)",
    dependencies=[require_scope("devices:read")],
)
async def list_profiles(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SNMPProfileListResponse:
    """List all SNMP profiles visible to a tenant.

    Returns both system-shipped profiles (tenant_id IS NULL) and
    tenant-specific custom profiles. System profiles appear first.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT id, tenant_id, name, description, sys_object_id, vendor,
                   category, is_system, created_at, updated_at
            FROM snmp_profiles
            WHERE tenant_id = :tenant_id OR tenant_id IS NULL
            ORDER BY is_system DESC, name ASC
        """),
        {"tenant_id": str(tenant_id)},
    )
    rows = result.mappings().all()
    return SNMPProfileListResponse(profiles=[dict(row) for row in rows])


# ---------------------------------------------------------------------------
# Get profile detail (includes profile_data)
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/snmp-profiles/{profile_id}",
    response_model=SNMPProfileDetailResponse,
    summary="Get SNMP profile detail",
    dependencies=[require_scope("devices:read")],
)
async def get_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get a single SNMP profile with full profile_data JSONB."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT id, tenant_id, name, description, sys_object_id, vendor,
                   category, profile_data, is_system, created_at, updated_at
            FROM snmp_profiles
            WHERE id = :profile_id
              AND (tenant_id = :tenant_id OR tenant_id IS NULL)
        """),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SNMP profile not found")
    return dict(row)


# ---------------------------------------------------------------------------
# Create profile
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/snmp-profiles",
    response_model=SNMPProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a tenant SNMP profile",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_profile(
    tenant_id: uuid.UUID,
    data: SNMPProfileCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Create a new tenant-scoped SNMP profile (is_system=False)."""
    await _check_tenant_access(current_user, tenant_id, db)

    import json

    result = await db.execute(
        text("""
            INSERT INTO snmp_profiles
                (tenant_id, name, description, sys_object_id, vendor,
                 category, profile_data, is_system)
            VALUES
                (:tenant_id, :name, :description, :sys_object_id, :vendor,
                 :category, :profile_data::jsonb, FALSE)
            RETURNING id, tenant_id, name, description, sys_object_id, vendor,
                      category, is_system, created_at, updated_at
        """),
        {
            "tenant_id": str(tenant_id),
            "name": data.name,
            "description": data.description,
            "sys_object_id": data.sys_object_id,
            "vendor": data.vendor,
            "category": data.category,
            "profile_data": json.dumps(data.profile_data),
        },
    )
    await db.commit()
    row = result.mappings().first()
    return dict(row)


# ---------------------------------------------------------------------------
# Update profile
# ---------------------------------------------------------------------------


@router.put(
    "/tenants/{tenant_id}/snmp-profiles/{profile_id}",
    response_model=SNMPProfileResponse,
    summary="Update a tenant SNMP profile",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    data: SNMPProfileUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Update an existing tenant-scoped SNMP profile.

    System profiles (is_system=True) cannot be modified -- returns 403.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Verify profile exists and is tenant-owned
    existing = await db.execute(
        text("""
            SELECT id, is_system
            FROM snmp_profiles
            WHERE id = :profile_id
              AND (tenant_id = :tenant_id OR tenant_id IS NULL)
        """),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SNMP profile not found")
    if row["is_system"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System profiles cannot be modified",
        )

    # Build dynamic SET clause from provided fields
    import json

    updates = {}
    set_clauses = []
    fields = data.model_dump(exclude_unset=True)

    for field, value in fields.items():
        if field == "profile_data" and value is not None:
            set_clauses.append(f"{field} = :{field}::jsonb")
            updates[field] = json.dumps(value)
        else:
            set_clauses.append(f"{field} = :{field}")
            updates[field] = value

    if not set_clauses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    set_clauses.append("updated_at = NOW()")
    updates["profile_id"] = str(profile_id)
    updates["tenant_id"] = str(tenant_id)

    sql = f"""
        UPDATE snmp_profiles
        SET {', '.join(set_clauses)}
        WHERE id = :profile_id AND tenant_id = :tenant_id
        RETURNING id, tenant_id, name, description, sys_object_id, vendor,
                  category, is_system, created_at, updated_at
    """

    result = await db.execute(text(sql), updates)
    await db.commit()
    row = result.mappings().first()
    return dict(row)


# ---------------------------------------------------------------------------
# Delete profile
# ---------------------------------------------------------------------------


@router.delete(
    "/tenants/{tenant_id}/snmp-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a tenant SNMP profile",
    dependencies=[Depends(require_tenant_admin_or_above)],
)
async def delete_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a tenant-scoped SNMP profile.

    System profiles (is_system=True) cannot be deleted -- returns 403.
    Profiles referenced by devices cannot be deleted -- returns 409.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Verify profile exists and is tenant-owned
    existing = await db.execute(
        text("""
            SELECT id, is_system
            FROM snmp_profiles
            WHERE id = :profile_id
              AND (tenant_id = :tenant_id OR tenant_id IS NULL)
        """),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SNMP profile not found")
    if row["is_system"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System profiles cannot be deleted",
        )

    # Check if any devices reference this profile
    ref_check = await db.execute(
        text("""
            SELECT COUNT(*) AS cnt
            FROM devices
            WHERE snmp_profile_id = :profile_id
        """),
        {"profile_id": str(profile_id)},
    )
    count = ref_check.scalar()
    if count and count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete profile: {count} device(s) still reference it",
        )

    await db.execute(
        text("DELETE FROM snmp_profiles WHERE id = :profile_id AND tenant_id = :tenant_id"),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    await db.commit()
