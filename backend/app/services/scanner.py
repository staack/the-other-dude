"""
Subnet scanner for MikroTik device discovery.

Scans a CIDR range by attempting TCP connections to RouterOS API ports
(8728 and 8729) with configurable concurrency limits and timeouts.

Security constraints:
- CIDR range limited to /20 or smaller (4096 IPs maximum)
- Maximum 50 concurrent connections to prevent network flooding
- 2-second timeout per connection attempt
"""

import asyncio
import ipaddress
import socket
from typing import Optional

from app.schemas.device import SubnetScanResult

# Maximum concurrency for TCP probes
_MAX_CONCURRENT = 50
# Timeout (seconds) per TCP connection attempt
_TCP_TIMEOUT = 2.0
# RouterOS API port
_API_PORT = 8728
# RouterOS SSL API port
_SSL_PORT = 8729


async def _probe_host(
    semaphore: asyncio.Semaphore,
    ip_str: str,
) -> Optional[SubnetScanResult]:
    """
    Probe a single IP for RouterOS API ports.

    Returns a SubnetScanResult if either port is open, None otherwise.
    """
    async with semaphore:
        api_open, ssl_open = await asyncio.gather(
            _tcp_connect(ip_str, _API_PORT),
            _tcp_connect(ip_str, _SSL_PORT),
            return_exceptions=False,
        )

        if not api_open and not ssl_open:
            return None

        # Attempt reverse DNS (best-effort; won't fail the scan)
        hostname = await _reverse_dns(ip_str)

        return SubnetScanResult(
            ip_address=ip_str,
            hostname=hostname,
            api_port_open=api_open,
            api_ssl_port_open=ssl_open,
        )


async def _tcp_connect(ip: str, port: int) -> bool:
    """Return True if a TCP connection to ip:port succeeds within _TCP_TIMEOUT."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port),
            timeout=_TCP_TIMEOUT,
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


async def _reverse_dns(ip: str) -> Optional[str]:
    """Attempt a reverse DNS lookup. Returns None on failure."""
    try:
        loop = asyncio.get_running_loop()
        hostname, _, _ = await asyncio.wait_for(
            loop.run_in_executor(None, socket.gethostbyaddr, ip),
            timeout=1.5,
        )
        return hostname
    except Exception:
        return None


async def scan_subnet(cidr: str) -> list[SubnetScanResult]:
    """
    Scan a CIDR range for hosts with open RouterOS API ports.

    Args:
        cidr: CIDR notation string, e.g. "192.168.1.0/24".
              Must be /20 or smaller (validated by SubnetScanRequest).

    Returns:
        List of SubnetScanResult for each host with at least one open API port.

    Raises:
        ValueError: If CIDR is malformed or too large.
    """
    try:
        network = ipaddress.ip_network(cidr, strict=False)
    except ValueError as e:
        raise ValueError(f"Invalid CIDR: {e}") from e

    if network.num_addresses > 4096:
        raise ValueError(
            f"CIDR range too large ({network.num_addresses} addresses). "
            "Maximum allowed is /20 (4096 addresses)."
        )

    # Skip network address and broadcast address for IPv4
    hosts = list(network.hosts()) if network.num_addresses > 2 else list(network)

    semaphore = asyncio.Semaphore(_MAX_CONCURRENT)
    tasks = [_probe_host(semaphore, str(ip)) for ip in hosts]

    results = await asyncio.gather(*tasks, return_exceptions=False)

    # Filter out None (hosts with no open ports)
    return [r for r in results if r is not None]
