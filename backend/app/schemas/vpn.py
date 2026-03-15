"""Pydantic schemas for WireGuard VPN management."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# ── VPN Config (server-side) ──


class VpnSetupRequest(BaseModel):
    """Request to enable VPN for a tenant."""

    endpoint: Optional[str] = (
        None  # public hostname:port — if blank, devices must be configured manually
    )


class VpnConfigResponse(BaseModel):
    """VPN server configuration (never exposes private key)."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    tenant_id: uuid.UUID
    server_public_key: str
    subnet: str
    server_port: int
    server_address: str
    endpoint: Optional[str]
    is_enabled: bool
    peer_count: int = 0
    created_at: datetime


class VpnConfigUpdate(BaseModel):
    """Update VPN configuration."""

    endpoint: Optional[str] = None
    is_enabled: Optional[bool] = None


# ── VPN Peers ──


class VpnPeerCreate(BaseModel):
    """Add a device as a VPN peer."""

    device_id: uuid.UUID
    additional_allowed_ips: Optional[str] = None  # comma-separated subnets for site-to-site routing


class VpnPeerResponse(BaseModel):
    """VPN peer info (never exposes private key)."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    device_id: uuid.UUID
    device_hostname: str = ""
    device_ip: str = ""
    peer_public_key: str
    assigned_ip: str
    is_enabled: bool
    last_handshake: Optional[datetime]
    created_at: datetime


# ── VPN Onboarding (combined device + peer creation) ──


class VpnOnboardRequest(BaseModel):
    """Combined device creation + VPN peer onboarding."""

    hostname: str
    username: str
    password: str


class VpnOnboardResponse(BaseModel):
    """Response from onboarding — device, peer, and RouterOS commands."""

    device_id: uuid.UUID
    peer_id: uuid.UUID
    hostname: str
    assigned_ip: str
    routeros_commands: list[str]


class VpnPeerConfig(BaseModel):
    """Full peer config for display/export — includes private key for device setup."""

    peer_private_key: str
    peer_public_key: str
    assigned_ip: str
    server_public_key: str
    server_endpoint: str
    allowed_ips: str
    routeros_commands: list[str]
