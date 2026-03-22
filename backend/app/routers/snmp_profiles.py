"""
SNMP Profile CRUD API endpoints.

Routes: /api/tenants/{tenant_id}/snmp-profiles

Provides listing, creation, update, and deletion of SNMP device profiles.
System-shipped profiles (is_system=True, tenant_id IS NULL) are visible to
all tenants but cannot be modified or deleted.

Additional endpoints:
- POST /snmp-profiles/parse-mib: Upload a MIB file, parse via tod-mib-parser binary
- POST /snmp-profiles/{id}/test: Test a profile against a live device via NATS

RBAC:
- devices:read scope: GET (list, detail)
- operator+: POST, PUT (create, update tenant profiles, parse-mib, test)
- tenant_admin+: DELETE (delete tenant profiles)
"""

import json
import logging
import shutil
import subprocess
import tempfile
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.rbac import require_operator_or_above, require_scope, require_tenant_admin_or_above
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.routers.devices import _check_tenant_access
from app.schemas.snmp_profile import (
    MIBParseResponse,
    ProfileTestRequest,
    ProfileTestResponse,
    SNMPProfileCreate,
    SNMPProfileDetailResponse,
    SNMPProfileListResponse,
    SNMPProfileResponse,
    SNMPProfileUpdate,
)
from app.services import snmp_proxy

logger = logging.getLogger(__name__)

router = APIRouter(tags=["snmp-profiles"])

# Resolve MIB parser binary path: prefer settings, fall back to PATH lookup
MIB_PARSER_BINARY = shutil.which("tod-mib-parser") or settings.MIB_PARSER_PATH


# ---------------------------------------------------------------------------
# List profiles (system + tenant)
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/snmp-profiles",
    response_model=SNMPProfileListResponse,
    summary="List SNMP profiles (system + tenant)",
    dependencies=[require_scope("devices:read")],
)
async def list_profiles(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SNMPProfileListResponse:
    """List all SNMP profiles visible to a tenant.

    Returns both system-shipped profiles (tenant_id IS NULL) and
    tenant-specific custom profiles. System profiles appear first.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT sp.id, sp.tenant_id, sp.name, sp.description, sp.sys_object_id, sp.vendor,
                   sp.category, sp.is_system, sp.created_at, sp.updated_at,
                   COALESCE(dc.device_count, 0) AS device_count
            FROM snmp_profiles sp
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS device_count
                FROM devices d
                WHERE d.snmp_profile_id = sp.id
            ) dc ON true
            WHERE sp.tenant_id = :tenant_id OR sp.tenant_id IS NULL
            ORDER BY sp.is_system DESC, sp.name ASC
        """),
        {"tenant_id": str(tenant_id)},
    )
    rows = result.mappings().all()
    return SNMPProfileListResponse(profiles=[dict(row) for row in rows])


# ---------------------------------------------------------------------------
# Get profile detail (includes profile_data)
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/snmp-profiles/{profile_id}",
    response_model=SNMPProfileDetailResponse,
    summary="Get SNMP profile detail",
    dependencies=[require_scope("devices:read")],
)
async def get_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get a single SNMP profile with full profile_data JSONB."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        text("""
            SELECT id, tenant_id, name, description, sys_object_id, vendor,
                   category, profile_data, is_system, created_at, updated_at
            FROM snmp_profiles
            WHERE id = :profile_id
              AND (tenant_id = :tenant_id OR tenant_id IS NULL)
        """),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SNMP profile not found")
    return dict(row)


# ---------------------------------------------------------------------------
# Create profile
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/snmp-profiles",
    response_model=SNMPProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a tenant SNMP profile",
    dependencies=[Depends(require_operator_or_above)],
)
async def create_profile(
    tenant_id: uuid.UUID,
    data: SNMPProfileCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Create a new tenant-scoped SNMP profile (is_system=False)."""
    await _check_tenant_access(current_user, tenant_id, db)

    import json

    result = await db.execute(
        text("""
            INSERT INTO snmp_profiles
                (tenant_id, name, description, sys_object_id, vendor,
                 category, profile_data, is_system)
            VALUES
                (:tenant_id, :name, :description, :sys_object_id, :vendor,
                 :category, :profile_data::jsonb, FALSE)
            RETURNING id, tenant_id, name, description, sys_object_id, vendor,
                      category, is_system, created_at, updated_at
        """),
        {
            "tenant_id": str(tenant_id),
            "name": data.name,
            "description": data.description,
            "sys_object_id": data.sys_object_id,
            "vendor": data.vendor,
            "category": data.category,
            "profile_data": json.dumps(data.profile_data),
        },
    )
    await db.commit()
    row = result.mappings().first()
    return dict(row)


# ---------------------------------------------------------------------------
# Update profile
# ---------------------------------------------------------------------------


