"""FastAPI application entry point."""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.config import settings
from app.logging_config import configure_logging
from app.middleware.rate_limit import setup_rate_limiting
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.observability import check_health_ready, setup_instrumentator

logger = structlog.get_logger(__name__)


async def run_migrations() -> None:
    """Run Alembic migrations on startup."""
    import os
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    if result.returncode != 0:
        logger.error("migration failed", stderr=result.stderr)
        raise RuntimeError(f"Database migration failed: {result.stderr}")
    logger.info("migrations applied successfully")


async def bootstrap_first_admin() -> None:
    """Create the first super_admin user if no users exist."""
    if not settings.FIRST_ADMIN_EMAIL or not settings.FIRST_ADMIN_PASSWORD:
        logger.info("FIRST_ADMIN_EMAIL/PASSWORD not set, skipping bootstrap")
        return

    from sqlalchemy import select

    from app.database import AdminAsyncSessionLocal
    from app.models.user import User, UserRole
    from app.services.auth import hash_password

    async with AdminAsyncSessionLocal() as session:
        # Check if any users exist (bypass RLS with admin session)
        result = await session.execute(select(User).limit(1))
        existing_user = result.scalar_one_or_none()

        if existing_user:
            logger.info("users already exist, skipping first admin bootstrap")
            return

        # Create the first super_admin with bcrypt password.
        # must_upgrade_auth=True triggers the SRP registration flow on first login.
        admin = User(
            email=settings.FIRST_ADMIN_EMAIL,
            hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
            name="Super Admin",
            role=UserRole.SUPER_ADMIN.value,
            tenant_id=None,  # super_admin has no tenant
            is_active=True,
            must_upgrade_auth=True,
        )
        session.add(admin)
        await session.commit()
        logger.info("created first super_admin", email=settings.FIRST_ADMIN_EMAIL)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: run migrations and bootstrap on startup."""
    from app.services.backup_scheduler import start_backup_scheduler, stop_backup_scheduler
    from app.services.firmware_subscriber import start_firmware_subscriber, stop_firmware_subscriber
    from app.services.retention_service import start_retention_scheduler, stop_retention_scheduler
    from app.services.metrics_subscriber import start_metrics_subscriber, stop_metrics_subscriber
    from app.services.nats_subscriber import start_nats_subscriber, stop_nats_subscriber
    from app.services.session_audit_subscriber import (
        start_session_audit_subscriber,
        stop_session_audit_subscriber,
    )
    from app.services.sse_manager import ensure_sse_streams

    # Configure structured logging FIRST -- before any other startup work
    configure_logging()

    logger.info("starting TOD API")

    # Run database migrations
    await run_migrations()

    # Bootstrap first admin user
    await bootstrap_first_admin()

    # Start NATS subscriber for device status events.
    # Wrapped in try/except so NATS failure doesn't prevent API startup --
    # allows running the API locally without NATS during frontend development.
    nats_connection = None
    try:
        nats_connection = await start_nats_subscriber()
    except Exception as exc:
        logger.warning(
            "NATS status subscriber could not start (API will run without it)",
            error=str(exc),
        )

    # Start NATS subscriber for device metrics events (separate NATS connection).
    # Same pattern -- failure is non-fatal so the API starts without full NATS stack.
    metrics_nc = None
    try:
        metrics_nc = await start_metrics_subscriber()
    except Exception as exc:
        logger.warning(
            "NATS metrics subscriber could not start (API will run without it)",
            error=str(exc),
        )

    # Start NATS subscriber for device firmware events (separate NATS connection).
    firmware_nc = None
    try:
        firmware_nc = await start_firmware_subscriber()
    except Exception as exc:
        logger.warning(
            "NATS firmware subscriber could not start (API will run without it)",
            error=str(exc),
        )

    # Start NATS subscriber for SSH session end audit events (separate NATS connection).
    session_audit_nc = None
    try:
        session_audit_nc = await start_session_audit_subscriber()
    except Exception as exc:
        logger.warning(
            "NATS session audit subscriber could not start (API will run without it)",
            error=str(exc),
        )

    # Ensure NATS streams for SSE event delivery exist (ALERT_EVENTS, OPERATION_EVENTS).
    # Non-fatal -- API starts without SSE streams; they'll be created on first SSE connection.
    try:
        await ensure_sse_streams()
    except Exception as exc:
        logger.warning(
            "SSE NATS streams could not be created (SSE will retry on connection)",
            error=str(exc),
        )

    # Start APScheduler for automated nightly config backups.
    # Non-fatal -- API starts and serves requests even without the scheduler.
    try:
        await start_backup_scheduler()
    except Exception as exc:
        logger.warning("backup scheduler could not start", error=str(exc))

    # Register daily firmware version check (3am UTC) on the same scheduler.
    try:
        from app.services.firmware_service import schedule_firmware_checks

        schedule_firmware_checks()
    except Exception as exc:
        logger.warning("firmware check scheduler could not start", error=str(exc))

    # Provision OpenBao Transit keys for existing tenants and migrate legacy credentials.
    # Non-blocking: if OpenBao is unavailable, the dual-read path handles fallback.
    if settings.OPENBAO_ADDR:
        try:
            from app.database import AdminAsyncSessionLocal
            from app.services.key_service import provision_existing_tenants

            async with AdminAsyncSessionLocal() as openbao_session:
                counts = await provision_existing_tenants(openbao_session)
                logger.info(
                    "openbao tenant provisioning complete",
                    **{k: v for k, v in counts.items()},
                )
        except Exception as exc:
            logger.warning(
                "openbao tenant provisioning failed (will retry on next restart)",
                error=str(exc),
            )

    # Recover stale push operations from previous API instance
    try:
        from app.services.restore_service import recover_stale_push_operations
        from app.database import AdminAsyncSessionLocal as _AdminSession

        async with _AdminSession() as session:
            await recover_stale_push_operations(session)
        logger.info("push operation recovery check complete")
    except Exception as e:
        logger.error("push operation recovery failed (non-fatal): %s", e)

    # Config change subscriber (event-driven backups)
    config_change_nc = None
    try:
        from app.services.config_change_subscriber import (
            start_config_change_subscriber,
            stop_config_change_subscriber,
        )

        config_change_nc = await start_config_change_subscriber()
    except Exception as e:
        logger.error("Config change subscriber failed to start (non-fatal): %s", e)

    # Push rollback/alert subscriber
    push_rollback_nc = None
    try:
        from app.services.push_rollback_subscriber import (
            start_push_rollback_subscriber,
            stop_push_rollback_subscriber,
        )

        push_rollback_nc = await start_push_rollback_subscriber()
    except Exception as e:
        logger.error("Push rollback subscriber failed to start (non-fatal): %s", e)

    # Config snapshot ingestion subscriber (Go poller -> PostgreSQL via Transit encryption)
    config_snapshot_nc = None
    try:
        from app.services.config_snapshot_subscriber import (
            start_config_snapshot_subscriber,
            stop_config_snapshot_subscriber,
        )

        config_snapshot_nc = await start_config_snapshot_subscriber()
    except Exception as e:
        logger.error("Config snapshot subscriber failed to start (non-fatal): %s", e)

    # Start retention cleanup scheduler (daily purge of expired config snapshots)
    try:
        await start_retention_scheduler()
    except Exception as exc:
        logger.warning(
            "retention scheduler could not start (API will run without it)", error=str(exc)
        )

    # Start Remote WinBox session reconciliation loop (60s interval).
    # Detects orphaned sessions (worker lost them) and cleans up Redis + tunnels.
    winbox_reconcile_task: Optional[asyncio.Task] = None  # type: ignore[type-arg]
    try:
        from app.routers.winbox_remote import _get_redis as _wb_get_redis, _close_tunnel
        from app.services.winbox_remote import get_session as _wb_worker_get

        async def _winbox_reconcile_loop() -> None:
            """Scan Redis for winbox-remote:* keys and reconcile with worker."""
            import json as _json

            while True:
                try:
                    await asyncio.sleep(60)
                    rd = await _wb_get_redis()
                    cursor = "0"
                    while True:
                        cursor, keys = await rd.scan(
                            cursor=cursor, match="winbox-remote:*", count=100
                        )
                        for key in keys:
                            raw = await rd.get(key)
                            if raw is None:
                                continue
                            try:
                                sess = _json.loads(raw)
                            except Exception:
                                await rd.delete(key)
                                continue

                            sess_status = sess.get("status")
                            if sess_status not in ("creating", "active", "grace"):
                                continue

                            session_id = sess.get("session_id")
                            if not session_id:
                                await rd.delete(key)
                                continue

                            # Health-check against worker
                            worker_info = await _wb_worker_get(session_id)
                            if worker_info is None:
                                # Worker lost the session — clean up
                                logger.warning(
                                    "reconcile: worker lost session %s, cleaning up",
                                    session_id,
                                )
                                tunnel_id = sess.get("tunnel_id")
                                if tunnel_id:
                                    await _close_tunnel(tunnel_id)
                                await rd.delete(key)

                        if cursor == "0" or cursor == 0:
                            break
                except asyncio.CancelledError:
                    break
                except Exception as exc:
                    logger.warning("winbox reconcile loop error: %s", exc)

        winbox_reconcile_task = asyncio.create_task(_winbox_reconcile_loop())
    except Exception as exc:
        logger.warning("winbox reconcile loop could not start (non-fatal)", error=str(exc))

    logger.info("startup complete, ready to serve requests")
    yield

    # Shutdown
    logger.info("shutting down TOD API")
    if winbox_reconcile_task and not winbox_reconcile_task.done():
        winbox_reconcile_task.cancel()
        try:
            await winbox_reconcile_task
        except asyncio.CancelledError:
            pass
    await stop_backup_scheduler()
    await stop_nats_subscriber(nats_connection)
    await stop_metrics_subscriber(metrics_nc)
    await stop_firmware_subscriber(firmware_nc)
    await stop_session_audit_subscriber(session_audit_nc)
    if config_change_nc:
        await stop_config_change_subscriber()
    if push_rollback_nc:
        await stop_push_rollback_subscriber()
    if config_snapshot_nc:
        await stop_config_snapshot_subscriber()
    await stop_retention_scheduler()

    # Dispose database engine connections to release all pooled connections cleanly.
    from app.database import app_engine, engine

    await app_engine.dispose()
    await engine.dispose()
    logger.info("database connections closed")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="The Other Dude — Fleet Management API",
        docs_url="/docs" if settings.ENVIRONMENT == "dev" else None,
        redoc_url="/redoc" if settings.ENVIRONMENT == "dev" else None,
        lifespan=lifespan,
    )

    # Starlette processes middleware in LIFO order (last added = first to run).
    # We want: Request -> RequestID -> CORS -> Route handler
    # So add CORS first, then RequestID (it will wrap CORS).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.get_cors_origins(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )
    app.add_middleware(SecurityHeadersMiddleware, environment=settings.ENVIRONMENT)
    setup_rate_limiting(app)  # Register 429 exception handler (no middleware added)
    app.add_middleware(RequestIDMiddleware)

    # Include routers
    from app.routers.alerts import router as alerts_router
    from app.routers.auth import router as auth_router
    from app.routers.sse import router as sse_router
    from app.routers.config_backups import router as config_router
    from app.routers.config_editor import router as config_editor_router
    from app.routers.config_history import router as config_history_router
    from app.routers.device_groups import router as device_groups_router
    from app.routers.device_tags import router as device_tags_router
    from app.routers.devices import router as devices_router
    from app.routers.firmware import router as firmware_router
    from app.routers.metrics import router as metrics_router
    from app.routers.events import router as events_router
    from app.routers.clients import router as clients_router
    from app.routers.device_logs import router as device_logs_router
    from app.routers.templates import router as templates_router
    from app.routers.tenants import router as tenants_router
    from app.routers.reports import router as reports_router
    from app.routers.topology import router as topology_router
    from app.routers.users import router as users_router
    from app.routers.audit_logs import router as audit_logs_router
    from app.routers.api_keys import router as api_keys_router
    from app.routers.maintenance_windows import router as maintenance_windows_router
    from app.routers.vpn import router as vpn_router
    from app.routers.certificates import router as certificates_router
    from app.routers.transparency import router as transparency_router
    from app.routers.settings import router as settings_router
    from app.routers.remote_access import router as remote_access_router
    from app.routers.winbox_remote import router as winbox_remote_router
    from app.routers.sites import router as sites_router

    app.include_router(auth_router, prefix="/api")
    app.include_router(tenants_router, prefix="/api")
    app.include_router(users_router, prefix="/api")
    app.include_router(devices_router, prefix="/api")
    app.include_router(device_groups_router, prefix="/api")
    app.include_router(device_tags_router, prefix="/api")
    app.include_router(metrics_router, prefix="/api")
    app.include_router(config_router, prefix="/api")
    app.include_router(config_history_router, prefix="/api")
    app.include_router(firmware_router, prefix="/api")
    app.include_router(alerts_router, prefix="/api")
    app.include_router(config_editor_router, prefix="/api")
    app.include_router(events_router, prefix="/api")
    app.include_router(device_logs_router, prefix="/api")
    app.include_router(templates_router, prefix="/api")
    app.include_router(clients_router, prefix="/api")
    app.include_router(topology_router, prefix="/api")
    app.include_router(sse_router, prefix="/api")
    app.include_router(audit_logs_router, prefix="/api")
    app.include_router(reports_router, prefix="/api")
    app.include_router(api_keys_router, prefix="/api")
    app.include_router(maintenance_windows_router, prefix="/api")
    app.include_router(vpn_router, prefix="/api")
    app.include_router(certificates_router, prefix="/api/certificates", tags=["certificates"])
    app.include_router(transparency_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(remote_access_router, prefix="/api")
    app.include_router(winbox_remote_router, prefix="/api")
    app.include_router(sites_router, prefix="/api")

    # Health check endpoints
    @app.get("/health", tags=["health"])
    async def health_check() -> dict:
        """Liveness probe -- returns 200 if the process is alive."""
        return {"status": "ok", "version": settings.APP_VERSION}

    @app.get("/health/ready", tags=["health"])
    async def health_ready() -> JSONResponse:
        """Readiness probe -- returns 200 only when PostgreSQL, Redis, and NATS are healthy."""
        result = await check_health_ready()
        status_code = 200 if result["status"] == "healthy" else 503
        return JSONResponse(content=result, status_code=status_code)

    @app.get("/api/health", tags=["health"])
    async def api_health_check() -> dict:
        """Backward-compatible health endpoint under /api prefix."""
        return {"status": "ok", "version": settings.APP_VERSION}

    # Prometheus metrics instrumentation -- MUST be after routers so all routes are captured
    setup_instrumentator(app)

    return app


app = create_app()
