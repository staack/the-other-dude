"""Certificate Authority management API endpoints.

Provides the full certificate lifecycle for tenant CAs:
- CA initialization and info retrieval
- Per-device certificate signing
- Certificate deployment via NATS to Go poller (SFTP + RouterOS import)
- Bulk deployment across multiple devices
- Certificate rotation and revocation

RLS enforced via get_db() (app_user engine with tenant context).
RBAC: viewer = read-only (GET); tenant_admin and above = mutating actions.
"""

import json
import uuid

import nats
import nats.aio.client
import nats.errors
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db, set_tenant_context
from app.middleware.rate_limit import limiter
from app.middleware.rbac import require_min_role
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.certificate import DeviceCertificate
from app.models.device import Device
from app.schemas.certificate import (
    BulkCertDeployRequest,
    CACreateRequest,
    CAResponse,
    CertDeployResponse,
    CertSignRequest,
    DeviceCertResponse,
)
from app.services.audit_service import log_action
from app.services.ca_service import (
    generate_ca,
    get_ca_for_tenant,
    get_cert_for_deploy,
    get_device_certs,
    sign_device_cert,
    update_cert_status,
)

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["certificates"])

# Module-level NATS connection for cert deployment (lazy initialized)
_nc: nats.aio.client.Client | None = None


async def _get_nats() -> nats.aio.client.Client:
    """Get or create a NATS connection for certificate deployment requests."""
    global _nc
    if _nc is None or _nc.is_closed:
        _nc = await nats.connect(settings.NATS_URL)
        logger.info("Certificate NATS connection established")
    return _nc


async def _deploy_cert_via_nats(
    device_id: str,
    cert_pem: str,
    key_pem: str,
    cert_name: str,
    ssh_port: int = 22,
) -> dict:
    """Send a certificate deployment request to the Go poller via NATS.

    Args:
        device_id: Target device UUID string.
        cert_pem: PEM-encoded device certificate.
        key_pem: PEM-encoded device private key (decrypted).
        cert_name: Name for the cert on the device (e.g., "portal-device-cert").
        ssh_port: SSH port for SFTP upload (default 22).

    Returns:
        Dict with success, cert_name_on_device, and error fields.
    """
    nc = await _get_nats()
    payload = json.dumps(
        {
            "device_id": device_id,
            "cert_pem": cert_pem,
            "key_pem": key_pem,
            "cert_name": cert_name,
            "ssh_port": ssh_port,
        }
    ).encode()

    try:
        reply = await nc.request(
            f"cert.deploy.{device_id}",
            payload,
            timeout=60.0,
        )
        return json.loads(reply.data)
    except nats.errors.TimeoutError:
        return {
            "success": False,
            "error": "Certificate deployment timed out -- device may be offline or unreachable",
        }
    except Exception as exc:
        logger.error("NATS cert deploy request failed", device_id=device_id, error=str(exc))
        return {"success": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_device_for_tenant(
    db: AsyncSession, device_id: uuid.UUID, current_user: CurrentUser
) -> Device:
    """Fetch a device and verify tenant ownership."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found",
        )
    return device


async def _get_tenant_id(
    current_user: CurrentUser,
    db: AsyncSession,
    tenant_id_override: uuid.UUID | None = None,
) -> uuid.UUID:
    """Extract tenant_id from the current user, handling super_admin.

    Super admins must provide tenant_id_override (from query param).
    Regular users use their own tenant_id.
    """
    if current_user.is_super_admin:
        if tenant_id_override is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Super admin must provide tenant_id query parameter.",
            )
        # Set RLS context for the selected tenant
        await set_tenant_context(db, str(tenant_id_override))
        return tenant_id_override
    if current_user.tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tenant context available.",
        )
    return current_user.tenant_id


async def _get_cert_with_tenant_check(
    db: AsyncSession, cert_id: uuid.UUID, tenant_id: uuid.UUID
) -> DeviceCertificate:
    """Fetch a device certificate and verify tenant ownership."""
    result = await db.execute(select(DeviceCertificate).where(DeviceCertificate.id == cert_id))
    cert = result.scalar_one_or_none()
    if cert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Certificate {cert_id} not found",
        )
    # RLS should enforce this, but double-check
    if cert.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Certificate {cert_id} not found",
        )
    return cert


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/ca",
    response_model=CAResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Initialize a Certificate Authority for the tenant",
)
@limiter.limit("5/minute")
async def create_ca(
    request: Request,
    body: CACreateRequest,
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
    db: AsyncSession = Depends(get_db),
) -> CAResponse:
    """Generate a self-signed root CA for the tenant.

    Each tenant may have at most one CA. Returns 409 if a CA already exists.
    """
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)

    # Check if CA already exists
    existing = await get_ca_for_tenant(db, tenant_id)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tenant already has a Certificate Authority. Delete it before creating a new one.",
        )

    ca = await generate_ca(
        db,
        tenant_id,
        body.common_name,
        body.validity_years,
        settings.get_encryption_key_bytes(),
    )

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "ca_create",
            resource_type="certificate_authority",
            resource_id=str(ca.id),
            details={"common_name": body.common_name, "validity_years": body.validity_years},
        )
    except Exception:
        pass

    logger.info("CA created", tenant_id=str(tenant_id), ca_id=str(ca.id))
    return CAResponse.model_validate(ca)


@router.get(
    "/ca",
    response_model=CAResponse,
    summary="Get tenant CA information",
)
async def get_ca(
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> CAResponse:
    """Return the tenant's CA public information (no private key)."""
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)
    ca = await get_ca_for_tenant(db, tenant_id)
    if ca is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Certificate Authority configured for this tenant.",
        )
    return CAResponse.model_validate(ca)


