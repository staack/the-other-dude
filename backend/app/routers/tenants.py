"""
Tenant management endpoints.

GET    /api/tenants       — list tenants (super_admin: all; tenant_admin: own only)
POST   /api/tenants       — create tenant (super_admin only)
GET    /api/tenants/{id}  — get tenant detail
PUT    /api/tenants/{id}  — update tenant (super_admin only)
DELETE /api/tenants/{id}  — delete tenant (super_admin only)
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.rate_limit import limiter

from app.database import get_admin_db, get_db
from app.middleware.rbac import require_super_admin, require_tenant_admin_or_above
from app.middleware.tenant_context import CurrentUser
from app.models.device import Device
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import TenantCreate, TenantResponse, TenantUpdate

router = APIRouter(prefix="/tenants", tags=["tenants"])


async def _get_tenant_response(
    tenant: Tenant,
    db: AsyncSession,
) -> TenantResponse:
    """Build a TenantResponse with user and device counts."""
    user_count_result = await db.execute(
        select(func.count(User.id)).where(User.tenant_id == tenant.id)
    )
    user_count = user_count_result.scalar_one() or 0

    device_count_result = await db.execute(
        select(func.count(Device.id)).where(Device.tenant_id == tenant.id)
    )
    device_count = device_count_result.scalar_one() or 0

    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        description=tenant.description,
        contact_email=tenant.contact_email,
        user_count=user_count,
        device_count=device_count,
        created_at=tenant.created_at,
    )


@router.get("", response_model=list[TenantResponse], summary="List tenants")
async def list_tenants(
    current_user: CurrentUser = Depends(require_tenant_admin_or_above),
    db: AsyncSession = Depends(get_admin_db),
) -> list[TenantResponse]:
    """
    List tenants.
    - super_admin: sees all tenants
    - tenant_admin: sees only their own tenant
    """
    if current_user.is_super_admin:
        result = await db.execute(select(Tenant).order_by(Tenant.name))
        tenants = result.scalars().all()
    else:
        if not current_user.tenant_id:
            return []
        result = await db.execute(
            select(Tenant).where(Tenant.id == current_user.tenant_id)
        )
        tenants = result.scalars().all()

    return [await _get_tenant_response(tenant, db) for tenant in tenants]


@router.post("", response_model=TenantResponse, status_code=status.HTTP_201_CREATED, summary="Create a tenant")
@limiter.limit("20/minute")
async def create_tenant(
    request: Request,
    data: TenantCreate,
    current_user: CurrentUser = Depends(require_super_admin),
    db: AsyncSession = Depends(get_admin_db),
) -> TenantResponse:
    """Create a new tenant (super_admin only)."""
    # Check for name uniqueness
    existing = await db.execute(select(Tenant).where(Tenant.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tenant with name '{data.name}' already exists",
        )

    tenant = Tenant(name=data.name, description=data.description, contact_email=data.contact_email)
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)

    # Seed default alert rules for new tenant
    default_rules = [
        ("High CPU Usage", "cpu_load", "gt", 90, 5, "warning"),
        ("High Memory Usage", "memory_used_pct", "gt", 90, 5, "warning"),
        ("High Disk Usage", "disk_used_pct", "gt", 85, 3, "warning"),
        ("Device Offline", "device_offline", "eq", 1, 1, "critical"),
    ]
    for name, metric, operator, threshold, duration, sev in default_rules:
        await db.execute(text("""
            INSERT INTO alert_rules (id, tenant_id, name, metric, operator, threshold, duration_polls, severity, enabled, is_default)
            VALUES (gen_random_uuid(), CAST(:tenant_id AS uuid), :name, :metric, :operator, :threshold, :duration, :severity, TRUE, TRUE)
        """), {
            "tenant_id": str(tenant.id), "name": name, "metric": metric,
            "operator": operator, "threshold": threshold, "duration": duration, "severity": sev,
        })
    await db.commit()

    # Seed starter config templates for new tenant
    await _seed_starter_templates(db, tenant.id)
    await db.commit()

    # Provision OpenBao Transit key for the new tenant (non-blocking)
    try:
        from app.config import settings
        from app.services.key_service import provision_tenant_key

        if settings.OPENBAO_ADDR:
            await provision_tenant_key(db, tenant.id)
            await db.commit()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(
            "OpenBao key provisioning failed for tenant %s (will be provisioned on next startup): %s",
            tenant.id,
            exc,
        )

    return await _get_tenant_response(tenant, db)


@router.get("/{tenant_id}", response_model=TenantResponse, summary="Get tenant detail")
async def get_tenant(
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_tenant_admin_or_above),
    db: AsyncSession = Depends(get_admin_db),
) -> TenantResponse:
    """Get tenant detail. Tenant admins can only view their own tenant."""
    # Enforce tenant_admin can only see their own tenant
    if not current_user.is_super_admin and current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant",
        )

    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    return await _get_tenant_response(tenant, db)


@router.put("/{tenant_id}", response_model=TenantResponse, summary="Update a tenant")
@limiter.limit("20/minute")
async def update_tenant(
    request: Request,
    tenant_id: uuid.UUID,
    data: TenantUpdate,
    current_user: CurrentUser = Depends(require_super_admin),
    db: AsyncSession = Depends(get_admin_db),
) -> TenantResponse:
    """Update tenant (super_admin only)."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    if data.name is not None:
        # Check name uniqueness
        name_check = await db.execute(
            select(Tenant).where(Tenant.name == data.name, Tenant.id != tenant_id)
        )
        if name_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Tenant with name '{data.name}' already exists",
            )
        tenant.name = data.name

    if data.description is not None:
        tenant.description = data.description

    if data.contact_email is not None:
        tenant.contact_email = data.contact_email

    await db.commit()
    await db.refresh(tenant)

    return await _get_tenant_response(tenant, db)


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a tenant")
@limiter.limit("5/minute")
async def delete_tenant(
    request: Request,
    tenant_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_super_admin),
    db: AsyncSession = Depends(get_admin_db),
) -> None:
    """Delete tenant (super_admin only). Cascades to all users and devices."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    # Check if tenant had VPN configured (before cascade deletes it)
    from app.services.vpn_service import get_vpn_config, sync_wireguard_config
    had_vpn = await get_vpn_config(db, tenant_id)

    await db.delete(tenant)
    await db.flush()

    # Regenerate wg0.conf without deleted tenant's peers
    if had_vpn:
        await sync_wireguard_config(db)

    await db.commit()


# ---------------------------------------------------------------------------
# Starter template seeding
# ---------------------------------------------------------------------------

_STARTER_TEMPLATES = [
    {
        "name": "Basic Router",
        "description": "Complete SOHO/branch router setup: WAN on ether1, LAN bridge, DHCP, DNS, NAT, basic firewall",
        "content": """/interface bridge add name=bridge-lan comment="LAN bridge"
