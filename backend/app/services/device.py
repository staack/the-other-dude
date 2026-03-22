"""
Device service — business logic for device CRUD, credential encryption, groups, and tags.

All functions operate via the app_user engine (RLS enforced).
Tenant isolation is handled automatically by PostgreSQL RLS policies
(SET LOCAL app.current_tenant is set by the get_current_user dependency before
this layer is called).

Credential policy:
- Credentials are always stored as AES-256-GCM encrypted JSON blobs.
- Credentials are NEVER returned in any public-facing response.
- Re-encryption happens only when a new password is explicitly provided in an update.
"""

import asyncio
import json
import uuid
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.device import (
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    DeviceTag,
    DeviceTagAssignment,
)
from app.schemas.device import (
    BulkAddDefaults,
    BulkAddDeviceResult,
    BulkAddWithProfileRequest,
    BulkAddWithProfileResult,
    DeviceCreate,
    DeviceGroupCreate,
    DeviceGroupResponse,
    DeviceGroupUpdate,
    DeviceResponse,
    DeviceTagCreate,
    DeviceTagResponse,
    DeviceTagUpdate,
    DeviceUpdate,
)
from app.config import settings
from app.services.crypto import (
    decrypt_credentials_hybrid,
    encrypt_credentials_transit,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _tcp_reachable(ip: str, port: int, timeout: float = 3.0) -> bool:
    """Return True if a TCP connection to ip:port succeeds within timeout."""
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


def _build_device_response(device: Device) -> DeviceResponse:
    """
    Build a DeviceResponse from an ORM Device instance.

    Tags and groups are extracted from pre-loaded relationships.
    Credentials are explicitly EXCLUDED.
    """
    from app.schemas.device import DeviceGroupRef, DeviceTagRef

    tags = [
        DeviceTagRef(
            id=a.tag.id,
            name=a.tag.name,
            color=a.tag.color,
        )
        for a in device.tag_assignments
    ]

    groups = [
        DeviceGroupRef(
            id=m.group.id,
            name=m.group.name,
        )
        for m in device.group_memberships
    ]

    return DeviceResponse(
        id=device.id,
        hostname=device.hostname,
        ip_address=device.ip_address,
        api_port=device.api_port,
        api_ssl_port=device.api_ssl_port,
        model=device.model,
        serial_number=device.serial_number,
        firmware_version=device.firmware_version,
        routeros_version=device.routeros_version,
        uptime_seconds=device.uptime_seconds,
        last_seen=device.last_seen,
        latitude=device.latitude,
        longitude=device.longitude,
        status=device.status,
        tls_mode=device.tls_mode,
        device_type=device.device_type,
        snmp_port=device.snmp_port,
        snmp_version=device.snmp_version,
        snmp_profile_id=device.snmp_profile_id,
        credential_profile_id=device.credential_profile_id,
        tags=tags,
        groups=groups,
        site_id=device.site_id,
        site_name=device.site.name if device.site else None,
        sector_id=device.sector_id,
        sector_name=device.sector.name if device.sector else None,
        created_at=device.created_at,
    )


def _device_with_relations():
    """Return a select() for Device with tags and groups eagerly loaded."""

    return select(Device).options(
        selectinload(Device.tag_assignments).selectinload(DeviceTagAssignment.tag),
        selectinload(Device.group_memberships).selectinload(DeviceGroupMembership.group),
        selectinload(Device.site),
        selectinload(Device.sector),
    )


# ---------------------------------------------------------------------------
# Device CRUD
# ---------------------------------------------------------------------------


async def create_device(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    data: DeviceCreate,
    encryption_key: bytes,
) -> DeviceResponse:
    """
    Create a new device (RouterOS or SNMP).

    - RouterOS: validates TCP connectivity, encrypts username/password.
    - SNMP: skips TCP probe (UDP), encrypts community string if provided inline.
    - Status set to "unknown" until the poller runs a full check.
    """
    is_snmp = data.device_type == "snmp"

    # TCP reachability check — only for RouterOS devices (SNMP uses UDP)
    if not is_snmp:
        api_reachable = await _tcp_reachable(data.ip_address, data.api_port)
        ssl_reachable = await _tcp_reachable(data.ip_address, data.api_ssl_port)

        if not api_reachable and not ssl_reachable:
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Cannot reach {data.ip_address} on port {data.api_port} "
                    f"(RouterOS API) or {data.api_ssl_port} (RouterOS SSL API). "
                    "Verify the IP address and that the RouterOS API is enabled."
                ),
            )

    # Encrypt credentials via OpenBao Transit
    transit_ciphertext = None
    if data.username is not None and data.password is not None:
        # RouterOS username/password or SNMP v3 with user/pass
        credentials_json = json.dumps({"username": data.username, "password": data.password})
        transit_ciphertext = await encrypt_credentials_transit(credentials_json, str(tenant_id))
    elif data.community is not None:
        # Inline SNMP v2c community string — store as encrypted credential
        credentials_json = json.dumps({"community": data.community, "type": "snmp_v2c"})
        transit_ciphertext = await encrypt_credentials_transit(credentials_json, str(tenant_id))

    # Resolve credential_profile_id and snmp_profile_id (string -> UUID)
    credential_profile_uuid = (
        uuid.UUID(data.credential_profile_id) if data.credential_profile_id else None
    )
    snmp_profile_uuid = uuid.UUID(data.snmp_profile_id) if data.snmp_profile_id else None

    device = Device(
        tenant_id=tenant_id,
        hostname=data.hostname,
        ip_address=data.ip_address,
        device_type=data.device_type,
        api_port=data.api_port,
        api_ssl_port=data.api_ssl_port,
        encrypted_credentials_transit=transit_ciphertext,
        # SNMP fields
        snmp_port=data.snmp_port if is_snmp else 161,
        snmp_version=data.snmp_version if is_snmp else None,
        snmp_profile_id=snmp_profile_uuid,
        credential_profile_id=credential_profile_uuid,
        status="unknown",
    )
    db.add(device)
    await db.flush()  # Get the ID without committing
    await db.refresh(device)

    # Re-query with relationships loaded
    result = await db.execute(_device_with_relations().where(Device.id == device.id))
    device = result.scalar_one()
    return _build_device_response(device)


