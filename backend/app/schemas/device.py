"""Pydantic schemas for Device, DeviceGroup, and DeviceTag endpoints."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Device schemas
# ---------------------------------------------------------------------------


class DeviceCreate(BaseModel):
    """Schema for creating a new device."""

    hostname: str
    ip_address: str
    api_port: int = 8728
    api_ssl_port: int = 8729
    username: str
    password: str


class DeviceUpdate(BaseModel):
    """Schema for updating an existing device. All fields optional."""

    hostname: Optional[str] = None
    ip_address: Optional[str] = None
    api_port: Optional[int] = None
    api_ssl_port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    tls_mode: Optional[str] = None

    @field_validator("tls_mode")
    @classmethod
    def validate_tls_mode(cls, v: Optional[str]) -> Optional[str]:
        """Validate tls_mode is one of the allowed values."""
        if v is None:
            return v
        allowed = {"auto", "insecure", "plain", "portal_ca"}
        if v not in allowed:
            raise ValueError(f"tls_mode must be one of: {', '.join(sorted(allowed))}")
        return v


class DeviceTagRef(BaseModel):
    """Minimal tag info embedded in device responses."""

    id: uuid.UUID
    name: str
    color: Optional[str] = None

    model_config = {"from_attributes": True}


class DeviceGroupRef(BaseModel):
    """Minimal group info embedded in device responses."""

    id: uuid.UUID
    name: str

    model_config = {"from_attributes": True}


class DeviceResponse(BaseModel):
    """Device response schema. NEVER includes credential fields."""

    id: uuid.UUID
    hostname: str
    ip_address: str
    api_port: int
    api_ssl_port: int
    model: Optional[str] = None
    serial_number: Optional[str] = None
    firmware_version: Optional[str] = None
    routeros_version: Optional[str] = None
    routeros_major_version: Optional[int] = None
    uptime_seconds: Optional[int] = None
    last_seen: Optional[datetime] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str
    tls_mode: str = "auto"
    tags: list[DeviceTagRef] = []
    groups: list[DeviceGroupRef] = []
    site_id: Optional[uuid.UUID] = None
    site_name: Optional[str] = None
    sector_id: Optional[uuid.UUID] = None
    sector_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DeviceListResponse(BaseModel):
    """Paginated device list response."""

    items: list[DeviceResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Subnet scan schemas
# ---------------------------------------------------------------------------


class SubnetScanRequest(BaseModel):
    """Request body for a subnet scan."""

    cidr: str

    @field_validator("cidr")
    @classmethod
    def validate_cidr(cls, v: str) -> str:
        """Validate that the value is a valid CIDR notation and RFC 1918 private range."""
        import ipaddress

        try:
            network = ipaddress.ip_network(v, strict=False)
        except ValueError as e:
            raise ValueError(f"Invalid CIDR notation: {e}") from e
        # Only allow private IP ranges (RFC 1918: 10/8, 172.16/12, 192.168/16)
        if not network.is_private:
            raise ValueError(
                "Only private IP ranges can be scanned (RFC 1918: "
                "10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)"
            )
        # Reject ranges larger than /20 (4096 IPs) to prevent abuse
        if network.num_addresses > 4096:
            raise ValueError(
                f"CIDR range too large ({network.num_addresses} addresses). "
                "Maximum allowed: /20 (4096 addresses)."
            )
        return v


class SubnetScanResult(BaseModel):
    """A single discovered host from a subnet scan."""

    ip_address: str
    hostname: Optional[str] = None
    api_port_open: bool = False
    api_ssl_port_open: bool = False


class SubnetScanResponse(BaseModel):
    """Response for a subnet scan operation."""

    cidr: str
    discovered: list[SubnetScanResult]
    total_scanned: int
    total_discovered: int


# ---------------------------------------------------------------------------
# Bulk add from scan
# ---------------------------------------------------------------------------


class BulkDeviceAdd(BaseModel):
    """One device entry within a bulk-add request."""

    ip_address: str
    hostname: Optional[str] = None
    api_port: int = 8728
    api_ssl_port: int = 8729
    username: Optional[str] = None
    password: Optional[str] = None


class BulkAddRequest(BaseModel):
    """
    Bulk-add devices selected from a scan result.

    shared_username / shared_password are used for all devices that do not
    provide their own credentials.
    """

    devices: list[BulkDeviceAdd]
    shared_username: Optional[str] = None
    shared_password: Optional[str] = None


class BulkAddResult(BaseModel):
    """Summary result of a bulk-add operation."""

    added: list[DeviceResponse]
    failed: list[dict]  # {ip_address, error}


# ---------------------------------------------------------------------------
# DeviceGroup schemas
# ---------------------------------------------------------------------------


class DeviceGroupCreate(BaseModel):
    """Schema for creating a device group."""

    name: str
    description: Optional[str] = None


class DeviceGroupUpdate(BaseModel):
    """Schema for updating a device group."""

    name: Optional[str] = None
    description: Optional[str] = None


class DeviceGroupResponse(BaseModel):
    """Device group response schema."""

    id: uuid.UUID
    name: str
    description: Optional[str] = None
    device_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# DeviceTag schemas
# ---------------------------------------------------------------------------


class DeviceTagCreate(BaseModel):
    """Schema for creating a device tag."""

    name: str
    color: Optional[str] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        """Validate hex color format if provided."""
        if v is None:
            return v
        import re

        if not re.match(r"^#[0-9A-Fa-f]{6}$", v):
            raise ValueError("Color must be a valid 6-digit hex color (e.g. #FF5733)")
        return v


class DeviceTagUpdate(BaseModel):
    """Schema for updating a device tag."""

    name: Optional[str] = None
    color: Optional[str] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        import re

        if not re.match(r"^#[0-9A-Fa-f]{6}$", v):
            raise ValueError("Color must be a valid 6-digit hex color (e.g. #FF5733)")
        return v


class DeviceTagResponse(BaseModel):
    """Device tag response schema."""

    id: uuid.UUID
    name: str
    color: Optional[str] = None

    model_config = {"from_attributes": True}
