"""
Role-Based Access Control (RBAC) middleware.

Provides dependency factories for enforcing role-based access control
on FastAPI routes. Roles are hierarchical:

  super_admin > tenant_admin > operator > viewer

Role permissions per plan TENANT-04/05/06:
  - viewer: GET endpoints only (read-only)
  - operator: GET + device/config management endpoints
  - tenant_admin: full access within their tenant
  - super_admin: full access across all tenants
"""

from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.params import Depends as DependsClass

from app.middleware.tenant_context import CurrentUser, get_current_user

# Role hierarchy (higher index = more privilege)
# api_key is at operator level for RBAC checks; fine-grained access controlled by scopes.
ROLE_HIERARCHY = {
    "viewer": 0,
    "api_key": 1,
    "operator": 1,
    "tenant_admin": 2,
    "super_admin": 3,
}


def _get_role_level(role: str) -> int:
    """Return numeric privilege level for a role string."""
    return ROLE_HIERARCHY.get(role, -1)


def require_role(*allowed_roles: str) -> Callable:
    """
    FastAPI dependency factory that checks the current user's role.

    Usage:
        @router.post("/items", dependencies=[Depends(require_role("tenant_admin", "super_admin"))])

    Args:
        *allowed_roles: Role strings that are permitted to access the endpoint

    Returns:
        FastAPI dependency that raises 403 if the role is insufficient
    """

    async def dependency(
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}. "
                f"Your role: {current_user.role}",
            )
        return current_user

    return dependency


def require_min_role(min_role: str) -> Callable:
    """
    Dependency factory that allows any role at or above the minimum level.

    Usage:
        @router.get("/items", dependencies=[Depends(require_min_role("operator"))])
        # Allows: operator, tenant_admin, super_admin
        # Denies: viewer
    """
    min_level = _get_role_level(min_role)

    async def dependency(
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        user_level = _get_role_level(current_user.role)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Minimum required role: {min_role}. "
                f"Your role: {current_user.role}",
            )
        return current_user

    return dependency


def require_write_access() -> Callable:
    """
    Dependency that enforces viewer read-only restriction.

    Viewers are NOT allowed on POST/PUT/PATCH/DELETE endpoints.
    Call this on any mutating endpoint to deny viewers.
    """

    async def dependency(
        request: Request,
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if current_user.role == "viewer":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Viewers have read-only access. "
                    "Contact your administrator to request elevated permissions.",
                )
        return current_user

    return dependency


def require_scope(scope: str) -> DependsClass:
    """FastAPI dependency that checks API key scopes.

    No-op for regular users (JWT auth) -- scopes only apply to API keys.
    For API key users: checks that the required scope is in the key's scope list.

    Returns a Depends() instance so it can be used in dependency lists:
        @router.get("/items", dependencies=[require_scope("devices:read")])

    Args:
        scope: Required scope string (e.g. "devices:read", "config:write").

    Raises:
        HTTPException 403 if the API key is missing the required scope.
    """

    async def _check_scope(
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if current_user.role == "api_key":
            if not current_user.scopes or scope not in current_user.scopes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"API key missing required scope: {scope}",
                )
        return current_user

    return Depends(_check_scope)


# Pre-built convenience dependencies


async def require_super_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Require super_admin role (portal-wide admin)."""
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Super admin role required.",
        )
    return current_user


async def require_tenant_admin_or_above(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Require tenant_admin or super_admin role."""
    if current_user.role not in ("tenant_admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Tenant admin or higher role required.",
        )
    return current_user


async def require_operator_or_above(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Require operator, tenant_admin, or super_admin role."""
    if current_user.role not in ("operator", "tenant_admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Operator or higher role required.",
        )
    return current_user


async def require_authenticated(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Require any authenticated user (viewer and above)."""
    return current_user