async def get_devices(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    page: int = 1,
    page_size: int = 25,
    status: Optional[str] = None,
    search: Optional[str] = None,
    tag_id: Optional[uuid.UUID] = None,
    group_id: Optional[uuid.UUID] = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    site_id: Optional[uuid.UUID] = None,
    sector_id: Optional[uuid.UUID] = None,
    device_type: Optional[str] = None,
) -> tuple[list[DeviceResponse], int]:
    """
    Return a paginated list of devices with optional filtering and sorting.

    Returns (items, total_count).
    RLS automatically scopes this to the caller's tenant.
    """
    base_q = _device_with_relations()

    # Filtering
    if status:
        base_q = base_q.where(Device.status == status)

    if search:
        pattern = f"%{search}%"
        base_q = base_q.where(
            or_(
                Device.hostname.ilike(pattern),
                Device.ip_address.ilike(pattern),
            )
        )

    if tag_id:
        base_q = base_q.where(
            Device.id.in_(
                select(DeviceTagAssignment.device_id).where(DeviceTagAssignment.tag_id == tag_id)
            )
        )

    if group_id:
        base_q = base_q.where(
            Device.id.in_(
                select(DeviceGroupMembership.device_id).where(
                    DeviceGroupMembership.group_id == group_id
                )
            )
        )

    if site_id:
        base_q = base_q.where(Device.site_id == site_id)

    if sector_id:
        base_q = base_q.where(Device.sector_id == sector_id)

    if device_type:
        base_q = base_q.where(Device.device_type == device_type)

    # Count total before pagination
    count_q = select(func.count()).select_from(base_q.subquery())
    total_result = await db.execute(count_q)
    total = total_result.scalar_one()

    # Sorting
    allowed_sort_cols = {
        "created_at": Device.created_at,
        "hostname": Device.hostname,
        "ip_address": Device.ip_address,
        "status": Device.status,
        "last_seen": Device.last_seen,
    }
    sort_col = allowed_sort_cols.get(sort_by, Device.created_at)
    if sort_order.lower() == "asc":
        base_q = base_q.order_by(sort_col.asc())
    else:
        base_q = base_q.order_by(sort_col.desc())

    # Pagination
    offset = (page - 1) * page_size
    base_q = base_q.offset(offset).limit(page_size)

    result = await db.execute(base_q)
    devices = result.scalars().all()
    return [_build_device_response(d) for d in devices], total


