"""Pydantic schemas for Sector endpoints."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class SectorCreate(BaseModel):
    """Schema for creating a new sector."""

    name: str
    azimuth: Optional[float] = None
    description: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Sector name must be 1-255 characters")
        return v


class SectorUpdate(BaseModel):
    """Schema for updating an existing sector. All fields optional."""

    name: Optional[str] = None
    azimuth: Optional[float] = None
    description: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Sector name must be 1-255 characters")
        return v


class SectorResponse(BaseModel):
    """Sector response schema with device count."""

    id: uuid.UUID
    site_id: uuid.UUID
    name: str
    azimuth: Optional[float] = None
    description: Optional[str] = None
    device_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SectorListResponse(BaseModel):
    """List of sectors with total count."""

    items: list[SectorResponse]
    total: int
