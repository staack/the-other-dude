"""Credential profile service -- business logic for credential profile CRUD.

All functions operate via the app_user engine (RLS enforced).
Tenant isolation is handled automatically by PostgreSQL RLS policies.

Credential policy:
- New writes always use OpenBao Transit encryption (never legacy AES).
- Credential data (passwords, communities, passphrases) is NEVER returned.
- Updating credentials re-encrypts via Transit; linked devices pick up
  new creds on their next poll cycle (no device-level update needed).
"""

import json
import uuid

import structlog
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.schemas.credential_profile import (
    CredentialProfileCreate,
    CredentialProfileListResponse,
    CredentialProfileResponse,
    CredentialProfileUpdate,
)
from app.services import audit_service
from app.services.crypto import encrypt_credentials_transit

logger = structlog.get_logger("credential_profile_service")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_credential_json(data: CredentialProfileCreate | CredentialProfileUpdate) -> dict:
    """Build the credential JSON dict from schema fields based on credential_type."""
    ct = data.credential_type
    if ct == "routeros":
        return {"type": "routeros", "username": data.username, "password": data.password}
    elif ct == "snmp_v1":
        return {"type": "snmp_v1", "community": data.community}
    elif ct == "snmp_v2c":
        return {"type": "snmp_v2c", "community": data.community}
    elif ct == "snmp_v3":
        cred: dict = {
            "type": "snmp_v3",
            "username": data.username,
            "security_level": data.security_level,
        }
        if data.auth_protocol:
            cred["auth_protocol"] = data.auth_protocol
        if data.auth_passphrase:
            cred["auth_passphrase"] = data.auth_passphrase
        if data.priv_protocol:
            cred["priv_protocol"] = data.priv_protocol
        if data.priv_passphrase:
            cred["priv_passphrase"] = data.priv_passphrase
        return cred
    else:
        raise ValueError(f"Unknown credential_type: {ct}")