@router.get(
    "/ca/pem",
    response_class=PlainTextResponse,
    summary="Download the CA public certificate (PEM)",
)
async def get_ca_pem(
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    """Return the CA's public certificate in PEM format.

    Users can import this into their trust store to validate device connections.
    """
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)
    ca = await get_ca_for_tenant(db, tenant_id)
    if ca is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Certificate Authority configured for this tenant.",
        )
    return PlainTextResponse(
        content=ca.cert_pem,
        media_type="application/x-pem-file",
        headers={"Content-Disposition": "attachment; filename=portal-ca.pem"},
    )


@router.post(
    "/sign",
    response_model=DeviceCertResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Sign a certificate for a device",
)
@limiter.limit("20/minute")
async def sign_cert(
    request: Request,
    body: CertSignRequest,
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
    db: AsyncSession = Depends(get_db),
) -> DeviceCertResponse:
    """Sign a per-device TLS certificate using the tenant's CA.

    The device must belong to the tenant. The cert uses CN=hostname, SAN=IP+DNS.
    """
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)

    # Verify device belongs to tenant (RLS enforces, but also get device data)
    device = await _get_device_for_tenant(db, body.device_id, current_user)

    # Get tenant CA
    ca = await get_ca_for_tenant(db, tenant_id)
    if ca is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Certificate Authority configured. Initialize a CA first.",
        )

    cert = await sign_device_cert(
        db,
        ca,
        body.device_id,
        device.hostname,
        device.ip_address,
        body.validity_days,
        settings.get_encryption_key_bytes(),
    )

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "cert_sign",
            resource_type="device_certificate",
            resource_id=str(cert.id),
            device_id=body.device_id,
            details={"hostname": device.hostname, "validity_days": body.validity_days},
        )
    except Exception:
        pass

    logger.info("Device cert signed", device_id=str(body.device_id), cert_id=str(cert.id))
    return DeviceCertResponse.model_validate(cert)


@router.post(
    "/{cert_id}/deploy",
    response_model=CertDeployResponse,
    summary="Deploy a signed certificate to a device",
)
@limiter.limit("20/minute")
async def deploy_cert(
    request: Request,
    cert_id: uuid.UUID,
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
    db: AsyncSession = Depends(get_db),
) -> CertDeployResponse:
    """Deploy a signed certificate to a device via NATS/SFTP.

    The Go poller receives the cert, uploads it via SFTP, imports it,
    and assigns it to the api-ssl service on the RouterOS device.
    """
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)
    cert = await _get_cert_with_tenant_check(db, cert_id, tenant_id)

    # Update status to deploying
    try:
        await update_cert_status(db, cert_id, "deploying")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )

    # Get decrypted cert data for deployment
    try:
        cert_pem, key_pem, _ca_cert_pem = await get_cert_for_deploy(
            db, cert_id, settings.get_encryption_key_bytes()
        )
    except ValueError as e:
        # Rollback status
        await update_cert_status(db, cert_id, "issued")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to prepare cert for deployment: {e}",
        )

    # Flush DB changes before NATS call so deploying status is persisted
    await db.flush()

    # Send deployment command via NATS
    result = await _deploy_cert_via_nats(
        device_id=str(cert.device_id),
        cert_pem=cert_pem,
        key_pem=key_pem,
        cert_name="portal-device-cert",
    )

    if result.get("success"):
        # Update cert status to deployed
        await update_cert_status(db, cert_id, "deployed")

        # Update device tls_mode to portal_ca
        device_result = await db.execute(select(Device).where(Device.id == cert.device_id))
        device = device_result.scalar_one_or_none()
        if device is not None:
            device.tls_mode = "portal_ca"

        try:
            await log_action(
                db,
                tenant_id,
                current_user.user_id,
                "cert_deploy",
                resource_type="device_certificate",
                resource_id=str(cert_id),
                device_id=cert.device_id,
                details={"cert_name_on_device": result.get("cert_name_on_device")},
            )
        except Exception:
            pass

        logger.info(
            "Certificate deployed successfully",
            cert_id=str(cert_id),
            device_id=str(cert.device_id),
            cert_name_on_device=result.get("cert_name_on_device"),
        )

        return CertDeployResponse(
            success=True,
            device_id=cert.device_id,
            cert_name_on_device=result.get("cert_name_on_device"),
        )
    else:
        # Rollback status to issued
        await update_cert_status(db, cert_id, "issued")

        logger.warning(
            "Certificate deployment failed",
            cert_id=str(cert_id),
            device_id=str(cert.device_id),
            error=result.get("error"),
        )

        return CertDeployResponse(
            success=False,
            device_id=cert.device_id,
            error=result.get("error"),
        )