async def get_device(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
) -> DeviceResponse:
    """Get a single device by ID."""
    from fastapi import HTTPException, status

    result = await db.execute(_device_with_relations().where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return _build_device_response(device)


async def update_device(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    data: DeviceUpdate,
    encryption_key: bytes,
) -> DeviceResponse:
    """
    Update device fields. Re-encrypts credentials only if password is provided.
    """
    from fastapi import HTTPException, status

    result = await db.execute(_device_with_relations().where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    # Update scalar fields
    if data.hostname is not None:
        device.hostname = data.hostname
    if data.ip_address is not None:
        device.ip_address = data.ip_address
    if data.api_port is not None:
        device.api_port = data.api_port
    if data.api_ssl_port is not None:
        device.api_ssl_port = data.api_ssl_port
    if data.latitude is not None:
        device.latitude = data.latitude
    if data.longitude is not None:
        device.longitude = data.longitude
    if data.tls_mode is not None:
        device.tls_mode = data.tls_mode
    # SNMP fields
    if data.snmp_port is not None:
        device.snmp_port = data.snmp_port
    if data.snmp_version is not None:
        device.snmp_version = data.snmp_version
    if data.snmp_profile_id is not None:
        device.snmp_profile_id = data.snmp_profile_id

    # Assign credential profile if provided
    if data.credential_profile_id is not None:
        from app.models.credential_profile import CredentialProfile

        cp_result = await db.execute(
            select(CredentialProfile).where(
                CredentialProfile.id == data.credential_profile_id,
                CredentialProfile.tenant_id == tenant_id,
            )
        )
        if not cp_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Credential profile not found",
            )
        device.credential_profile_id = data.credential_profile_id

    # Re-encrypt credentials if new ones are provided
    credentials_changed = False
    if data.password is not None:
        # Decrypt existing to get current username if no new username given
        current_username: str = data.username or ""
        if not current_username and (
            device.encrypted_credentials_transit or device.encrypted_credentials
        ):
            try:
                existing_json = await decrypt_credentials_hybrid(
                    device.encrypted_credentials_transit,
                    device.encrypted_credentials,
                    str(device.tenant_id),
                    settings.get_encryption_key_bytes(),
                )
                existing = json.loads(existing_json)
                current_username = existing.get("username", "")
            except Exception:
                current_username = ""

        credentials_json = json.dumps(
            {
                "username": data.username if data.username is not None else current_username,
                "password": data.password,
            }
        )
        # New writes go through Transit
        device.encrypted_credentials_transit = await encrypt_credentials_transit(
            credentials_json, str(device.tenant_id)
        )
        device.encrypted_credentials = None  # Clear legacy (Transit is canonical)
        credentials_changed = True
    elif data.username is not None and (
        device.encrypted_credentials_transit or device.encrypted_credentials
    ):
        # Only username changed — update it without changing the password
        try:
            existing_json = await decrypt_credentials_hybrid(
                device.encrypted_credentials_transit,
                device.encrypted_credentials,
                str(device.tenant_id),
                settings.get_encryption_key_bytes(),
            )
            existing = json.loads(existing_json)
            existing["username"] = data.username
            # Re-encrypt via Transit
            device.encrypted_credentials_transit = await encrypt_credentials_transit(
                json.dumps(existing), str(device.tenant_id)
            )
            device.encrypted_credentials = None
            credentials_changed = True
        except Exception:
            pass  # Keep existing encrypted blob if decryption fails

    await db.flush()
    await db.refresh(device)

    # Notify poller to invalidate cached credentials (fire-and-forget via NATS)
    if credentials_changed:
        try:
            from app.services.event_publisher import publish_event

            await publish_event(
                f"device.credential_changed.{device_id}",
                {"device_id": str(device_id), "tenant_id": str(tenant_id)},
            )
        except Exception:
            pass  # Never fail the update due to NATS issues

    result2 = await db.execute(_device_with_relations().where(Device.id == device_id))
    device = result2.scalar_one()
    return _build_device_response(device)


async def delete_device(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
) -> None:
    """Hard-delete a device (v1 — no soft delete for devices)."""
    from fastapi import HTTPException, status

    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    await db.delete(device)
    await db.flush()


# ---------------------------------------------------------------------------
# Bulk add with credential profile
# ---------------------------------------------------------------------------


async def bulk_add_with_profile(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    data: BulkAddWithProfileRequest,
    user_id: uuid.UUID,
) -> BulkAddWithProfileResult:
    """Add multiple devices using a credential profile. Partial success allowed."""
    from fastapi import HTTPException, status
    from sqlalchemy import text

    from app.models.credential_profile import CredentialProfile

    # 1. Validate credential profile exists and belongs to tenant
    profile_row = await db.execute(
        select(CredentialProfile).where(
            CredentialProfile.id == data.credential_profile_id,
            CredentialProfile.tenant_id == tenant_id,
        )
    )
    profile = profile_row.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential profile not found or does not belong to this tenant",
        )

    # 2. Validate credential_type matches device_type
    valid_types_for_device = {
        "routeros": ["routeros"],
        "snmp": ["snmp_v1", "snmp_v2c", "snmp_v3"],
    }
    if profile.credential_type not in valid_types_for_device.get(data.device_type, []):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Credential profile type '{profile.credential_type}' "
                f"is not compatible with device_type '{data.device_type}'"
            ),
        )

    # 3. If SNMP and snmp_profile_id provided in defaults, validate it exists
    snmp_profile_id = None
    if data.device_type == "snmp" and data.defaults and data.defaults.snmp_profile_id:
        snmp_check = await db.execute(
            text(
                "SELECT id FROM snmp_profiles"
                " WHERE id = :id AND (tenant_id = :tenant_id OR tenant_id IS NULL)"
            ),
            {"id": str(data.defaults.snmp_profile_id), "tenant_id": str(tenant_id)},
        )
        if not snmp_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="SNMP profile not found")
        snmp_profile_id = data.defaults.snmp_profile_id

    # 4. Process each device
    results: list[BulkAddDeviceResult] = []
    defaults = data.defaults or BulkAddDefaults()

    for entry in data.devices:
        try:
            hostname = entry.hostname or entry.ip_address

            # Check for duplicate IP in tenant
            dup_check = await db.execute(
                text("SELECT id FROM devices WHERE ip_address = :ip AND tenant_id = :tid"),
                {"ip": entry.ip_address, "tid": str(tenant_id)},
            )
            if dup_check.scalar_one_or_none():
                results.append(
                    BulkAddDeviceResult(
                        ip_address=entry.ip_address,
                        hostname=hostname,
                        success=False,
                        error="Device with this IP already exists",
                    )
                )
                continue

            # TCP reachability check for RouterOS devices
            if data.device_type == "routeros":
                reachable = await _tcp_reachable(entry.ip_address, defaults.api_ssl_port)
                if not reachable:
                    reachable = await _tcp_reachable(entry.ip_address, defaults.api_port)
                if not reachable:
                    results.append(
                        BulkAddDeviceResult(
                            ip_address=entry.ip_address,
                            hostname=hostname,
                            success=False,
                            error=(
                                f"Device unreachable on ports "
                                f"{defaults.api_port}/{defaults.api_ssl_port}"
                            ),
                        )
                    )
                    continue

            # Create device with credential profile reference
            device = Device(
                tenant_id=tenant_id,
                hostname=hostname,
                ip_address=entry.ip_address,
                device_type=data.device_type,
                credential_profile_id=data.credential_profile_id,
                # RouterOS fields
                api_port=defaults.api_port if data.device_type == "routeros" else 8728,
                api_ssl_port=defaults.api_ssl_port if data.device_type == "routeros" else 8729,
                tls_mode=defaults.tls_mode if data.device_type == "routeros" else "auto",
                # SNMP fields
                snmp_port=defaults.snmp_port if data.device_type == "snmp" else 161,
                snmp_version=defaults.snmp_version if data.device_type == "snmp" else None,
                snmp_profile_id=snmp_profile_id,
                status="unknown",
            )
            db.add(device)
            await db.flush()

            results.append(
                BulkAddDeviceResult(
                    ip_address=entry.ip_address,
                    hostname=hostname,
                    success=True,
                    device_id=device.id,
                )
            )

        except Exception as exc:
            results.append(
                BulkAddDeviceResult(
                    ip_address=entry.ip_address,
                    hostname=entry.hostname or entry.ip_address,
                    success=False,
                    error=str(exc),
                )
            )

    await db.commit()

    succeeded = sum(1 for r in results if r.success)
    return BulkAddWithProfileResult(
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
        results=results,
    )