def _profile_response(
    profile: CredentialProfile, device_count: int = 0
) -> CredentialProfileResponse:
    """Build a CredentialProfileResponse from an ORM instance."""
    return CredentialProfileResponse(
        id=profile.id,
        name=profile.name,
        description=profile.description,
        credential_type=profile.credential_type,
        device_count=device_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def _get_profile_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, profile_id: uuid.UUID
) -> CredentialProfile:
    """Fetch a credential profile by id and tenant, or raise 404."""
    result = await db.execute(
        select(CredentialProfile).where(
            CredentialProfile.id == profile_id,
            CredentialProfile.tenant_id == tenant_id,
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential profile not found",
        )
    return profile


async def _count_devices(db: AsyncSession, profile_id: uuid.UUID) -> int:
    """Count devices linked to a credential profile."""
    result = await db.execute(
        select(func.count(Device.id)).where(Device.credential_profile_id == profile_id)
    )
    return result.scalar() or 0


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def get_profiles(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    credential_type: str | None = None,
) -> CredentialProfileListResponse:
    """List all credential profiles for a tenant."""
    query = (
        select(CredentialProfile)
        .where(CredentialProfile.tenant_id == tenant_id)
        .order_by(CredentialProfile.name)
    )

    if credential_type:
        query = query.where(CredentialProfile.credential_type == credential_type)

    result = await db.execute(query)
    profiles = list(result.scalars().all())

    # Batch count devices per profile
    profile_ids = [p.id for p in profiles]
    device_counts: dict[uuid.UUID, int] = {}
    if profile_ids:
        count_result = await db.execute(
            select(
                Device.credential_profile_id,
                func.count(Device.id).label("cnt"),
            )
            .where(Device.credential_profile_id.in_(profile_ids))
            .group_by(Device.credential_profile_id)
        )
        for row in count_result:
            device_counts[row.credential_profile_id] = row.cnt

    responses = [_profile_response(p, device_count=device_counts.get(p.id, 0)) for p in profiles]
    return CredentialProfileListResponse(profiles=responses)


async def get_profile(
    db: AsyncSession, tenant_id: uuid.UUID, profile_id: uuid.UUID
) -> CredentialProfileResponse:
    """Fetch a single credential profile."""
    profile = await _get_profile_or_404(db, tenant_id, profile_id)
    dc = await _count_devices(db, profile_id)
    return _profile_response(profile, device_count=dc)


async def create_profile(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    data: CredentialProfileCreate,
    user_id: uuid.UUID,
) -> CredentialProfileResponse:
    """Create a new credential profile with Transit-encrypted credentials."""
    # Build credential JSON and encrypt via OpenBao Transit
    cred_json = _build_credential_json(data)
    encrypted = await encrypt_credentials_transit(json.dumps(cred_json), str(tenant_id))

    profile = CredentialProfile(
        tenant_id=tenant_id,
        name=data.name,
        description=data.description,
        credential_type=data.credential_type,
        encrypted_credentials_transit=encrypted,
        # Do NOT set encrypted_credentials (legacy) -- new writes always use Transit
    )
    db.add(profile)
    await db.flush()
    await db.refresh(profile)

    await audit_service.log_action(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="credential_profile.create",
        resource_type="credential_profile",
        resource_id=str(profile.id),
        details={"name": profile.name, "type": profile.credential_type},
    )

    return _profile_response(profile, device_count=0)


async def update_profile(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    data: CredentialProfileUpdate,
    user_id: uuid.UUID,
) -> CredentialProfileResponse:
    """Update a credential profile. Re-encrypts credentials if changed."""
    profile = await _get_profile_or_404(db, tenant_id, profile_id)

    # Update name/description if provided
    if data.name is not None:
        profile.name = data.name
    if data.description is not None:
        profile.description = data.description

    # Determine if credential re-encryption is needed
    cred_fields = {
        "username",
        "password",
        "community",
        "security_level",
        "auth_protocol",
        "auth_passphrase",
        "priv_protocol",
        "priv_passphrase",
    }
    has_cred_changes = any(getattr(data, f) is not None for f in cred_fields)
    type_changed = data.credential_type is not None

    if type_changed or has_cred_changes:
        # If type changed, use the new type; otherwise keep the existing one
        if type_changed:
            profile.credential_type = data.credential_type  # type: ignore[assignment]

        # Rebuild and re-encrypt credentials
        cred_json = _build_credential_json(data if type_changed else _merge_update(data, profile))
        encrypted = await encrypt_credentials_transit(json.dumps(cred_json), str(tenant_id))
        profile.encrypted_credentials_transit = encrypted
        profile.encrypted_credentials = None  # Clear legacy

    await db.flush()
    await db.refresh(profile)

    dc = await _count_devices(db, profile_id)

    await audit_service.log_action(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="credential_profile.update",
        resource_type="credential_profile",
        resource_id=str(profile.id),
        details={
            "name": profile.name,
            "updated_fields": list(data.model_dump(exclude_unset=True).keys()),
        },
    )

    return _profile_response(profile, device_count=dc)


def _merge_update(
    data: CredentialProfileUpdate, profile: CredentialProfile
) -> CredentialProfileUpdate:
    """For partial credential updates, overlay data onto existing profile type.

    When credential_type is not changing but individual credential fields are,
    we need to use the existing credential_type to build the JSON.
    """
    # Create a new update object with the existing credential_type set
    merged = data.model_copy()
    object.__setattr__(merged, "credential_type", profile.credential_type)
    return merged


async def delete_profile(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete a credential profile. Returns 409 if devices reference it."""
    profile = await _get_profile_or_404(db, tenant_id, profile_id)
    device_count = await _count_devices(db, profile_id)

    if device_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Cannot delete: profile is assigned to devices",
                "device_count": device_count,
            },
        )

    profile_name = profile.name
    await db.delete(profile)
    await db.flush()

    await audit_service.log_action(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="credential_profile.delete",
        resource_type="credential_profile",
        resource_id=str(profile_id),
        details={"name": profile_name},
    )


async def get_profile_devices(
    db: AsyncSession, tenant_id: uuid.UUID, profile_id: uuid.UUID
) -> list[dict]:
    """Return list of devices using this credential profile."""
    # Verify profile exists and belongs to tenant
    await _get_profile_or_404(db, tenant_id, profile_id)

    result = await db.execute(
        select(
            Device.id,
            Device.hostname,
            Device.ip_address,
            Device.status,
        ).where(Device.credential_profile_id == profile_id)
    )
    return [
        {
            "id": str(row.id),
            "hostname": row.hostname,
            "ip_address": row.ip_address,
            "status": row.status,
        }
        for row in result
    ]
