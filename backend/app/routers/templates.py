"""
Config template CRUD, preview, and push API endpoints.

All routes are tenant-scoped under:
    /api/tenants/{tenant_id}/templates/

Provides:
    - GET    /templates              -- list templates (optional tag filter)
    - POST   /templates              -- create a template
    - GET    /templates/{id}         -- get single template
    - PUT    /templates/{id}         -- update a template
    - DELETE /templates/{id}         -- delete a template
    - POST   /templates/{id}/preview -- preview rendered template for a device
    - POST   /templates/{id}/push    -- push template to devices (sequential rollout)
    - GET    /templates/push-status/{rollout_id} -- poll push progress

RLS is enforced via get_db() (app_user engine with tenant context).
RBAC: viewer = read (GET/preview); operator and above = write (POST/PUT/DELETE/push).
"""

import asyncio
import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.middleware.rate_limit import limiter
from app.middleware.rbac import require_min_role, require_scope
from app.middleware.tenant_context import CurrentUser, get_current_user
from app.models.config_template import ConfigTemplate, ConfigTemplateTag, TemplatePushJob
from app.models.device import Device
from app.services import template_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["templates"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_tenant_access(
    current_user: CurrentUser, tenant_id: uuid.UUID, db: AsyncSession
) -> None:
    """Verify the current user is allowed to access the given tenant."""
    if current_user.is_super_admin:
        from app.database import set_tenant_context

        await set_tenant_context(db, str(tenant_id))
        return
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: you do not belong to this tenant.",
        )


def _serialize_template(template: ConfigTemplate, include_content: bool = False) -> dict:
    """Serialize a ConfigTemplate to a response dict."""
    result: dict[str, Any] = {
        "id": str(template.id),
        "name": template.name,
        "description": template.description,
        "tags": [tag.name for tag in template.tags],
        "variable_count": len(template.variables) if template.variables else 0,
        "created_at": template.created_at.isoformat(),
        "updated_at": template.updated_at.isoformat(),
    }
    if include_content:
        result["content"] = template.content
        result["variables"] = template.variables or []
    return result


# ---------------------------------------------------------------------------
# Request/Response schemas
# ---------------------------------------------------------------------------


class VariableDef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    type: str = "string"  # string | ip | integer | boolean | subnet
    default: Optional[str] = None
    description: Optional[str] = None


class TemplateCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    description: Optional[str] = None
    content: str
    variables: list[VariableDef] = []
    tags: list[str] = []


class TemplateUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    description: Optional[str] = None
    content: str
    variables: list[VariableDef] = []
    tags: list[str] = []


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str
    variables: dict[str, str] = {}


class PushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_ids: list[str]
    variables: dict[str, str] = {}


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_id}/templates",
    summary="List config templates",
    dependencies=[require_scope("config:read")],
)
async def list_templates(
    tenant_id: uuid.UUID,
    tag: Optional[str] = Query(None, description="Filter by tag name"),
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List all config templates for a tenant with optional tag filtering."""
    await _check_tenant_access(current_user, tenant_id, db)

    query = (
        select(ConfigTemplate)
        .options(selectinload(ConfigTemplate.tags))
        .where(ConfigTemplate.tenant_id == tenant_id)  # type: ignore[arg-type]
        .order_by(ConfigTemplate.updated_at.desc())
    )

    if tag:
        query = query.where(
            ConfigTemplate.id.in_(  # type: ignore[attr-defined]
                select(ConfigTemplateTag.template_id).where(
                    ConfigTemplateTag.name == tag,
                    ConfigTemplateTag.tenant_id == tenant_id,  # type: ignore[arg-type]
                )
            )
        )

    result = await db.execute(query)
    templates = result.scalars().all()

    return [_serialize_template(t) for t in templates]


@router.post(
    "/tenants/{tenant_id}/templates",
    summary="Create a config template",
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_scope("config:write")],
)
@limiter.limit("20/minute")
async def create_template(
    request: Request,
    tenant_id: uuid.UUID,
    body: TemplateCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new config template with Jinja2 content and variable definitions."""
    await _check_tenant_access(current_user, tenant_id, db)

    # Auto-extract variables from content for comparison
    detected = template_service.extract_variables(body.content)
    provided_names = {v.name for v in body.variables}
    unmatched = set(detected) - provided_names
    if unmatched:
        logger.warning(
            "Template '%s' has undeclared variables: %s (auto-adding as string type)",
            body.name,
            unmatched,
        )

    # Create template
    template = ConfigTemplate(
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        content=body.content,
        variables=[v.model_dump() for v in body.variables],
    )
    db.add(template)
    await db.flush()  # Get the generated ID

    # Create tags
    for tag_name in body.tags:
        tag = ConfigTemplateTag(
            tenant_id=tenant_id,
            name=tag_name,
            template_id=template.id,
        )
        db.add(tag)

    await db.flush()

    # Re-query with tags loaded
    result = await db.execute(
        select(ConfigTemplate)
        .options(selectinload(ConfigTemplate.tags))
        .where(ConfigTemplate.id == template.id)  # type: ignore[arg-type]
    )
    template = result.scalar_one()

    return _serialize_template(template, include_content=True)


@router.get(
    "/tenants/{tenant_id}/templates/{template_id}",
    summary="Get a single config template",
    dependencies=[require_scope("config:read")],
)
async def get_template(
    tenant_id: uuid.UUID,
    template_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get a config template with full content, variables, and tags."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        select(ConfigTemplate)
        .options(selectinload(ConfigTemplate.tags))
        .where(
            ConfigTemplate.id == template_id,  # type: ignore[arg-type]
            ConfigTemplate.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
    )
    template = result.scalar_one_or_none()

    if template is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found",
        )

    return _serialize_template(template, include_content=True)


@router.put(
    "/tenants/{tenant_id}/templates/{template_id}",
    summary="Update a config template",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("20/minute")
async def update_template(
    request: Request,
    tenant_id: uuid.UUID,
    template_id: uuid.UUID,
    body: TemplateUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update an existing config template."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        select(ConfigTemplate)
        .options(selectinload(ConfigTemplate.tags))
        .where(
            ConfigTemplate.id == template_id,  # type: ignore[arg-type]
            ConfigTemplate.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
    )
    template = result.scalar_one_or_none()

    if template is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found",
        )

    # Update fields
    template.name = body.name
    template.description = body.description
    template.content = body.content
    template.variables = [v.model_dump() for v in body.variables]

    # Replace tags: delete old, create new
    await db.execute(
        delete(ConfigTemplateTag).where(
            ConfigTemplateTag.template_id == template_id  # type: ignore[arg-type]
        )
    )
    for tag_name in body.tags:
        tag = ConfigTemplateTag(
            tenant_id=tenant_id,
            name=tag_name,
            template_id=template.id,
        )
        db.add(tag)

    await db.flush()

    # Re-query with fresh tags
    result = await db.execute(
        select(ConfigTemplate)
        .options(selectinload(ConfigTemplate.tags))
        .where(ConfigTemplate.id == template.id)  # type: ignore[arg-type]
    )
    template = result.scalar_one()

    return _serialize_template(template, include_content=True)


@router.delete(
    "/tenants/{tenant_id}/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a config template",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("5/minute")
async def delete_template(
    request: Request,
    tenant_id: uuid.UUID,
    template_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a config template. Tags are cascade-deleted. Push jobs are SET NULL."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        select(ConfigTemplate).where(
            ConfigTemplate.id == template_id,  # type: ignore[arg-type]
            ConfigTemplate.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
    )
    template = result.scalar_one_or_none()

    if template is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found",
        )

    await db.delete(template)


# ---------------------------------------------------------------------------
# Preview & Push endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/tenants/{tenant_id}/templates/{template_id}/preview",
    summary="Preview template rendered for a specific device",
    dependencies=[require_scope("config:read")],
)
async def preview_template(
    tenant_id: uuid.UUID,
    template_id: uuid.UUID,
    body: PreviewRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Render a template with device context and custom variables for preview."""
    await _check_tenant_access(current_user, tenant_id, db)

    # Load template
    result = await db.execute(
        select(ConfigTemplate).where(
            ConfigTemplate.id == template_id,  # type: ignore[arg-type]
            ConfigTemplate.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found",
        )

    # Load device
    result = await db.execute(
        select(Device).where(Device.id == body.device_id)  # type: ignore[arg-type]
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {body.device_id} not found",
        )

    # Validate variables against type definitions
    if template.variables:
        for var_def in template.variables:
            var_name = var_def.get("name", "")
            var_type = var_def.get("type", "string")
            value = body.variables.get(var_name)
            if value is None:
                # Use default if available
                default = var_def.get("default")
                if default is not None:
                    body.variables[var_name] = default
                continue
            error = template_service.validate_variable(var_name, value, var_type)
            if error:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=error,
                )

    # Render
    try:
        rendered = template_service.render_template(
            template.content,
            {
                "hostname": device.hostname,
                "ip_address": device.ip_address,
                "model": device.model,
            },
            body.variables,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Template rendering failed: {exc}",
        )

    return {
        "rendered": rendered,
        "device_hostname": device.hostname,
    }


@router.post(
    "/tenants/{tenant_id}/templates/{template_id}/push",
    summary="Push template to devices (sequential rollout with panic-revert)",
    dependencies=[require_scope("config:write")],
)
@limiter.limit("5/minute")
async def push_template(
    request: Request,
    tenant_id: uuid.UUID,
    template_id: uuid.UUID,
    body: PushRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("operator")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Start a template push to one or more devices.

    Creates push jobs for each device and starts a background sequential rollout.
    Returns the rollout_id for status polling.
    """
    await _check_tenant_access(current_user, tenant_id, db)

    # Load template
    result = await db.execute(
        select(ConfigTemplate).where(
            ConfigTemplate.id == template_id,  # type: ignore[arg-type]
            ConfigTemplate.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found",
        )

    if not body.device_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one device_id is required",
        )

    # Validate variables
    if template.variables:
        for var_def in template.variables:
            var_name = var_def.get("name", "")
            var_type = var_def.get("type", "string")
            value = body.variables.get(var_name)
            if value is None:
                default = var_def.get("default")
                if default is not None:
                    body.variables[var_name] = default
                continue
            error = template_service.validate_variable(var_name, value, var_type)
            if error:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=error,
                )

    rollout_id = uuid.uuid4()
    jobs_created = []

    for device_id_str in body.device_ids:
        # Load device to render template per-device
        result = await db.execute(
            select(Device).where(Device.id == device_id_str)  # type: ignore[arg-type]
        )
        device = result.scalar_one_or_none()
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id_str} not found",
            )

        # Render template with this device's context
        try:
            rendered = template_service.render_template(
                template.content,
                {
                    "hostname": device.hostname,
                    "ip_address": device.ip_address,
                    "model": device.model,
                },
                body.variables,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Template rendering failed for device {device.hostname}: {exc}",
            )

        # Create push job
        job = TemplatePushJob(
            tenant_id=tenant_id,
            template_id=template_id,
            device_id=device.id,
            rollout_id=rollout_id,
            rendered_content=rendered,
            status="pending",
        )
        db.add(job)
        jobs_created.append(
            {
                "job_id": str(job.id),
                "device_id": str(device.id),
                "device_hostname": device.hostname,
            }
        )

    await db.flush()

    # Start background push task
    asyncio.create_task(template_service.push_to_devices(str(rollout_id)))

    return {
        "rollout_id": str(rollout_id),
        "jobs": jobs_created,
    }


@router.get(
    "/tenants/{tenant_id}/templates/push-status/{rollout_id}",
    summary="Poll push progress for a rollout",
    dependencies=[require_scope("config:read")],
)
async def push_status(
    tenant_id: uuid.UUID,
    rollout_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    _role: CurrentUser = Depends(require_min_role("viewer")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return all push job statuses for a rollout with device hostnames."""
    await _check_tenant_access(current_user, tenant_id, db)

    result = await db.execute(
        select(TemplatePushJob, Device.hostname)
        .join(Device, TemplatePushJob.device_id == Device.id)  # type: ignore[arg-type]
        .where(
            TemplatePushJob.rollout_id == rollout_id,  # type: ignore[arg-type]
            TemplatePushJob.tenant_id == tenant_id,  # type: ignore[arg-type]
        )
        .order_by(TemplatePushJob.created_at.asc())
    )
    rows = result.all()

    jobs = []
    for job, hostname in rows:
        jobs.append(
            {
                "device_id": str(job.device_id),
                "hostname": hostname,
                "status": job.status,
                "error_message": job.error_message,
                "started_at": job.started_at.isoformat() if job.started_at else None,
                "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            }
        )

    return {
        "rollout_id": str(rollout_id),
        "jobs": jobs,
    }
