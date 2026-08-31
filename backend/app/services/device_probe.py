"""RouterOS connectivity probe via NATS request-reply.

Asks the Go poller to complete a real protocol handshake -- TCP, TLS and a
RouterOS API login -- against a device, and returns a staged, classified result.

Why the poller and not here: the failure this exists to catch is a property of
Go's crypto/tls, which implements no anonymous cipher suites. A RouterOS device
with `api-ssl` enabled and `certificate=none` offers only anonymous-DH ciphers.
Python's OpenSSL bindings negotiate those happily, so a probe written here would
pronounce such a device healthy -- and the poller would then fail every poll.
Probing from the poller means the check and the poll are the same code path and
cannot disagree.

Two subjects:
- ``device.probe.routeros``            -- onboarding; parameters in the request,
                                          because the device is not stored yet.
- ``device.probe.stored.{device_id}``  -- test-connection; the poller reads the
                                          device's own settings and credentials.
"""

import json
import logging
from dataclasses import dataclass
from typing import Any, Optional

import nats
import nats.aio.client

from app.config import settings

logger = logging.getLogger(__name__)

# Module-level NATS connection (lazy initialized), mirroring routeros_proxy.
_nc: nats.aio.client.Client | None = None

# Default wait for a probe reply. The poller caps its own probe at 30s; this
# allows for that plus the plain-mode verification it may run afterwards.
DEFAULT_PROBE_TIMEOUT = 45.0


@dataclass
class ProbeOutcome:
    """The result of a live device probe.

    ``ok`` means a full RouterOS API handshake completed. ``probe_available``
    distinguishes "the device failed" from "we could not ask" -- a poller
    outage must never be reported as a device fault.
    """

    ok: bool
    stage: str
    reason: str
    message: str
    detail: Optional[str]
    tls_mode: str
    suggested_tls_mode: Optional[str]
    identity: Optional[str]
    version: Optional[str]
    board_name: Optional[str]
    elapsed_ms: int
    probe_available: bool

    @classmethod
    def from_reply(cls, payload: dict[str, Any]) -> "ProbeOutcome":
        """Build an outcome from the poller's JSON reply."""
        # An `error` field means the responder rejected the request (bad
        # payload, unknown device, undecryptable credentials). That is not a
        # verdict on the device.
        error = payload.get("error")
        if error:
            return cls.unavailable(error)

        return cls(
            ok=bool(payload.get("ok", False)),
            stage=payload.get("stage", "unknown"),
            reason=payload.get("reason", "unknown"),
            message=payload.get("message", ""),
            detail=payload.get("detail"),
            tls_mode=payload.get("tls_mode", ""),
            suggested_tls_mode=payload.get("suggested_tls_mode") or None,
            identity=payload.get("identity") or None,
            version=payload.get("version") or None,
            board_name=payload.get("board_name") or None,
            elapsed_ms=int(payload.get("elapsed_ms", 0)),
            probe_available=True,
        )

    @classmethod
    def unavailable(cls, message: str, tls_mode: str = "") -> "ProbeOutcome":
        """The probe could not be run at all."""
        return cls(
            ok=False,
            stage="unknown",
            reason="probe_unavailable",
            message=message,
            detail=None,
            tls_mode=tls_mode,
            suggested_tls_mode=None,
            identity=None,
            version=None,
            board_name=None,
            elapsed_ms=0,
            probe_available=False,
        )


async def _get_nats() -> nats.aio.client.Client:
    """Get or create a NATS connection for probe requests."""
    global _nc
    if _nc is None or _nc.is_closed:
        _nc = await nats.connect(settings.NATS_URL)
        logger.info("Device probe NATS connection established")
    return _nc


async def _request(subject: str, payload: dict[str, Any], timeout: float) -> ProbeOutcome:
    """Send a probe request and parse the reply."""
    try:
        nc = await _get_nats()
        reply = await nc.request(subject, json.dumps(payload).encode(), timeout=timeout)
        return ProbeOutcome.from_reply(json.loads(reply.data))
    except nats.errors.TimeoutError:
        logger.warning("Device probe timed out on %s", subject)
        return ProbeOutcome.unavailable(
            "The poller did not respond to the connectivity probe. It may be "
            "restarting or disconnected from the message bus.",
            tls_mode=str(payload.get("tls_mode", "")),
        )
    except Exception as exc:  # noqa: BLE001 -- any bus failure is "cannot ask"
        logger.error("Device probe failed on %s: %s", subject, exc)
        return ProbeOutcome.unavailable(
            f"Could not reach the poller to run a connectivity probe: {exc}",
            tls_mode=str(payload.get("tls_mode", "")),
        )


async def probe_new_device(
    ip_address: str,
    api_port: int,
    api_ssl_port: int,
    username: str,
    password: str,
    tls_mode: str = "auto",
    ca_cert_pem: Optional[str] = None,
    timeout: float = DEFAULT_PROBE_TIMEOUT,
) -> ProbeOutcome:
    """Probe a device that is not yet stored, for onboarding validation."""
    payload: dict[str, Any] = {
        "ip_address": ip_address,
        "api_port": api_port,
        "api_ssl_port": api_ssl_port,
        "username": username,
        "password": password,
        "tls_mode": tls_mode,
    }
    if ca_cert_pem:
        payload["ca_cert_pem"] = ca_cert_pem

    return await _request("device.probe.routeros", payload, timeout)


async def probe_stored_device(
    device_id: str,
    timeout: float = DEFAULT_PROBE_TIMEOUT,
) -> ProbeOutcome:
    """Probe a stored device using its own saved settings and credentials.

    The poller resolves credentials exactly as it does for polling, so this is
    a rehearsal of the next poll rather than an approximation of it.
    """
    return await _request(f"device.probe.stored.{device_id}", {}, timeout)


async def close() -> None:
    """Close the NATS connection. Called on application shutdown."""
    global _nc
    if _nc and not _nc.is_closed:
        await _nc.drain()
        _nc = None
        logger.info("Device probe NATS connection closed")
