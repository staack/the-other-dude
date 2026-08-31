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
import logging
import uuid
from typing import NamedTuple, Optional

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
from app.services import device_probe
from app.services.crypto import (
    decrypt_credentials_hybrid,
    encrypt_credentials_transit,
)

logger = logging.getLogger(__name__)


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


# How much protection each TLS mode gives, strongest last. Used only to decide
# whether a change weakens a device's transport security and therefore deserves
# a distinct audit event.
#
#   plain     -- no TLS at all; API traffic and credentials in the clear
#   insecure  -- TLS, but no certificate verification
#   auto      -- CA-verified TLS if possible, else insecure; never plain text
#   portal_ca -- CA-verified TLS only
_TLS_MODE_STRENGTH = {"plain": 0, "insecure": 1, "auto": 2, "portal_ca": 3}


def is_tls_downgrade(old_mode: str, new_mode: str) -> bool:
    """Return True if moving from old_mode to new_mode weakens transport security.

    An unrecognised mode returns False: a spurious security event is worse than
    a missing one, because it teaches people to ignore the alert.
    """
    old_rank = _TLS_MODE_STRENGTH.get(old_mode)
    new_rank = _TLS_MODE_STRENGTH.get(new_mode)
    if old_rank is None or new_rank is None:
        return False
    return new_rank < old_rank


def describe_tls_downgrade(old_mode: str, new_mode: str) -> str:
    """Explain, in the audit log, what a downgrade actually costs."""
    if new_mode == "plain":
        return (
            "RouterOS API traffic to this device, including credentials, is no "
            "longer TLS-protected."
        )
    if new_mode == "insecure":
        return (
            "TLS is still used but the device certificate is no longer verified, "
            "so the connection is not protected against interception."
        )
    return f"Transport security weakened from '{old_mode}' to '{new_mode}'."


def describe_device_failure(exc: BaseException) -> str:
    """Turn a per-device exception into a reason an operator can act on.

    Bulk adoption records a failure per device rather than aborting, so this
    string is the only thing the user sees about why a device did not adopt.
    A bare str(exc) is wrong for it in two measured ways:

    - Several common exceptions stringify to "" -- httpx.ConnectError,
      asyncio.TimeoutError, ConnectionResetError, a bare ValueError. The
      device then fails with no visible cause at all.

    - SQLAlchemy's DBAPIError stringifies to the driver message *plus the SQL
      and its bound parameters*. A device INSERT binds
      encrypted_credentials_transit, so the raw str() would copy an OpenBao
      Transit ciphertext into the API response and into the UI -- against this
      module's own rule that credentials are never returned in a public
      response. exc.orig carries the same diagnosis without the SQL or params.
    """
    from fastapi import HTTPException

    # The probe's own message is already written for the user.
    if isinstance(exc, HTTPException):
        return str(exc.detail)

    # SQLAlchemy wraps driver errors; prefer the driver's message so the SQL
    # and bound parameters stay out of the response.
    cause = getattr(exc, "orig", None) or exc
    message = str(cause).strip()

    if not message:
        return f"{type(exc).__name__} (no further detail available)"
    return f"{type(cause).__name__}: {message}"


def probe_device_facts(probe: Optional[device_probe.ProbeOutcome]) -> dict:
    """Device columns learned from a verified probe, ready to splat into Device().

    The probe completes a full login and reads the version and board name on
    the way, so onboarding already knows facts the device page would otherwise
    show as blank until the first poll.

    The mapping matches what the poll path writes
    (app/services/nats_subscriber.py:92-94), so the two cannot disagree:
    version -> routeros_version, board_name -> model. Identity is deliberately
    not persisted -- the poll path does not either, and hostname is the user's
    choice rather than the device's.

    Absent values are omitted rather than written as NULL, mirroring the
    COALESCE the poll path uses so a known value is never blanked.
    """
    if probe is None or not probe.probe_available or not probe.ok:
        return {}

    facts = {}
    if probe.version:
        facts["routeros_version"] = probe.version
    if probe.board_name:
        facts["model"] = probe.board_name
    return facts


async def _require_tcp_reachable(ip_address: str, api_port: int, api_ssl_port: int) -> None:
    """Raise 422 unless one of the RouterOS API ports accepts a TCP connection.

    The degraded check, used only when a real handshake could not be attempted.
    It is what onboarding used to do on its own, and it is why a device with
    api-ssl but no certificate could onboard green and never poll.
    """
    from fastapi import HTTPException, status

    api_reachable = await _tcp_reachable(ip_address, api_port)
    ssl_reachable = await _tcp_reachable(ip_address, api_ssl_port)
    if not api_reachable and not ssl_reachable:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Cannot reach {ip_address} on port {api_port} (RouterOS API) or "
                f"{api_ssl_port} (RouterOS SSL API). Verify the IP address and that "
                "the RouterOS API is enabled. (A full handshake check was not "
                "possible, so this device has not been verified end to end.)"
            ),
        )


