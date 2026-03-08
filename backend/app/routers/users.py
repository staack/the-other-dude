"""
User management endpoints (scoped to tenant).

GET    /api/tenants/{tenant_id}/users       — list users in tenant
POST   /api/tenants/{tenant_id}/users       — create user in tenant
GET    /api/tenants/{tenant_id}/users/{id}  — get user detail
PUT    /api/tenants/{tenant_id}/users/{id}  — update user
DELETE /api/tenants/{tenant_id}/users/{id}  — deactivate user
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.rate_limit import limiter

from app.database import get_admin_db
from app.middleware.rbac import require_tenant_admin_or_above
from app.middleware.tenant_context import CurrentUser
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.services.auth import hash_password

router = APIRouter(prefix="/tenants", tags=["users"])


async def _check_tenant_access(
    tenant_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession,
) -> Tenant:
    """
    Verify the tenant exists and the current user has access to it.

    super_admin can access any tenant.
    tenant_admin can only access their own tenant.
    """
    if not current_user.is_super_admin and current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant",
        )

    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    return tenant


@router.get("/{tenant_id}/users", response_model=list[UserResponse], summary="List users in tenant")
async def list_users(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_tenant_admin_or_above),
    db: AsyncSession = Depends(get_admin_db),
) -> list[UserResponse]:
    """
    List users in a tenant.
    - super_admin: can list users in any tenant
    - tenant_admin: can only list users in their own tenant
    """
    await _check_tenant_access(tenant_id, current_user, db)

    result = await db.execute(
        select(User)
        .where(User.tenant_id == tenant_id)
        .order_by(User.name)
    )
    users = result.scalars().all()

    return [UserResponse.model_validate(user) for user in users]


@router.post(
    "/{tenant_id}/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user in tenant",
)
@limiter.limit("20/minute")
async def create_user(
    request: Request,
    tenant_id: uuid.UUID,
    data: UserCreate,
    current_user: CurrentUser = Depends(require_tenant_admin_or_above),
    db: AsyncSession = Depends(get_admin_db),
) -> UserResponse:
    """
    Create a user within a tenant.

    - super_admin: can create users in any tenant
    - tenant_admin: can only create users in their own tenant
    - No email invitation flow — admin creates accounts with temporary passwords
    """
    await _check_tenant_access(tenant_id, current_user, db)

    # Check email uniqueness (global, not per-tenant)
    existing = await db.execute(
        select(User).where(User.email == data.email.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    user = User(
        email=data.email.lower(),
        hashed_password=hash_password(data.password),
        name=data.name,
        role=data.role.value,
        tenant_id=tenant_id,
        is_active=True,
        must_upgrade_auth=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return UserResponse.model_validate(user)


@router.get("/{tenant_id}/users/{user_id}", response_model=UserResponse, summary="Get user detail")
async def get_user(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_tenant_admin_or_above),
    db: AsyncSession = Depends(get_admin_db),
) -> UserResponse:
    """Get user detail."""
    await _check_tenant_access(tenant_id, current_user, db)

    result = await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse.model_validate(user)


@router.put("/{tenant_id}/users/{user_id}", response_model=UserResponse, summary="Update a user")
@limiter.limit("20/minute")
async def update_user(
    request: Request,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    data: UserUpdate,
    current_user: CurrentUser = Depends(require_tenant_admin_or_above),
    db: AsyncSession = Depends(get_admin_db),
) -> UserResponse:
    """
    Update user attributes (name, role, is_active).
    Role assignment is editable by admins.
    """
    await _check_tenant_access(tenant_id, current_user, db)

    result = await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if data.name is not None:
        user.name = data.name

    if data.role is not None:
        user.role = data.role.value

    if data.is_active is not None:
        user.is_active = data.is_active

    await db.commit()
    await db.refresh(user)

    return UserResponse.model_validate(user)


@router.delete("/{tenant_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Deactivate a user")
@limiter.limit("5/minute")
async def deactivate_user(
    request: Request,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_tenant_admin_or_above),
    db: AsyncSession = Depends(get_admin_db),
) -> None:
    """
    Deactivate a user (soft delete — sets is_active=False).
    This preserves audit trail while preventing login.
    """
    await _check_tenant_access(tenant_id, current_user, db)

    result = await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Prevent self-deactivation
    if user.id == current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account",
        )

    user.is_active = False
    await db.commit()