@router.post(
    "/deploy/bulk",
    response_model=list[CertDeployResponse],
    summary="Bulk deploy certificates to multiple devices",
)
@limiter.limit("5/minute")
async def bulk_deploy(
    request: Request,
    body: BulkCertDeployRequest,
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
    db: AsyncSession = Depends(get_db),
) -> list[CertDeployResponse]:
    """Deploy certificates to multiple devices sequentially.

    For each device: signs a cert if none exists (status=issued), then deploys.
    Sequential deployment per project patterns (no concurrent NATS calls).
    """
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)

    # Get tenant CA
    ca = await get_ca_for_tenant(db, tenant_id)
    if ca is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Certificate Authority configured. Initialize a CA first.",
        )

    results: list[CertDeployResponse] = []

    for device_id in body.device_ids:
        try:
            # Get device info
            device = await _get_device_for_tenant(db, device_id, current_user)

            # Check if device already has an issued cert
            existing_certs = await get_device_certs(db, tenant_id, device_id)
            issued_cert = None
            for c in existing_certs:
                if c.status == "issued":
                    issued_cert = c
                    break

            # Sign a new cert if none exists in issued state
            if issued_cert is None:
                issued_cert = await sign_device_cert(
                    db,
                    ca,
                    device_id,
                    device.hostname,
                    device.ip_address,
                    730,  # Default 2 years
                    settings.get_encryption_key_bytes(),
                )
                await db.flush()

            # Deploy the cert
            await update_cert_status(db, issued_cert.id, "deploying")

            cert_pem, key_pem, _ca_cert_pem = await get_cert_for_deploy(
                db, issued_cert.id, settings.get_encryption_key_bytes()
            )

            await db.flush()

            result = await _deploy_cert_via_nats(
                device_id=str(device_id),
                cert_pem=cert_pem,
                key_pem=key_pem,
                cert_name="portal-device-cert",
            )

            if result.get("success"):
                await update_cert_status(db, issued_cert.id, "deployed")
                device.tls_mode = "portal_ca"

                results.append(
                    CertDeployResponse(
                        success=True,
                        device_id=device_id,
                        cert_name_on_device=result.get("cert_name_on_device"),
                    )
                )
            else:
                await update_cert_status(db, issued_cert.id, "issued")
                results.append(
                    CertDeployResponse(
                        success=False,
                        device_id=device_id,
                        error=result.get("error"),
                    )
                )

        except HTTPException as e:
            results.append(
                CertDeployResponse(
                    success=False,
                    device_id=device_id,
                    error=e.detail,
                )
            )
        except Exception as e:
            logger.error("Bulk deploy error", device_id=str(device_id), error=str(e))
            results.append(
                CertDeployResponse(
                    success=False,
                    device_id=device_id,
                    error=str(e),
                )
            )

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "cert_bulk_deploy",
            resource_type="device_certificate",
            details={
                "device_count": len(body.device_ids),
                "successful": sum(1 for r in results if r.success),
                "failed": sum(1 for r in results if not r.success),
            },
        )
    except Exception:
        pass

    return results


@router.get(
    "/devices",
    response_model=list[DeviceCertResponse],
    summary="List device certificates",
)
async def list_device_certs(
    device_id: uuid.UUID | None = Query(None, description="Filter by device ID"),
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceCertResponse]:
    """List device certificates for the tenant.

    Optionally filter by device_id. Excludes superseded certs.
    """
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)
    certs = await get_device_certs(db, tenant_id, device_id)
    return [DeviceCertResponse.model_validate(c) for c in certs]