async def _decrypt_profile_credentials(
    db: AsyncSession,
    tenant_id,
    credential_profile_id: str,
) -> Optional[tuple[str, str]]:
    """Return (username, password) from a credential profile, or None.

    Used only to run the onboarding probe. The profile id is what gets stored
    on the device; the poller re-resolves it at poll time.
    """
    from app.models.credential_profile import CredentialProfile

    try:
        row = await db.execute(
            select(CredentialProfile).where(
                CredentialProfile.id == uuid.UUID(str(credential_profile_id)),
                CredentialProfile.tenant_id == tenant_id,
            )
        )
        profile = row.scalar_one_or_none()
        if profile is None or profile.credential_type != "routeros":
            return None

        plaintext = await decrypt_credentials_hybrid(
            profile.encrypted_credentials_transit,
            profile.encrypted_credentials,
            str(tenant_id),
            settings.get_encryption_key_bytes(),
        )
        creds = json.loads(plaintext)
        username, password = creds.get("username"), creds.get("password")
        if username is None or password is None:
            return None
        return username, password
    except Exception as exc:  # noqa: BLE001 -- probe is best-effort
        logger.warning("Could not resolve credential profile %s for probing: %s",
                       credential_profile_id, exc)
        return None


async def resolve_probe_credentials(
    db: AsyncSession,
    tenant_id,
    username: Optional[str],
    password: Optional[str],
    credential_profile_id: Optional[str],
) -> Optional[tuple[str, str]]:
    """Work out which credentials the onboarding probe should use.

    Returns None when no credentials can be determined. Callers must treat that
    as "cannot probe" rather than substituting empty strings, which the device
    would reject as a bad login and which would look like the user's mistake.
    """
    if username is not None and password is not None:
        return username, password
    if credential_profile_id:
        return await _decrypt_profile_credentials(db, tenant_id, credential_profile_id)
    return None


async def validate_routeros_connectivity(
    ip_address: str,
    api_port: int,
    api_ssl_port: int,
    username: str,
    password: str,
    tls_mode: str = "auto",
) -> device_probe.ProbeOutcome:
    """Validate a RouterOS device by completing a real protocol handshake.

    Runs the probe in the Go poller -- the same code path polling uses -- so a
    device that passes here can actually be polled. This replaced a bare TCP
    connect, which accepted any device with an open port: a device with
    `api-ssl` enabled and no certificate offers only anonymous-DH ciphers that
    the poller's TLS stack cannot negotiate, so it onboarded green and then
    failed every poll.

    Raises HTTPException(422) with the probe's own diagnosis when the device
    cannot complete a handshake.

    If the poller cannot be reached the probe is skipped and the old TCP check
    is applied instead, so a poller outage degrades onboarding rather than
    blocking it. The returned outcome reports ``probe_available=False`` in that
    case, and the caller must not mark the device online on that basis.
    """
    from fastapi import HTTPException, status

    outcome = await device_probe.probe_new_device(
        ip_address=ip_address,
        api_port=api_port,
        api_ssl_port=api_ssl_port,
        username=username,
        password=password,
        tls_mode=tls_mode,
    )

    if outcome.probe_available:
        if outcome.ok:
            return outcome

        detail = outcome.message
        if outcome.suggested_tls_mode:
            detail += (
                f" Verified alternative: this device does answer in "
                f"'{outcome.suggested_tls_mode}' mode — re-add it with "
                f"tls_mode='{outcome.suggested_tls_mode}' if that is acceptable to you."
            )
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)

    # Degraded: the poller did not answer. Fall back to the weaker TCP check
    # rather than making onboarding impossible during a poller outage.
    logger.warning(
        "Device probe unavailable for %s; falling back to a TCP reachability check: %s",
        ip_address,
        outcome.message,
    )
    await _require_tcp_reachable(ip_address, api_port, api_ssl_port)
    return outcome


class BulkDeviceVerdict(NamedTuple):
    """Outcome of validating one device in a bulk import.

    `rejection` is None when the device may be adopted. `verified` is True only
    when a full handshake actually succeeded -- a device that merely passed the
    degraded TCP fallback is adoptable but unverified, and must not be stored
    as online on that basis.
    """

    rejection: Optional[str]
    verified: bool


