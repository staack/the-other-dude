"""Pydantic schemas for Site endpoints."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class SiteCreate(BaseModel):
    """Schema for creating a new site."""

    name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    elevation: Optional[float] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Site name must be 1-255 characters")
        return v


class SiteUpdate(BaseModel):
    """Schema for updating an existing site. All fields optional."""

    name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    elevation: Optional[float] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Site name must be 1-255 characters")
        return v


class SiteResponse(BaseModel):
    """Site response schema with health rollup stats."""

    id: uuid.UUID
    name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    elevation: Optional[float] = None
    notes: Optional[str] = None
    device_count: int = 0
    online_count: int = 0
    online_percent: float = 0.0
    alert_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SiteListResponse(BaseModel):
    """List of sites with unassigned device count."""

    sites: list[SiteResponse]
    unassigned_count: int