@router.post(
    "/{cert_id}/revoke",
    response_model=DeviceCertResponse,
    summary="Revoke a device certificate",
)
@limiter.limit("5/minute")
async def revoke_cert(
    request: Request,
    cert_id: uuid.UUID,
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
    db: AsyncSession = Depends(get_db),
) -> DeviceCertResponse:
    """Revoke a device certificate and reset the device TLS mode to insecure."""
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)
    cert = await _get_cert_with_tenant_check(db, cert_id, tenant_id)

    try:
        updated_cert = await update_cert_status(db, cert_id, "revoked")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )

    # Reset device tls_mode to insecure
    device_result = await db.execute(select(Device).where(Device.id == cert.device_id))
    device = device_result.scalar_one_or_none()
    if device is not None:
        device.tls_mode = "insecure"

    try:
        await log_action(
            db,
            tenant_id,
            current_user.user_id,
            "cert_revoke",
            resource_type="device_certificate",
            resource_id=str(cert_id),
            device_id=cert.device_id,
        )
    except Exception:
        pass

    logger.info("Certificate revoked", cert_id=str(cert_id), device_id=str(cert.device_id))
    return DeviceCertResponse.model_validate(updated_cert)


@router.post(
    "/{cert_id}/rotate",
    response_model=CertDeployResponse,
    summary="Rotate a device certificate",
)
@limiter.limit("5/minute")
async def rotate_cert(
    request: Request,
    cert_id: uuid.UUID,
    tenant_id: uuid.UUID | None = Query(None, description="Tenant ID (required for super_admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("tenant_admin")),
    db: AsyncSession = Depends(get_db),
) -> CertDeployResponse:
    """Rotate a device certificate: supersede the old cert, sign a new one, and deploy it.

    This is equivalent to: mark old cert as superseded, sign new cert, deploy new cert.
    """
    tenant_id = await _get_tenant_id(current_user, db, tenant_id)
    old_cert = await _get_cert_with_tenant_check(db, cert_id, tenant_id)

    # Get the device for hostname/IP
    device_result = await db.execute(select(Device).where(Device.id == old_cert.device_id))
    device = device_result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {old_cert.device_id} not found",
        )

    # Get tenant CA
    ca = await get_ca_for_tenant(db, tenant_id)
    if ca is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Certificate Authority configured.",
        )

    # Mark old cert as superseded
    try:
        await update_cert_status(db, cert_id, "superseded")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )

    # Sign new cert
    new_cert = await sign_device_cert(
        db,
        ca,
        old_cert.device_id,
        device.hostname,
        device.ip_address,
        730,  # Default 2 years
        settings.get_encryption_key_bytes(),
    )
    await db.flush()

    # Deploy new cert
    await update_cert_status(db, new_cert.id, "deploying")

    cert_pem, key_pem, _ca_cert_pem = await get_cert_for_deploy(
        db, new_cert.id, settings.get_encryption_key_bytes()
    )

    await db.flush()

    result = await _deploy_cert_via_nats(
        device_id=str(old_cert.device_id),
        cert_pem=cert_pem,
        key_pem=key_pem,
        cert_name="portal-device-cert",
    )

    if result.get("success"):
        await update_cert_status(db, new_cert.id, "deployed")
        device.tls_mode = "portal_ca"

        try:
            await log_action(
                db,
                tenant_id,
                current_user.user_id,
                "cert_rotate",
                resource_type="device_certificate",
                resource_id=str(new_cert.id),
                device_id=old_cert.device_id,
                details={
                    "old_cert_id": str(cert_id),
                    "cert_name_on_device": result.get("cert_name_on_device"),
                },
            )
        except Exception:
            pass

        logger.info(
            "Certificate rotated successfully",
            old_cert_id=str(cert_id),
            new_cert_id=str(new_cert.id),
            device_id=str(old_cert.device_id),
        )

        return CertDeployResponse(
            success=True,
            device_id=old_cert.device_id,
            cert_name_on_device=result.get("cert_name_on_device"),
        )
    else:
        # Rollback: mark new cert as issued (deploy failed)
        await update_cert_status(db, new_cert.id, "issued")

        logger.warning(
            "Certificate rotation deploy failed",
            new_cert_id=str(new_cert.id),
            device_id=str(old_cert.device_id),
            error=result.get("error"),
        )

        return CertDeployResponse(
            success=False,
            device_id=old_cert.device_id,
            error=result.get("error"),
        )