/interface bridge port add bridge=bridge-lan interface=ether2
/interface bridge port add bridge=bridge-lan interface=ether3
/interface bridge port add bridge=bridge-lan interface=ether4
/interface bridge port add bridge=bridge-lan interface=ether5

# WAN — DHCP client on ether1
/ip dhcp-client add interface={{ wan_interface }} disabled=no comment="WAN uplink"

# LAN address
/ip address add address={{ lan_gateway }}/{{ lan_cidr }} interface=bridge-lan

# DNS
/ip dns set servers={{ dns_servers }} allow-remote-requests=yes

# DHCP server for LAN
/ip pool add name=lan-pool ranges={{ dhcp_start }}-{{ dhcp_end }}
/ip dhcp-server network add address={{ lan_network }}/{{ lan_cidr }} gateway={{ lan_gateway }} dns-server={{ lan_gateway }}
/ip dhcp-server add name=lan-dhcp interface=bridge-lan address-pool=lan-pool disabled=no

# NAT masquerade
/ip firewall nat add chain=srcnat out-interface={{ wan_interface }} action=masquerade

# Firewall — input chain
/ip firewall filter
add chain=input connection-state=established,related action=accept
add chain=input connection-state=invalid action=drop
add chain=input in-interface={{ wan_interface }} action=drop comment="Drop all other WAN input"

# Firewall — forward chain
add chain=forward connection-state=established,related action=accept
add chain=forward connection-state=invalid action=drop
add chain=forward in-interface=bridge-lan out-interface={{ wan_interface }} action=accept comment="Allow LAN to WAN"
add chain=forward action=drop comment="Drop everything else"

# NTP
/system ntp client set enabled=yes servers={{ ntp_server }}

# Identity
/system identity set name={{ device.hostname }}""",
        "variables": [
            {"name": "wan_interface", "type": "string", "default": "ether1", "description": "WAN-facing interface"},
            {"name": "lan_gateway", "type": "ip", "default": "192.168.88.1", "description": "LAN gateway IP"},
            {"name": "lan_cidr", "type": "integer", "default": "24", "description": "LAN subnet mask bits"},
            {"name": "lan_network", "type": "ip", "default": "192.168.88.0", "description": "LAN network address"},
            {"name": "dhcp_start", "type": "ip", "default": "192.168.88.100", "description": "DHCP pool start"},
            {"name": "dhcp_end", "type": "ip", "default": "192.168.88.254", "description": "DHCP pool end"},
            {"name": "dns_servers", "type": "string", "default": "8.8.8.8,8.8.4.4", "description": "Upstream DNS servers"},
            {"name": "ntp_server", "type": "string", "default": "pool.ntp.org", "description": "NTP server"},
        ],
    },
    {
        "name": "Basic Firewall",
        "description": "Standard firewall ruleset with WAN protection and LAN forwarding",
        "content": """/ip firewall filter