async def evaluate_bulk_routeros_device(
    ip_address: str,
    api_port: int,
    api_ssl_port: int,
    tls_mode: str,
    credentials: Optional[tuple[str, str]],
) -> BulkDeviceVerdict:
    """Decide whether a device may be adopted in a bulk import.

    Bulk records failures per device rather than raising, which is why this
    returns a verdict instead of throwing the way the single-device path does.

    Falls back to the TCP check when the poller is unavailable or the
    credential profile could not be read -- a bulk import must not become
    impossible because of an outage, and probing with no credentials would
    report every device as an authentication failure.
    """
    if credentials is not None:
        outcome = await device_probe.probe_new_device(
            ip_address=ip_address,
            api_port=api_port,
            api_ssl_port=api_ssl_port,
            username=credentials[0],
            password=credentials[1],
            tls_mode=tls_mode,
        )
        if outcome.probe_available:
            if outcome.ok:
                return BulkDeviceVerdict(rejection=None, verified=True)
            reason = outcome.message
            if outcome.suggested_tls_mode:
                reason += (
                    f" Verified alternative: this device answers in "
                    f"'{outcome.suggested_tls_mode}' mode."
                )
            return BulkDeviceVerdict(rejection=reason, verified=False)
        logger.warning(
            "Device probe unavailable for %s during bulk import; "
            "falling back to a TCP reachability check: %s",
            ip_address,
            outcome.message,
        )
    else:
        logger.warning(
            "No usable credentials to probe %s during bulk import; "
            "falling back to a TCP reachability check",
            ip_address,
        )

    if await _tcp_reachable(ip_address, api_ssl_port) or await _tcp_reachable(
        ip_address, api_port
    ):
        return BulkDeviceVerdict(rejection=None, verified=False)
    return BulkDeviceVerdict(
        rejection=(
            f"Device unreachable on ports {api_port}/{api_ssl_port}. "
            "(A full handshake check was not possible, so this device has not "
            "been verified end to end.)"
        ),
        verified=False,
    )


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

    # Live handshake validation — only for RouterOS devices (SNMP uses UDP).
    # A device that cannot complete a RouterOS API handshake must not onboard.
    probe: device_probe.ProbeOutcome | None = None
    if not is_snmp:
        credentials = await resolve_probe_credentials(
            db=db,
            tenant_id=tenant_id,
            username=data.username,
            password=data.password,
            credential_profile_id=data.credential_profile_id,
        )
        if credentials is None:
            # No usable credentials (e.g. an unreadable credential profile).
            # Probing anonymously would fail the login and blame the user, so
            # fall back to the old reachability check instead.
            logger.warning(
                "No credentials available to probe %s; falling back to a TCP check",
                data.ip_address,
            )
            await _require_tcp_reachable(data.ip_address, data.api_port, data.api_ssl_port)
        else:
            probe = await validate_routeros_connectivity(
                ip_address=data.ip_address,
                api_port=data.api_port,
                api_ssl_port=data.api_ssl_port,
                username=credentials[0],
                password=credentials[1],
                tls_mode=data.tls_mode,
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
        # Without this the caller's choice is discarded and every device falls
        # to the column default "auto", which never uses api_port at all.
        tls_mode=data.tls_mode or "auto",
        encrypted_credentials_transit=transit_ciphertext,
        # SNMP fields
        snmp_port=data.snmp_port if is_snmp else 161,
        snmp_version=data.snmp_version if is_snmp else None,
        snmp_profile_id=snmp_profile_uuid,
        credential_profile_id=credential_profile_uuid,
        # A RouterOS device that completed a live handshake is known to be
        # online right now, so say so rather than leaving it "unknown" until
        # the next poll cycle -- up to 120s later. Anything not positively
        # verified stays "unknown".
        status=(
            "online"
            if (probe is not None and probe.probe_available and probe.ok)
            else "unknown"
        ),
        # Version and model, already learned during the handshake.
        **probe_device_facts(probe),
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

    # Decrypt the profile's credentials once, not once per device, so a large
    # import does not pay for a Transit round trip per entry.
    bulk_credentials: Optional[tuple[str, str]] = None
    if data.device_type == "routeros":
        bulk_credentials = await _decrypt_profile_credentials(
            db, tenant_id, str(data.credential_profile_id)
        )

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

            # Live handshake validation for RouterOS devices. A bare TCP check
            # here would let a device with api-ssl and no certificate import
            # green and then never poll -- the same defect the single-device
            # path had.
            verified = False
            if data.device_type == "routeros":
                verdict = await evaluate_bulk_routeros_device(
                    ip_address=entry.ip_address,
                    api_port=defaults.api_port,
                    api_ssl_port=defaults.api_ssl_port,
                    tls_mode=defaults.tls_mode,
                    credentials=bulk_credentials,
                )
                if verdict.rejection is not None:
                    results.append(
                        BulkAddDeviceResult(
                            ip_address=entry.ip_address,
                            hostname=hostname,
                            success=False,
                            error=verdict.rejection,
                        )
                    )
                    continue
                # Only a completed handshake counts; the degraded TCP fallback
                # does not, so such a device stays "unknown".
                verified = verdict.verified

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
                # Only a completed handshake justifies "online"; a device that
                # merely passed the degraded TCP fallback stays "unknown" until
                # the poller says otherwise.
                status="online" if verified else "unknown",
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
            logger.warning(
                "Bulk profile import failed for %s", entry.ip_address, exc_info=True
            )
            results.append(
                BulkAddDeviceResult(
                    ip_address=entry.ip_address,
                    hostname=entry.hostname or entry.ip_address,
                    success=False,
                    error=describe_device_failure(exc),
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
