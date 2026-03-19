"""Pydantic schemas for site alert rules, events, and signal history."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class SiteAlertRuleCreate(BaseModel):
    """Schema for creating a new site alert rule."""

    name: str
    rule_type: str
    threshold_value: float
    threshold_unit: str
    sector_id: Optional[uuid.UUID] = None
    description: Optional[str] = None
    enabled: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Rule name must be 1-255 characters")
        return v

    @field_validator("rule_type")
    @classmethod
    def validate_rule_type(cls, v: str) -> str:
        allowed = {
            "device_offline_percent",
            "device_offline_count",
            "sector_signal_avg",
            "sector_client_drop",
            "signal_degradation",
        }
        if v not in allowed:
            raise ValueError(f"rule_type must be one of: {', '.join(sorted(allowed))}")
        return v

    @field_validator("threshold_unit")
    @classmethod
    def validate_threshold_unit(cls, v: str) -> str:
        allowed = {"percent", "count", "dBm"}
        if v not in allowed:
            raise ValueError(f"threshold_unit must be one of: {', '.join(sorted(allowed))}")
        return v


class SiteAlertRuleUpdate(BaseModel):
    """Schema for updating an existing site alert rule. All fields optional."""

    name: Optional[str] = None
    rule_type: Optional[str] = None
    threshold_value: Optional[float] = None
    threshold_unit: Optional[str] = None
    sector_id: Optional[uuid.UUID] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) < 1 or len(v) > 255:
            raise ValueError("Rule name must be 1-255 characters")
        return v

    @field_validator("rule_type")
    @classmethod
    def validate_rule_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {
            "device_offline_percent",
            "device_offline_count",
            "sector_signal_avg",
            "sector_client_drop",
            "signal_degradation",
        }
        if v not in allowed:
            raise ValueError(f"rule_type must be one of: {', '.join(sorted(allowed))}")
        return v

    @field_validator("threshold_unit")
    @classmethod
    def validate_threshold_unit(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"percent", "count", "dBm"}
        if v not in allowed:
            raise ValueError(f"threshold_unit must be one of: {', '.join(sorted(allowed))}")
        return v


class SiteAlertRuleResponse(BaseModel):
    """Site alert rule response schema."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    site_id: uuid.UUID
    sector_id: Optional[uuid.UUID] = None
    rule_type: str
    name: str
    description: Optional[str] = None
    threshold_value: float
    threshold_unit: str
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SiteAlertRuleListResponse(BaseModel):
    """List of site alert rules with total count."""

    items: list[SiteAlertRuleResponse]
    total: int


class SiteAlertEventResponse(BaseModel):
    """Site alert event response schema."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    site_id: uuid.UUID
    sector_id: Optional[uuid.UUID] = None
    rule_id: Optional[uuid.UUID] = None
    device_id: Optional[uuid.UUID] = None
    link_id: Optional[uuid.UUID] = None
    severity: str
    message: str
    state: str
    consecutive_hits: int
    triggered_at: datetime
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[uuid.UUID] = None

    model_config = ConfigDict(from_attributes=True)


class SiteAlertEventListResponse(BaseModel):
    """List of site alert events with total count."""

    items: list[SiteAlertEventResponse]
    total: int


class SignalHistoryPoint(BaseModel):
    """A single time-bucketed signal history data point."""

    timestamp: datetime
    signal_avg: int
    signal_min: int
    signal_max: int


class SignalHistoryResponse(BaseModel):
    """Signal history response with time-bucketed data points."""

    items: list[SignalHistoryPoint]
    mac_address: str
    range: str
