"""WireGuard VPN management service.

Handles key generation, peer management, config file sync, and RouterOS command generation.
"""

import base64
import ipaddress
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import structlog
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.device import Device
from app.models.vpn import VpnConfig, VpnPeer
from app.services.crypto import decrypt_credentials, encrypt_credentials, encrypt_credentials_transit

logger = structlog.get_logger(__name__)


# ── Key Generation ──


def generate_wireguard_keypair() -> tuple[str, str]:
    """Generate a WireGuard X25519 keypair. Returns (private_key_b64, public_key_b64)."""
    private_key = X25519PrivateKey.generate()
    priv_bytes = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(priv_bytes).decode(), base64.b64encode(pub_bytes).decode()


def generate_preshared_key() -> str:
    """Generate a WireGuard preshared key (32 random bytes, base64)."""
    return base64.b64encode(os.urandom(32)).decode()


# ── Config File Management ──


def _get_wg_config_path() -> Path:
    """Return the path to the shared WireGuard config directory."""
    return Path(os.getenv("WIREGUARD_CONFIG_PATH", "/data/wireguard"))


async def sync_wireguard_config(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Regenerate wg0.conf from database state and write to shared volume."""
    config = await get_vpn_config(db, tenant_id)
    if not config or not config.is_enabled:
        return

    key_bytes = settings.get_encryption_key_bytes()
    server_private_key = decrypt_credentials(config.server_private_key, key_bytes)

    result = await db.execute(
        select(VpnPeer).where(VpnPeer.tenant_id == tenant_id, VpnPeer.is_enabled.is_(True))
    )
    peers = result.scalars().all()

    # Build wg0.conf
    lines = [
        "[Interface]",
        f"Address = {config.server_address}",
        f"ListenPort = {config.server_port}",
        f"PrivateKey = {server_private_key}",
        "",
    ]

    for peer in peers:
        peer_ip = peer.assigned_ip.split("/")[0]  # strip CIDR for AllowedIPs
        allowed_ips = [f"{peer_ip}/32"]
        if peer.additional_allowed_ips:
            # Comma-separated additional subnets (e.g. site-to-site routing)
            extra = [s.strip() for s in peer.additional_allowed_ips.split(",") if s.strip()]
            allowed_ips.extend(extra)
        lines.append("[Peer]")
        lines.append(f"PublicKey = {peer.peer_public_key}")
        if peer.preshared_key:
            psk = decrypt_credentials(peer.preshared_key, key_bytes)
            lines.append(f"PresharedKey = {psk}")
        lines.append(f"AllowedIPs = {', '.join(allowed_ips)}")
        lines.append("")

    config_dir = _get_wg_config_path()
    wg_confs_dir = config_dir / "wg_confs"
    wg_confs_dir.mkdir(parents=True, exist_ok=True)

    conf_path = wg_confs_dir / "wg0.conf"
    conf_path.write_text("\n".join(lines))

    # Signal WireGuard container to reload config
    reload_flag = wg_confs_dir / ".reload"
    reload_flag.write_text("1")

    logger.info("wireguard config synced", tenant_id=str(tenant_id), peers=len(peers))


# ── Live Status ──


def read_wg_status() -> dict[str, dict]:
    """Read live WireGuard peer status from the shared volume.

    The WireGuard container writes wg_status.json every 15 seconds
    with output from `wg show wg0 dump`. Returns a dict keyed by
    peer public key with handshake timestamp and transfer stats.
    """
    status_path = _get_wg_config_path() / "wg_status.json"
    if not status_path.exists():
        return {}
    try:
        data = json.loads(status_path.read_text())
        return {entry["public_key"]: entry for entry in data}
    except (json.JSONDecodeError, KeyError, OSError):
        return {}


def get_peer_handshake(wg_status: dict[str, dict], public_key: str) -> Optional[datetime]:
    """Get last_handshake datetime for a peer from live WireGuard status."""
    entry = wg_status.get(public_key)
    if not entry:
        return None
    ts = entry.get("last_handshake", 0)
    if ts and ts > 0:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    return None


# ── CRUD Operations ──


async def get_vpn_config(db: AsyncSession, tenant_id: uuid.UUID) -> Optional[VpnConfig]:
    """Get the VPN config for a tenant."""
    result = await db.execute(select(VpnConfig).where(VpnConfig.tenant_id == tenant_id))
    return result.scalar_one_or_none()


async def setup_vpn(
    db: AsyncSession, tenant_id: uuid.UUID, endpoint: Optional[str] = None
) -> VpnConfig:
    """Initialize VPN for a tenant — generates server keys and creates config."""
    existing = await get_vpn_config(db, tenant_id)
    if existing:
        raise ValueError("VPN already configured for this tenant")

    private_key_b64, public_key_b64 = generate_wireguard_keypair()

    key_bytes = settings.get_encryption_key_bytes()
    encrypted_private = encrypt_credentials(private_key_b64, key_bytes)

    config = VpnConfig(
        tenant_id=tenant_id,
        server_private_key=encrypted_private,
        server_public_key=public_key_b64,
        endpoint=endpoint,
        is_enabled=True,
    )
    db.add(config)
    await db.flush()

    await sync_wireguard_config(db, tenant_id)
    return config


async def update_vpn_config(
    db: AsyncSession, tenant_id: uuid.UUID, endpoint: Optional[str] = None, is_enabled: Optional[bool] = None
) -> VpnConfig:
    """Update VPN config settings."""
    config = await get_vpn_config(db, tenant_id)
    if not config:
        raise ValueError("VPN not configured for this tenant")

    if endpoint is not None:
        config.endpoint = endpoint
    if is_enabled is not None:
        config.is_enabled = is_enabled

    await db.flush()
    await sync_wireguard_config(db, tenant_id)
    return config


async def get_peers(db: AsyncSession, tenant_id: uuid.UUID) -> list[VpnPeer]:
    """List all VPN peers for a tenant."""
    result = await db.execute(
        select(VpnPeer).where(VpnPeer.tenant_id == tenant_id).order_by(VpnPeer.created_at)
    )
    return list(result.scalars().all())


async def _next_available_ip(db: AsyncSession, tenant_id: uuid.UUID, config: VpnConfig) -> str:
    """Allocate the next available IP in the VPN subnet."""
    # Parse subnet: e.g. "10.10.0.0/24" → start from .2 (server is .1)
    network = ipaddress.ip_network(config.subnet, strict=False)
    hosts = list(network.hosts())

    # Get already assigned IPs
    result = await db.execute(select(VpnPeer.assigned_ip).where(VpnPeer.tenant_id == tenant_id))
    used_ips = {row[0].split("/")[0] for row in result.all()}
    used_ips.add(config.server_address.split("/")[0])  # exclude server IP

    for host in hosts[1:]:  # skip .1 (server)
        if str(host) not in used_ips:
            return f"{host}/24"

    raise ValueError("No available IPs in VPN subnet")


async def add_peer(db: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID, additional_allowed_ips: Optional[str] = None) -> VpnPeer:
    """Add a device as a VPN peer."""
    config = await get_vpn_config(db, tenant_id)
    if not config:
        raise ValueError("VPN not configured — enable VPN first")

    # Check device exists
    device = await db.execute(select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id))
    if not device.scalar_one_or_none():
        raise ValueError("Device not found")

    # Check if already a peer
    existing = await db.execute(select(VpnPeer).where(VpnPeer.device_id == device_id))
    if existing.scalar_one_or_none():
        raise ValueError("Device is already a VPN peer")

    private_key_b64, public_key_b64 = generate_wireguard_keypair()
    psk = generate_preshared_key()

    key_bytes = settings.get_encryption_key_bytes()
    encrypted_private = encrypt_credentials(private_key_b64, key_bytes)
    encrypted_psk = encrypt_credentials(psk, key_bytes)

    assigned_ip = await _next_available_ip(db, tenant_id, config)

    peer = VpnPeer(
        tenant_id=tenant_id,
        device_id=device_id,
        peer_private_key=encrypted_private,
        peer_public_key=public_key_b64,
        preshared_key=encrypted_psk,
        assigned_ip=assigned_ip,
        additional_allowed_ips=additional_allowed_ips,
    )
    db.add(peer)
    await db.flush()

    await sync_wireguard_config(db, tenant_id)
    return peer


async def remove_peer(db: AsyncSession, tenant_id: uuid.UUID, peer_id: uuid.UUID) -> None:
    """Remove a VPN peer."""
    result = await db.execute(
        select(VpnPeer).where(VpnPeer.id == peer_id, VpnPeer.tenant_id == tenant_id)
    )
    peer = result.scalar_one_or_none()
    if not peer:
        raise ValueError("Peer not found")

    await db.delete(peer)
    await db.flush()
    await sync_wireguard_config(db, tenant_id)


async def get_peer_config(db: AsyncSession, tenant_id: uuid.UUID, peer_id: uuid.UUID) -> dict:
    """Get the full config for a peer — includes private key for device setup."""
    config = await get_vpn_config(db, tenant_id)
    if not config:
        raise ValueError("VPN not configured")

    result = await db.execute(
        select(VpnPeer).where(VpnPeer.id == peer_id, VpnPeer.tenant_id == tenant_id)
    )
    peer = result.scalar_one_or_none()
    if not peer:
        raise ValueError("Peer not found")

    key_bytes = settings.get_encryption_key_bytes()
    private_key = decrypt_credentials(peer.peer_private_key, key_bytes)
    psk = decrypt_credentials(peer.preshared_key, key_bytes) if peer.preshared_key else None

    endpoint = config.endpoint or "YOUR_SERVER_IP:51820"
    peer_ip_no_cidr = peer.assigned_ip.split("/")[0]

    routeros_commands = [
        f'/interface wireguard add name=wg-portal listen-port=13231 private-key="{private_key}"',
        f'/interface wireguard peers add interface=wg-portal public-key="{config.server_public_key}" '
        f'endpoint-address={endpoint.split(":")[0]} endpoint-port={endpoint.split(":")[-1]} '
        f'allowed-address={config.subnet} persistent-keepalive=25'
        + (f' preshared-key="{psk}"' if psk else ""),
        f"/ip address add address={peer.assigned_ip} interface=wg-portal",
    ]

    return {
        "peer_private_key": private_key,
        "peer_public_key": peer.peer_public_key,
        "assigned_ip": peer.assigned_ip,
        "server_public_key": config.server_public_key,
        "server_endpoint": endpoint,
        "allowed_ips": config.subnet,
        "routeros_commands": routeros_commands,
    }


async def onboard_device(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    hostname: str,
    username: str,
    password: str,
) -> dict:
    """Create device + VPN peer in one transaction. Returns device, peer, and RouterOS commands.

    Unlike regular device creation, this skips TCP connectivity checks because
    the VPN tunnel isn't up yet. The device IP is set to the VPN-assigned address.
    """
    config = await get_vpn_config(db, tenant_id)
    if not config:
        raise ValueError("VPN not configured — enable VPN first")

    # Allocate VPN IP before creating device
    assigned_ip = await _next_available_ip(db, tenant_id, config)
    vpn_ip_no_cidr = assigned_ip.split("/")[0]

    # Create device with VPN IP (skip TCP check — tunnel not up yet)
    credentials_json = json.dumps({"username": username, "password": password})
    transit_ciphertext = await encrypt_credentials_transit(credentials_json, str(tenant_id))

    device = Device(
        tenant_id=tenant_id,
        hostname=hostname,
        ip_address=vpn_ip_no_cidr,
        api_port=8728,
        api_ssl_port=8729,
        encrypted_credentials_transit=transit_ciphertext,
        status="unknown",
    )
    db.add(device)
    await db.flush()

    # Create VPN peer linked to this device
    private_key_b64, public_key_b64 = generate_wireguard_keypair()
    psk = generate_preshared_key()

    key_bytes = settings.get_encryption_key_bytes()
    encrypted_private = encrypt_credentials(private_key_b64, key_bytes)
    encrypted_psk = encrypt_credentials(psk, key_bytes)

    peer = VpnPeer(
        tenant_id=tenant_id,
        device_id=device.id,
        peer_private_key=encrypted_private,
        peer_public_key=public_key_b64,
        preshared_key=encrypted_psk,
        assigned_ip=assigned_ip,
    )
    db.add(peer)
    await db.flush()

    await sync_wireguard_config(db, tenant_id)

    # Generate RouterOS commands
    endpoint = config.endpoint or "YOUR_SERVER_IP:51820"
    psk_decrypted = decrypt_credentials(encrypted_psk, key_bytes)

    routeros_commands = [
        f'/interface wireguard add name=wg-portal listen-port=13231 private-key="{private_key_b64}"',
        f'/interface wireguard peers add interface=wg-portal public-key="{config.server_public_key}" '
        f'endpoint-address={endpoint.split(":")[0]} endpoint-port={endpoint.split(":")[-1]} '
        f'allowed-address={config.subnet} persistent-keepalive=25'
        f' preshared-key="{psk_decrypted}"',
        f"/ip address add address={assigned_ip} interface=wg-portal",
    ]

    return {
        "device_id": device.id,
        "peer_id": peer.id,
        "hostname": hostname,
        "assigned_ip": assigned_ip,
        "routeros_commands": routeros_commands,
    }
