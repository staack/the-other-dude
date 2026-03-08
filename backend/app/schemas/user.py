"""User request/response schemas."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.models.user import UserRole


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.VIEWER

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: UserRole) -> UserRole:
        """Tenant admins can only create operator/viewer roles; super_admin via separate flow."""
        allowed_tenant_roles = {UserRole.TENANT_ADMIN, UserRole.OPERATOR, UserRole.VIEWER}
        if v not in allowed_tenant_roles:
            raise ValueError(
                f"Role must be one of: {', '.join(r.value for r in allowed_tenant_roles)}"
            )
        return v


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    tenant_id: Optional[uuid.UUID] = None
    is_active: bool
    last_login: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
