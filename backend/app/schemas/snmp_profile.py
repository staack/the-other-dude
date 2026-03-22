"""Pydantic schemas for SNMP Profile CRUD endpoints."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


VALID_CATEGORIES = {"switch", "router", "access_point", "ups", "printer", "server", "generic"}


class SNMPProfileCreate(BaseModel):
    """Schema for creating a tenant-scoped SNMP profile."""

    name: str
    description: Optional[str] = None
    sys_object_id: Optional[str] = None
    vendor: Optional[str] = None
    category: Optional[str] = None
    profile_data: dict

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Profile name must be 1-255 characters")
        return v

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")
        return v


class SNMPProfileUpdate(BaseModel):
    """Schema for updating an SNMP profile. All fields optional."""

    name: Optional[str] = None
    description: Optional[str] = None
    sys_object_id: Optional[str] = None
    vendor: Optional[str] = None
    category: Optional[str] = None
    profile_data: Optional[dict] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Profile name must be 1-255 characters")
        return v

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")
        return v


class SNMPProfileResponse(BaseModel):
    """SNMP profile response (list view -- excludes large profile_data JSONB)."""

    id: uuid.UUID
    tenant_id: Optional[uuid.UUID] = None
    name: str
    description: Optional[str] = None
    sys_object_id: Optional[str] = None
    vendor: Optional[str] = None
    category: Optional[str] = None
    is_system: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SNMPProfileDetailResponse(SNMPProfileResponse):
    """SNMP profile detail response (includes full profile_data)."""

    profile_data: dict


class SNMPProfileListResponse(BaseModel):
    """List of SNMP profiles."""

    profiles: list[SNMPProfileResponse]


# ---------------------------------------------------------------------------
# MIB Parse schemas
# ---------------------------------------------------------------------------


class MIBParseResponse(BaseModel):
    """Response from MIB file parsing."""

    module_name: str
    nodes: list[dict]  # OIDNode tree from tod-mib-parser
    node_count: int


class MIBParseErrorResponse(BaseModel):
    """Error response when MIB parsing fails."""

    error: str


# ---------------------------------------------------------------------------
# Profile Test schemas
# ---------------------------------------------------------------------------


class ProfileTestRequest(BaseModel):
    """Request to test a profile's OIDs against a live device."""

    ip_address: str
    snmp_port: int = 161
    snmp_version: str  # "v1", "v2c", "v3"
    # v1/v2c
    community: Optional[str] = None
    # v3
    security_level: Optional[str] = None
    username: Optional[str] = None
    auth_protocol: Optional[str] = None
    auth_passphrase: Optional[str] = None
    priv_protocol: Optional[str] = None
    priv_passphrase: Optional[str] = None

    @field_validator("snmp_version")
    @classmethod
    def validate_version(cls, v: str) -> str:
        if v not in ("v1", "v2c", "v3"):
            raise ValueError("snmp_version must be v1, v2c, or v3")
        return v


class ProfileTestOIDResult(BaseModel):
    """Result of polling a single OID against a live device."""

    oid: str
    name: str
    value: Optional[str] = None
    error: Optional[str] = None


class ProfileTestResponse(BaseModel):
    """Response from testing a profile against a live device."""

    success: bool
    device_info: Optional[dict] = None  # sys_object_id, sys_descr, sys_name
    results: list[ProfileTestOIDResult] = []
    error: Optional[str] = None