# ---------------------------------------------------------------------------
# Group / Tag assignment
# ---------------------------------------------------------------------------


async def assign_device_to_group(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    group_id: uuid.UUID,
) -> None:
    """Assign a device to a group (idempotent)."""
    from fastapi import HTTPException, status

    # Verify device and group exist (RLS scopes both)
    dev = await db.get(Device, device_id)
    if not dev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    grp = await db.get(DeviceGroup, group_id)
    if not grp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    existing = await db.get(DeviceGroupMembership, (device_id, group_id))
    if not existing:
        db.add(DeviceGroupMembership(device_id=device_id, group_id=group_id))
        await db.flush()


async def remove_device_from_group(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    group_id: uuid.UUID,
) -> None:
    """Remove a device from a group."""
    from fastapi import HTTPException, status

    membership = await db.get(DeviceGroupMembership, (device_id, group_id))
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device is not in this group",
        )
    await db.delete(membership)
    await db.flush()


async def assign_tag_to_device(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tag_id: uuid.UUID,
) -> None:
    """Assign a tag to a device (idempotent)."""
    from fastapi import HTTPException, status

    dev = await db.get(Device, device_id)
    if not dev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    tag = await db.get(DeviceTag, tag_id)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    existing = await db.get(DeviceTagAssignment, (device_id, tag_id))
    if not existing:
        db.add(DeviceTagAssignment(device_id=device_id, tag_id=tag_id))
        await db.flush()


