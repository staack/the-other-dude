"""HTTP client for the winbox-worker container.

Provides async helpers to create, terminate, query, and health-check
Remote WinBox (Xpra) sessions running inside the worker container.
All communication uses the internal Docker network.
"""

import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

WORKER_BASE_URL = "http://tod_winbox_worker:9090"
_HEADERS = {"X-Internal-Service": "api"}
_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class WorkerCapacityError(Exception):
    """Worker has no capacity for new sessions."""


class WorkerLaunchError(Exception):
    """Worker failed to launch a session."""


async def create_session(
    session_id: str,
    device_ip: str,
    device_port: int,
    username: str,
    password: str,
    idle_timeout_seconds: int,
    max_lifetime_seconds: int,
) -> dict[str, Any]:
    """POST /sessions — ask the worker to launch an Xpra+WinBox session.

    Credentials are zeroed from locals after the request is sent.
    Raises WorkerCapacityError (503) or WorkerLaunchError on failure.
    """
    payload = {
        "session_id": session_id,
        "tunnel_host": device_ip,
        "tunnel_port": device_port,
        "username": username,
        "password": password,
        "idle_timeout_seconds": idle_timeout_seconds,
        "max_lifetime_seconds": max_lifetime_seconds,
    }
    try:
        async with httpx.AsyncClient(
            base_url=WORKER_BASE_URL, headers=_HEADERS, timeout=_TIMEOUT
        ) as client:
            resp = await client.post("/sessions", json=payload)
    finally:
        # Zero credentials in the payload dict
        payload["username"] = ""
        payload["password"] = ""
        del username, password  # noqa: F821 — local unbind

    if resp.status_code == 503:
        raise WorkerCapacityError(resp.text)
    if resp.status_code >= 400:
        raise WorkerLaunchError(f"Worker returned {resp.status_code}: {resp.text}")

    return resp.json()


async def terminate_session(session_id: str) -> bool:
    """DELETE /sessions/{session_id} — idempotent (ignores 404).

    Returns True if the worker acknowledged termination, False if 404.
    """
    async with httpx.AsyncClient(
        base_url=WORKER_BASE_URL, headers=_HEADERS, timeout=_TIMEOUT
    ) as client:
        resp = await client.delete(f"/sessions/{session_id}")

    if resp.status_code == 404:
        return False
    if resp.status_code >= 400:
        logger.error("Worker terminate error %s: %s", resp.status_code, resp.text)
        return False
    return True


async def get_session(session_id: str) -> Optional[dict[str, Any]]:
    """GET /sessions/{session_id} — returns None if 404."""
    async with httpx.AsyncClient(
        base_url=WORKER_BASE_URL, headers=_HEADERS, timeout=_TIMEOUT
    ) as client:
        resp = await client.get(f"/sessions/{session_id}")

    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        logger.error("Worker get_session error %s: %s", resp.status_code, resp.text)
        return None
    return resp.json()


async def list_sessions() -> list[dict[str, Any]]:
    """GET /sessions — return all sessions known to the worker."""
    async with httpx.AsyncClient(
        base_url=WORKER_BASE_URL, headers=_HEADERS, timeout=_TIMEOUT
    ) as client:
        resp = await client.get("/sessions")

    if resp.status_code >= 400:
        logger.error("Worker list_sessions error %s: %s", resp.status_code, resp.text)
        return []
    data = resp.json()
    return data if isinstance(data, list) else []


async def health_check() -> bool:
    """GET /healthz — returns True if the worker is healthy."""
    try:
        async with httpx.AsyncClient(
            base_url=WORKER_BASE_URL, headers=_HEADERS, timeout=httpx.Timeout(5.0)
        ) as client:
            resp = await client.get("/healthz")
        return resp.status_code == 200
    except Exception:
        return False
