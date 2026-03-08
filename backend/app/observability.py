"""Prometheus metrics and health check infrastructure.

Provides:
- setup_instrumentator(): Configures Prometheus auto-instrumentation for FastAPI
- check_health_ready(): Verifies PostgreSQL, Redis, and NATS connectivity for readiness probes
"""

import asyncio
import time

import structlog
from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

logger = structlog.get_logger(__name__)


def setup_instrumentator(app: FastAPI) -> Instrumentator:
    """Configure and mount Prometheus metrics instrumentation.

    Auto-instruments all HTTP endpoints with:
    - http_requests_total (counter) by method, handler, status_code
    - http_request_duration_seconds (histogram) by method, handler
    - http_requests_in_progress (gauge)

    The /metrics endpoint is mounted at root level (not under /api prefix).
    Labels use handler templates (e.g., /api/tenants/{tenant_id}/...) not
    resolved paths, ensuring bounded cardinality.

    Must be called AFTER all routers are included so all routes are captured.
    """
    instrumentator = Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,
        excluded_handlers=["/health", "/health/ready", "/metrics", "/api/health"],
        should_respect_env_var=False,
    )
    instrumentator.instrument(app)
    instrumentator.expose(app, include_in_schema=False, should_gzip=True)
    logger.info("prometheus instrumentation enabled", endpoint="/metrics")
    return instrumentator


async def check_health_ready() -> dict:
    """Check readiness by verifying all critical dependencies.

    Checks PostgreSQL, Redis, and NATS connectivity with 5-second timeouts.
    Returns a structured result with per-dependency status and latency.

    Returns:
        dict with "status" ("healthy"|"unhealthy"), "version", and "checks"
        containing per-dependency results.
    """
    from app.config import settings

    checks: dict[str, dict] = {}
    all_healthy = True

    # PostgreSQL check
    checks["postgres"] = await _check_postgres()
    if checks["postgres"]["status"] != "up":
        all_healthy = False

    # Redis check
    checks["redis"] = await _check_redis(settings.REDIS_URL)
    if checks["redis"]["status"] != "up":
        all_healthy = False

    # NATS check
    checks["nats"] = await _check_nats(settings.NATS_URL)
    if checks["nats"]["status"] != "up":
        all_healthy = False

    return {
        "status": "healthy" if all_healthy else "unhealthy",
        "version": settings.APP_VERSION,
        "checks": checks,
    }


async def _check_postgres() -> dict:
    """Verify PostgreSQL connectivity via the admin engine."""
    start = time.monotonic()
    try:
        from sqlalchemy import text

        from app.database import engine

        async with engine.connect() as conn:
            await asyncio.wait_for(
                conn.execute(text("SELECT 1")),
                timeout=5.0,
            )
        latency_ms = round((time.monotonic() - start) * 1000)
        return {"status": "up", "latency_ms": latency_ms, "error": None}
    except Exception as exc:
        latency_ms = round((time.monotonic() - start) * 1000)
        logger.warning("health check: postgres failed", error=str(exc))
        return {"status": "down", "latency_ms": latency_ms, "error": str(exc)}


async def _check_redis(redis_url: str) -> dict:
    """Verify Redis connectivity."""
    start = time.monotonic()
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(redis_url, socket_connect_timeout=5)
        try:
            await asyncio.wait_for(client.ping(), timeout=5.0)
        finally:
            await client.aclose()
        latency_ms = round((time.monotonic() - start) * 1000)
        return {"status": "up", "latency_ms": latency_ms, "error": None}
    except Exception as exc:
        latency_ms = round((time.monotonic() - start) * 1000)
        logger.warning("health check: redis failed", error=str(exc))
        return {"status": "down", "latency_ms": latency_ms, "error": str(exc)}


async def _check_nats(nats_url: str) -> dict:
    """Verify NATS connectivity."""
    start = time.monotonic()
    try:
        import nats

        nc = await asyncio.wait_for(
            nats.connect(nats_url),
            timeout=5.0,
        )
        try:
            await nc.drain()
        except Exception:
            pass
        latency_ms = round((time.monotonic() - start) * 1000)
        return {"status": "up", "latency_ms": latency_ms, "error": None}
    except Exception as exc:
        latency_ms = round((time.monotonic() - start) * 1000)
        logger.warning("health check: nats failed", error=str(exc))
        return {"status": "down", "latency_ms": latency_ms, "error": str(exc)}