async def remove_tag_from_device(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tag_id: uuid.UUID,
) -> None:
    """Remove a tag from a device."""
    from fastapi import HTTPException, status

    assignment = await db.get(DeviceTagAssignment, (device_id, tag_id))
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tag is not assigned to this device",
        )
    await db.delete(assignment)
    await db.flush()


# ---------------------------------------------------------------------------
# DeviceGroup CRUD
# ---------------------------------------------------------------------------


async def create_group(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    data: DeviceGroupCreate,
) -> DeviceGroupResponse:
    """Create a new device group."""
    group = DeviceGroup(
        tenant_id=tenant_id,
        name=data.name,
        description=data.description,
    )
    db.add(group)
    await db.flush()
    await db.refresh(group)

    # Count devices in the group (0 for new group)
    return DeviceGroupResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        device_count=0,
        created_at=group.created_at,
    )


async def get_groups(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> list[DeviceGroupResponse]:
    """Return all device groups for the current tenant with device counts."""
    result = await db.execute(select(DeviceGroup).options(selectinload(DeviceGroup.memberships)))
    groups = result.scalars().all()
    return [
        DeviceGroupResponse(
            id=g.id,
            name=g.name,
            description=g.description,
            device_count=len(g.memberships),
            created_at=g.created_at,
        )
        for g in groups
    ]


async def update_group(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    group_id: uuid.UUID,
    data: DeviceGroupUpdate,
) -> DeviceGroupResponse:
    """Update a device group."""
    from fastapi import HTTPException, status

    result = await db.execute(
        select(DeviceGroup)
        .options(selectinload(DeviceGroup.memberships))
        .where(DeviceGroup.id == group_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    if data.name is not None:
        group.name = data.name
    if data.description is not None:
        group.description = data.description

    await db.flush()
    await db.refresh(group)

    result2 = await db.execute(
        select(DeviceGroup)
        .options(selectinload(DeviceGroup.memberships))
        .where(DeviceGroup.id == group_id)
    )
    group = result2.scalar_one()
    return DeviceGroupResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        device_count=len(group.memberships),
        created_at=group.created_at,
    )


async def delete_group(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    group_id: uuid.UUID,
) -> None:
    """Delete a device group."""
    from fastapi import HTTPException, status

    group = await db.get(DeviceGroup, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    await db.delete(group)
    await db.flush()


# ---------------------------------------------------------------------------
# DeviceTag CRUD
# ---------------------------------------------------------------------------


async def create_tag(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    data: DeviceTagCreate,
) -> DeviceTagResponse:
    """Create a new device tag."""
    tag = DeviceTag(
        tenant_id=tenant_id,
        name=data.name,
        color=data.color,
    )
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    return DeviceTagResponse(id=tag.id, name=tag.name, color=tag.color)


async def get_tags(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> list[DeviceTagResponse]:
    """Return all device tags for the current tenant."""
    result = await db.execute(select(DeviceTag))
    tags = result.scalars().all()
    return [DeviceTagResponse(id=t.id, name=t.name, color=t.color) for t in tags]


async def update_tag(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    tag_id: uuid.UUID,
    data: DeviceTagUpdate,
) -> DeviceTagResponse:
    """Update a device tag."""
    from fastapi import HTTPException, status

    tag = await db.get(DeviceTag, tag_id)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    if data.name is not None:
        tag.name = data.name
    if data.color is not None:
        tag.color = data.color

    await db.flush()
    await db.refresh(tag)
    return DeviceTagResponse(id=tag.id, name=tag.name, color=tag.color)


async def delete_tag(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    tag_id: uuid.UUID,
) -> None:
    """Delete a device tag."""
    from fastapi import HTTPException, status

    tag = await db.get(DeviceTag, tag_id)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    await db.delete(tag)
    await db.flush()