add chain=input connection-state=established,related action=accept
add chain=input connection-state=invalid action=drop
add chain=input in-interface={{ wan_interface }} protocol=tcp dst-port=8291 action=drop comment="Block Winbox from WAN"
add chain=input in-interface={{ wan_interface }} protocol=tcp dst-port=22 action=drop comment="Block SSH from WAN"
add chain=forward connection-state=established,related action=accept
add chain=forward connection-state=invalid action=drop
add chain=forward src-address={{ allowed_network }} action=accept
add chain=forward action=drop""",
        "variables": [
            {"name": "wan_interface", "type": "string", "default": "ether1", "description": "WAN-facing interface"},
            {"name": "allowed_network", "type": "subnet", "default": "192.168.88.0/24", "description": "Allowed source network"},
        ],
    },
    {
        "name": "DHCP Server Setup",
        "description": "Configure DHCP server with address pool, DNS, and gateway",
        "content": """/ip pool add name=dhcp-pool ranges={{ pool_start }}-{{ pool_end }}
/ip dhcp-server network add address={{ gateway }}/24 gateway={{ gateway }} dns-server={{ dns_server }}
/ip dhcp-server add name=dhcp1 interface={{ interface }} address-pool=dhcp-pool disabled=no""",
        "variables": [
            {"name": "pool_start", "type": "ip", "default": "192.168.88.100", "description": "DHCP pool start address"},
            {"name": "pool_end", "type": "ip", "default": "192.168.88.254", "description": "DHCP pool end address"},
            {"name": "gateway", "type": "ip", "default": "192.168.88.1", "description": "Default gateway"},
            {"name": "dns_server", "type": "ip", "default": "8.8.8.8", "description": "DNS server address"},
            {"name": "interface", "type": "string", "default": "bridge-lan", "description": "Interface to serve DHCP on"},
        ],
    },
    {
        "name": "Wireless AP Config",
        "description": "Configure wireless access point with WPA2 security",
        "content": """/interface wireless security-profiles add name=portal-wpa2 mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key={{ password }}
/interface wireless set wlan1 mode=ap-bridge ssid={{ ssid }} security-profile=portal-wpa2 frequency={{ frequency }} channel-width={{ channel_width }} disabled=no""",
        "variables": [
            {"name": "ssid", "type": "string", "default": "MikroTik-AP", "description": "Wireless network name"},
            {"name": "password", "type": "string", "default": "", "description": "WPA2 pre-shared key (min 8 characters)"},
            {"name": "frequency", "type": "integer", "default": "2412", "description": "Wireless frequency in MHz"},
            {"name": "channel_width", "type": "string", "default": "20/40mhz-XX", "description": "Channel width setting"},
        ],
    },
    {
        "name": "Initial Device Setup",
        "description": "Set device identity, NTP, DNS, and disable unused services",
        "content": """/system identity set name={{ device.hostname }}
/system ntp client set enabled=yes servers={{ ntp_server }}
/ip dns set servers={{ dns_servers }} allow-remote-requests=no
/ip service disable telnet,ftp,www,api-ssl
/ip service set ssh port=22
/ip service set winbox port=8291""",
        "variables": [
            {"name": "ntp_server", "type": "ip", "default": "pool.ntp.org", "description": "NTP server address"},
            {"name": "dns_servers", "type": "string", "default": "8.8.8.8,8.8.4.4", "description": "Comma-separated DNS servers"},
        ],
    },
]


async def _seed_starter_templates(db, tenant_id) -> None:
    """Insert starter config templates for a newly created tenant."""
    import json as _json

    for tmpl in _STARTER_TEMPLATES:
        await db.execute(text("""
            INSERT INTO config_templates (id, tenant_id, name, description, content, variables)
            VALUES (gen_random_uuid(), CAST(:tid AS uuid), :name, :desc, :content, CAST(:vars AS jsonb))
        """), {
            "tid": str(tenant_id),
            "name": tmpl["name"],
            "desc": tmpl["description"],
            "content": tmpl["content"],
            "vars": _json.dumps(tmpl["variables"]),
        })
