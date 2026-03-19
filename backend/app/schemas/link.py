"""Pydantic schemas for Link and Unknown Client endpoints."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class LinkResponse(BaseModel):
    """Single wireless link between an AP and CPE device."""

    id: uuid.UUID
    ap_device_id: uuid.UUID
    cpe_device_id: uuid.UUID
    ap_hostname: str | None = None
    cpe_hostname: str | None = None
    interface: str | None = None
    client_mac: str
    signal_strength: int | None = None
    tx_ccq: int | None = None
    tx_rate: str | None = None
    rx_rate: str | None = None
    state: str
    missed_polls: int
    discovered_at: datetime
    last_seen: datetime

    model_config = ConfigDict(from_attributes=True)


class LinkListResponse(BaseModel):
    """List of wireless links with total count."""

    items: list[LinkResponse]
    total: int


class UnknownClientResponse(BaseModel):
    """A wireless client whose MAC does not resolve to any known device interface."""

    mac_address: str
    interface: str | None = None
    signal_strength: int | None = None
    tx_rate: str | None = None
    rx_rate: str | None = None
    last_seen: datetime

    model_config = ConfigDict(from_attributes=True)


class UnknownClientListResponse(BaseModel):
    """List of unknown clients with total count."""

    items: list[UnknownClientResponse]
    total: int


class RegistrationResponse(BaseModel):
    """A single wireless registration entry for a device."""

    mac_address: str
    interface: str | None = None
    signal_strength: int | None = None
    tx_ccq: int | None = None
    tx_rate: str | None = None
    rx_rate: str | None = None
    distance: int | None = None
    uptime: str | None = None
    last_seen: datetime
    hostname: str | None = None
    device_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


class RegistrationListResponse(BaseModel):
    """List of wireless registrations with total count."""

    items: list[RegistrationResponse]
    total: int


class RFStatsResponse(BaseModel):
    """RF monitor stats for a single interface."""

    interface: str
    noise_floor: int | None = None
    channel_width: int | None = None
    tx_power: int | None = None
    registered_clients: int | None = None
    last_seen: datetime

    model_config = ConfigDict(from_attributes=True)


class RFStatsListResponse(BaseModel):
    """List of RF stats with total count."""

    items: list[RFStatsResponse]
    total: int
