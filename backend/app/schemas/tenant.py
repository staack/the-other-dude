"""Tenant request/response schemas."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class TenantCreate(BaseModel):
    name: str
    description: Optional[str] = None
    contact_email: Optional[str] = None


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contact_email: Optional[str] = None


class TenantResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    contact_email: Optional[str] = None
    user_count: int = 0
    device_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}