@router.put(
    "/tenants/{tenant_id}/snmp-profiles/{profile_id}",
    response_model=SNMPProfileResponse,
    summary="Update a tenant SNMP profile",
    dependencies=[Depends(require_operator_or_above)],
)
async def update_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    data: SNMPProfileUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Update an existing tenant-scoped SNMP profile.

    System profiles (is_system=True) cannot be modified -- returns 403.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Verify profile exists and is tenant-owned
    existing = await db.execute(
        text("""
            SELECT id, is_system
            FROM snmp_profiles
            WHERE id = :profile_id
              AND (tenant_id = :tenant_id OR tenant_id IS NULL)
        """),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SNMP profile not found")
    if row["is_system"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System profiles cannot be modified",
        )

    # Build dynamic SET clause from provided fields
    import json

    updates = {}
    set_clauses = []
    fields = data.model_dump(exclude_unset=True)

    for field, value in fields.items():
        if field == "profile_data" and value is not None:
            set_clauses.append(f"{field} = :{field}::jsonb")
            updates[field] = json.dumps(value)
        else:
            set_clauses.append(f"{field} = :{field}")
            updates[field] = value

    if not set_clauses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    set_clauses.append("updated_at = NOW()")
    updates["profile_id"] = str(profile_id)
    updates["tenant_id"] = str(tenant_id)

    sql = f"""
        UPDATE snmp_profiles
        SET {', '.join(set_clauses)}
        WHERE id = :profile_id AND tenant_id = :tenant_id
        RETURNING id, tenant_id, name, description, sys_object_id, vendor,
                  category, is_system, created_at, updated_at
    """

    result = await db.execute(text(sql), updates)
    await db.commit()
    row = result.mappings().first()
    return dict(row)


# ---------------------------------------------------------------------------
# Delete profile
# ---------------------------------------------------------------------------


@router.delete(
    "/tenants/{tenant_id}/snmp-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a tenant SNMP profile",
    dependencies=[Depends(require_tenant_admin_or_above)],
)
async def delete_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a tenant-scoped SNMP profile.

    System profiles (is_system=True) cannot be deleted -- returns 403.
    Profiles referenced by devices cannot be deleted -- returns 409.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Verify profile exists and is tenant-owned
    existing = await db.execute(
        text("""
            SELECT id, is_system
            FROM snmp_profiles
            WHERE id = :profile_id
              AND (tenant_id = :tenant_id OR tenant_id IS NULL)
        """),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SNMP profile not found")
    if row["is_system"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System profiles cannot be deleted",
        )

    # Check if any devices reference this profile
    ref_check = await db.execute(
        text("""
            SELECT COUNT(*) AS cnt
            FROM devices
            WHERE snmp_profile_id = :profile_id
        """),
        {"profile_id": str(profile_id)},
    )
    count = ref_check.scalar()
    if count and count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete profile: {count} device(s) still reference it",
        )

    await db.execute(
        text("DELETE FROM snmp_profiles WHERE id = :profile_id AND tenant_id = :tenant_id"),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Parse MIB file
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/snmp-profiles/parse-mib",
    response_model=MIBParseResponse,
    summary="Upload and parse a MIB file",
    dependencies=[Depends(require_operator_or_above)],
)
async def parse_mib(
    tenant_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MIBParseResponse:
    """Upload a MIB file and parse it using the tod-mib-parser binary.

    The binary reads the MIB, extracts OID definitions, and returns a JSON
    tree of nodes suitable for building an SNMP profile.

    Returns 422 if the MIB file is invalid or the parser encounters an error.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    tmp_path: str | None = None
    try:
        # Save uploaded file to a temporary path
        with tempfile.NamedTemporaryFile(suffix=".mib", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        # Call the MIB parser binary
        try:
            result = subprocess.run(
                [MIB_PARSER_BINARY, tmp_path],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except FileNotFoundError:
            logger.error("MIB parser binary not found at %s", MIB_PARSER_BINARY)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="MIB parser not available",
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="MIB parser timed out",
            )

        if result.returncode != 0:
            error_msg = result.stderr.strip() or "MIB parser failed"
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=error_msg,
            )

        # Parse the JSON output
        try:
            parsed = json.loads(result.stdout)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="MIB parser returned invalid JSON",
            )

        # Check for parser-level error in the output
        if "error" in parsed and parsed["error"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=parsed["error"],
            )

        # Build response
        nodes = parsed.get("nodes", [])
        return MIBParseResponse(
            module_name=parsed.get("module_name", file.filename or "unknown"),
            nodes=nodes,
            node_count=len(nodes),
        )

    finally:
        # Clean up temporary file
        if tmp_path:
            import os

            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Test profile against live device
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/snmp-profiles/{profile_id}/test",
    response_model=ProfileTestResponse,
    summary="Test an SNMP profile against a live device",
    dependencies=[Depends(require_operator_or_above)],
)
async def test_profile(
    tenant_id: uuid.UUID,
    profile_id: uuid.UUID,
    data: ProfileTestRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileTestResponse:
    """Test connectivity to a device using the provided SNMP credentials.

    Sends an SNMP discovery probe to the target device via the Go poller's
    DiscoveryResponder (NATS request-reply to device.discover.snmp). Returns
    the device's sysObjectID, sysDescr, and sysName if reachable.

    This validates that the device is reachable with the given credentials,
    which is the core requirement for PROF-05.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Verify the profile exists and is visible to this tenant
    result = await db.execute(
        text("""
            SELECT id, sys_object_id
            FROM snmp_profiles
            WHERE id = :profile_id
              AND (tenant_id = :tenant_id OR tenant_id IS NULL)
        """),
        {"profile_id": str(profile_id), "tenant_id": str(tenant_id)},
    )
    profile_row = result.mappings().first()
    if not profile_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SNMP profile not found",
        )

    # Send discovery probe via NATS
    discovery = await snmp_proxy.snmp_discover(
        ip_address=data.ip_address,
        snmp_port=data.snmp_port,
        snmp_version=data.snmp_version,
        community=data.community,
        security_level=data.security_level,
        username=data.username,
        auth_protocol=data.auth_protocol,
        auth_passphrase=data.auth_passphrase,
        priv_protocol=data.priv_protocol,
        priv_passphrase=data.priv_passphrase,
    )

    # Check for discovery error
    if discovery.get("error"):
        return ProfileTestResponse(
            success=False,
            error=discovery["error"],
        )

    # Build device info from discovery response
    device_info = {
        "sys_object_id": discovery.get("sys_object_id", ""),
        "sys_descr": discovery.get("sys_descr", ""),
        "sys_name": discovery.get("sys_name", ""),
    }

    return ProfileTestResponse(
        success=True,
        device_info=device_info,
    )
