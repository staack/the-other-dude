"""RouterOS command proxy via NATS request-reply.

Sends command requests to the Go poller's CmdResponder subscription
(device.cmd.{device_id}) and returns structured RouterOS API response data.

Used by:
- Config editor API (browse menu paths, add/edit/delete entries)
- Template push service (execute rendered template commands)
"""

import json
import logging
from typing import Any

import nats
import nats.aio.client

from app.config import settings

logger = logging.getLogger(__name__)

# Module-level NATS connection (lazy initialized)
_nc: nats.aio.client.Client | None = None


async def _get_nats() -> nats.aio.client.Client:
    """Get or create a NATS connection for command proxy requests."""
    global _nc
    if _nc is None or _nc.is_closed:
        _nc = await nats.connect(settings.NATS_URL)
        logger.info("RouterOS proxy NATS connection established")
    return _nc


async def execute_command(
    device_id: str,
    command: str,
    args: list[str] | None = None,
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Execute a RouterOS API command on a device via the Go poller.

    Args:
        device_id: UUID string of the target device.
        command: Full RouterOS API path, e.g. "/ip/address/print".
        args: Optional list of RouterOS API args, e.g. ["=.proplist=.id,address"].
        timeout: NATS request timeout in seconds (default 15s).

    Returns:
        {"success": bool, "data": list[dict], "error": str|None}
    """
    nc = await _get_nats()
    request = {
        "device_id": device_id,
        "command": command,
        "args": args or [],
    }

    try:
        reply = await nc.request(
            f"device.cmd.{device_id}",
            json.dumps(request).encode(),
            timeout=timeout,
        )
        return json.loads(reply.data)
    except nats.errors.TimeoutError:
        return {
            "success": False,
            "data": [],
            "error": "Device command timed out — device may be offline or unreachable",
        }
    except Exception as exc:
        logger.error("NATS request failed for device %s: %s", device_id, exc)
        return {"success": False, "data": [], "error": str(exc)}


async def browse_menu(device_id: str, path: str) -> dict[str, Any]:
    """Browse a RouterOS menu path and return all entries.

    Args:
        device_id: Device UUID string.
        path: RouterOS menu path, e.g. "/ip/address" or "/interface".

    Returns:
        {"success": bool, "data": list[dict], "error": str|None}
    """
    command = f"{path}/print"
    return await execute_command(device_id, command)


async def add_entry(device_id: str, path: str, properties: dict[str, str]) -> dict[str, Any]:
    """Add a new entry to a RouterOS menu path.

    Args:
        device_id: Device UUID.
        path: Menu path, e.g. "/ip/address".
        properties: Key-value pairs for the new entry.

    Returns:
        Command response dict.
    """
    args = [f"={k}={v}" for k, v in properties.items()]
    return await execute_command(device_id, f"{path}/add", args)


async def update_entry(
    device_id: str, path: str, entry_id: str | None, properties: dict[str, str]
) -> dict[str, Any]:
    """Update an existing entry in a RouterOS menu path.

    Args:
        device_id: Device UUID.
        path: Menu path.
        entry_id: RouterOS .id value (e.g. "*1"). None for singleton paths.
        properties: Key-value pairs to update.

    Returns:
        Command response dict.
    """
    id_args = [f"=.id={entry_id}"] if entry_id else []
    args = id_args + [f"={k}={v}" for k, v in properties.items()]
    return await execute_command(device_id, f"{path}/set", args)


async def remove_entry(device_id: str, path: str, entry_id: str) -> dict[str, Any]:
    """Remove an entry from a RouterOS menu path.

    Args:
        device_id: Device UUID.
        path: Menu path.
        entry_id: RouterOS .id value.

    Returns:
        Command response dict.
    """
    return await execute_command(device_id, f"{path}/remove", [f"=.id={entry_id}"])


async def execute_cli(device_id: str, cli_command: str) -> dict[str, Any]:
    """Execute an arbitrary RouterOS CLI command.

    Parses a CLI-style string like '/ping address=8.8.8.8 count=4' into the
    RouterOS API command ('/ping') and args (['=address=8.8.8.8', '=count=4']).

    Args:
        device_id: Device UUID.
        cli_command: Full CLI command string.

    Returns:
        Command response dict.
    """
    parts = cli_command.strip().split()
    command = parts[0]
    # RouterOS API args need '=' prefix: 'address=8.8.8.8' -> '=address=8.8.8.8'
    args = []
    for p in parts[1:]:
        if "=" in p and not p.startswith("="):
            args.append(f"={p}")
        else:
            args.append(p)
    return await execute_command(device_id, command, args=args if args else None)


async def close() -> None:
    """Close the NATS connection. Called on application shutdown."""
    global _nc
    if _nc and not _nc.is_closed:
        await _nc.drain()
        _nc = None
        logger.info("RouterOS proxy NATS connection closed")
