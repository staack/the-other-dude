"""Pydantic request/response schemas for the Internal Certificate Authority."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class CACreateRequest(BaseModel):
    """Request to generate a new root CA for the tenant."""

    common_name: str = "Portal Root CA"
    validity_years: int = 10  # Default 10 years for CA


class CertSignRequest(BaseModel):
    """Request to sign a per-device certificate using the tenant CA."""

    device_id: UUID
    validity_days: int = 730  # Default 2 years for device certs


class BulkCertDeployRequest(BaseModel):
    """Request to deploy certificates to multiple devices."""

    device_ids: list[UUID]


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class CAResponse(BaseModel):
    """Public details of a tenant's Certificate Authority (no private key)."""

    id: UUID
    tenant_id: UUID
    common_name: str
    fingerprint_sha256: str
    serial_number: str
    not_valid_before: datetime
    not_valid_after: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DeviceCertResponse(BaseModel):
    """Public details of a device certificate (no private key)."""

    id: UUID
    tenant_id: UUID
    device_id: UUID
    ca_id: UUID
    common_name: str
    fingerprint_sha256: str
    serial_number: str
    not_valid_before: datetime
    not_valid_after: datetime
    status: str
    deployed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CertDeployResponse(BaseModel):
    """Result of a single device certificate deployment attempt."""

    success: bool
    device_id: UUID
    cert_name_on_device: str | None = None
    error: str | None = None
