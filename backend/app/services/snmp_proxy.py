"""SNMP proxy via NATS request-reply.

Sends SNMP discovery/test requests to the Go poller's DiscoveryResponder
subscription (device.discover.snmp) and returns structured response data.

Used by:
- SNMP profile test endpoint (verify device connectivity with credentials)
"""

import json
import logging
from typing import Any, Optional

import nats
import nats.aio.client

from app.config import settings

logger = logging.getLogger(__name__)

# Module-level NATS connection (lazy initialized)
_nc: nats.aio.client.Client | None = None


async def _get_nats() -> nats.aio.client.Client:
    """Get or create a NATS connection for SNMP proxy requests."""
    global _nc
    if _nc is None or _nc.is_closed:
        _nc = await nats.connect(settings.NATS_URL)
        logger.info("SNMP proxy NATS connection established")
    return _nc


async def snmp_discover(
    ip_address: str,
    snmp_port: int = 161,
    snmp_version: str = "v2c",
    community: Optional[str] = None,
    security_level: Optional[str] = None,
    username: Optional[str] = None,
    auth_protocol: Optional[str] = None,
    auth_passphrase: Optional[str] = None,
    priv_protocol: Optional[str] = None,
    priv_passphrase: Optional[str] = None,
) -> dict[str, Any]:
    """Send an SNMP discovery probe to a device via the Go poller.

    Builds a DiscoveryRequest payload matching the Go DiscoveryRequest struct
    and sends it to the poller's DiscoveryResponder via NATS request-reply.

    Args:
        ip_address: Target device IP address.
        snmp_port: SNMP port (default 161).
        snmp_version: "v1", "v2c", or "v3".
        community: Community string for v1/v2c.
        security_level: SNMPv3 security level.
        username: SNMPv3 username.
        auth_protocol: SNMPv3 auth protocol (e.g. "SHA").
        auth_passphrase: SNMPv3 auth passphrase.
        priv_protocol: SNMPv3 privacy protocol (e.g. "AES").
        priv_passphrase: SNMPv3 privacy passphrase.

    Returns:
        {"sys_object_id": str, "sys_descr": str, "sys_name": str, "error": str|None}
    """
    nc = await _get_nats()

    payload: dict[str, Any] = {
        "ip_address": ip_address,
        "snmp_port": snmp_port,
        "snmp_version": snmp_version,
    }

    # v1/v2c credentials
    if community is not None:
        payload["community"] = community

    # v3 credentials
    if security_level is not None:
        payload["security_level"] = security_level
    if username is not None:
        payload["username"] = username
    if auth_protocol is not None:
        payload["auth_protocol"] = auth_protocol
    if auth_passphrase is not None:
        payload["auth_passphrase"] = auth_passphrase
    if priv_protocol is not None:
        payload["priv_protocol"] = priv_protocol
    if priv_passphrase is not None:
        payload["priv_passphrase"] = priv_passphrase

    try:
        reply = await nc.request(
            "device.discover.snmp",
            json.dumps(payload).encode(),
            timeout=10.0,
        )
        return json.loads(reply.data)
    except nats.errors.TimeoutError:
        return {"error": "Device unreachable or SNMP timeout"}
    except Exception as exc:
        logger.error("SNMP discovery NATS request failed for %s: %s", ip_address, exc)
        return {"error": str(exc)}


async def close() -> None:
    """Close the NATS connection. Called on application shutdown."""
    global _nc
    if _nc and not _nc.is_closed:
        await _nc.drain()
        _nc = None
        logger.info("SNMP proxy NATS connection closed")
