"""
Integration test fixtures for the TOD backend.

Provides:
- Database engines (admin + app_user) pointing at real PostgreSQL+TimescaleDB
- Per-test session with commit-and-cleanup (no savepoint tricks)
- app_session_factory for RLS multi-tenant tests
- FastAPI test client with dependency overrides
- Entity factory fixtures (tenants, users, devices)
- Auth helper that mints JWTs directly

All fixtures use the existing docker-compose PostgreSQL instance.
Set TEST_DATABASE_URL / TEST_APP_USER_DATABASE_URL env vars to override defaults.

Test isolation strategy: tests commit data to the real database, then
clean up all test-created rows in teardown.  This avoids the savepoint
visibility issues that break FK checks when API endpoints use separate
DB sessions.
"""

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/tod_test",
)
TEST_APP_USER_DATABASE_URL = os.environ.get(
    "TEST_APP_USER_DATABASE_URL",
    "postgresql+asyncpg://app_user:app_password@localhost:5432/tod_test",
)


# ---------------------------------------------------------------------------
# One-time database setup (runs once per session via autouse sync fixture)
# ---------------------------------------------------------------------------

_DB_SETUP_DONE = False


def _ensure_database_setup():
    """Synchronous one-time DB setup: create test DB if needed, run migrations."""
    global _DB_SETUP_DONE
    if _DB_SETUP_DONE:
        return
    _DB_SETUP_DONE = True

    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env = os.environ.copy()
    env["DATABASE_URL"] = TEST_DATABASE_URL
    env.setdefault("CREDENTIAL_ENCRYPTION_KEY", "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w=")

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
        cwd=backend_dir,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Alembic migration failed:\n{result.stderr}")


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    """Session-scoped sync fixture: ensures DB schema is ready."""
    _ensure_database_setup()
    yield


# ---------------------------------------------------------------------------
# Engine fixtures (function-scoped to stay on same event loop as tests)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def admin_engine():
    """Admin engine (superuser) -- bypasses RLS."""
    engine = create_async_engine(
        TEST_DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=5, max_overflow=5
    )
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def app_engine():
    """App-user engine -- RLS enforced."""
    engine = create_async_engine(
        TEST_APP_USER_DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=5, max_overflow=5
    )
    yield engine
    await engine.dispose()


# ---------------------------------------------------------------------------
# Tables to clean up after each test (reverse FK order)
# ---------------------------------------------------------------------------

_CLEANUP_TABLES = [
    "key_access_log",
    "user_key_sets",
    "device_certificates",
    "certificate_authorities",
    "template_push_jobs",
    "config_template_tags",
    "config_templates",
    "config_push_operations",
    "config_backup_schedules",
    "config_backup_runs",
    "router_config_changes",
    "router_config_diffs",
    "router_config_snapshots",
    "firmware_upgrade_jobs",
    "alert_rule_channels",
    "alert_events",
    "alert_rules",
    "notification_channels",
    "maintenance_windows",
    "vpn_peers",
    "vpn_config",
    "device_tag_assignments",
    "device_group_memberships",
    "device_tags",
    "device_groups",
    "api_keys",
    "audit_logs",
    "devices",
    "invites",
    "user_tenants",
    "users",
    "tenants",
]


# ---------------------------------------------------------------------------
# Session fixtures (commit-and-cleanup, no savepoints)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def admin_session(admin_engine) -> AsyncGenerator[AsyncSession, None]:
    """Per-test admin session that commits to disk.

    Data is visible to all connections (including API endpoint sessions).
    Cleanup deletes all rows from test tables after the test.
    """
    session = AsyncSession(admin_engine, expire_on_commit=False)
    # TRUNCATE CASCADE reliably removes all data regardless of FK order
    tables_csv = ", ".join(_CLEANUP_TABLES)
    await session.execute(text(f"TRUNCATE {tables_csv} CASCADE"))
    await session.commit()
    try:
        yield session
    finally:
        await session.execute(text(f"TRUNCATE {tables_csv} CASCADE"))
        await session.commit()
        await session.close()


@pytest_asyncio.fixture
async def app_session(app_engine) -> AsyncGenerator[AsyncSession, None]:
    """Per-test app_user session with transaction rollback (RLS enforced).

    Caller must call set_tenant_context() before querying.
    """
    async with app_engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False)
        await session.execute(text("RESET app.current_tenant"))
        try:
            yield session
        finally:
            await trans.rollback()
            await session.close()


@pytest.fixture
def app_session_factory(app_engine):
    """Factory that returns an async context manager for app_user sessions.

    Each session gets its own connection and transaction (rolled back on exit).
    Caller can pass tenant_id to auto-set RLS context.
    """
    from app.database import set_tenant_context

    @asynccontextmanager
    async def _create(tenant_id: str | None = None):
        async with app_engine.connect() as conn:
            trans = await conn.begin()
            session = AsyncSession(bind=conn, expire_on_commit=False)
            await session.execute(text("RESET app.current_tenant"))
            if tenant_id:
                await set_tenant_context(session, tenant_id)
            try:
                yield session
            finally:
                await trans.rollback()
                await session.close()

    return _create


# ---------------------------------------------------------------------------
# FastAPI test app and HTTP client
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def test_app(admin_engine, app_engine):
    """Create a FastAPI app instance with test database dependency overrides.

    Both get_db and get_admin_db create independent sessions from the admin
    engine.  Since admin_session commits data to disk, it is visible to
    these sessions without needing shared connections.
    """
    from fastapi import FastAPI

    from app.database import get_admin_db, get_db

    app = FastAPI(lifespan=None)

    from app.routers.alerts import router as alerts_router
    from app.routers.auth import router as auth_router
    from app.routers.config_backups import router as config_router
    from app.routers.config_editor import router as config_editor_router
    from app.routers.device_groups import router as device_groups_router
    from app.routers.device_tags import router as device_tags_router
    from app.routers.devices import router as devices_router
    from app.routers.firmware import router as firmware_router
    from app.routers.metrics import router as metrics_router
    from app.routers.templates import router as templates_router
    from app.routers.tenants import router as tenants_router
    from app.routers.users import router as users_router
    from app.routers.vpn import router as vpn_router

    app.include_router(auth_router, prefix="/api")
    app.include_router(tenants_router, prefix="/api")
    app.include_router(users_router, prefix="/api")
    app.include_router(devices_router, prefix="/api")
    app.include_router(device_groups_router, prefix="/api")
    app.include_router(device_tags_router, prefix="/api")
    app.include_router(metrics_router, prefix="/api")
    app.include_router(config_router, prefix="/api")
    app.include_router(firmware_router, prefix="/api")
    app.include_router(alerts_router, prefix="/api")
    app.include_router(config_editor_router, prefix="/api")
    app.include_router(templates_router, prefix="/api")
    app.include_router(vpn_router, prefix="/api")

    from app.middleware.rate_limit import setup_rate_limiting

    setup_rate_limiting(app)

    test_session_factory = async_sessionmaker(
        admin_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with test_session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def override_get_admin_db() -> AsyncGenerator[AsyncSession, None]:
        async with test_session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_admin_db] = override_get_admin_db

    yield app

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(test_app) -> AsyncGenerator[AsyncClient, None]:
    """HTTP client using ASGI transport (no network, real app).

    Flushes Redis DB 1 (rate limit storage) before each test to prevent
    cross-test 429 errors from slowapi.
    """
    import redis

    try:
        r = redis.Redis(host="localhost", port=6379, db=1)
        r.flushdb()
        r.close()
    except Exception:
        pass

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Entity factory fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def create_test_tenant():
    """Factory to create a test tenant via admin session."""

    async def _create(
        session: AsyncSession,
        name: str | None = None,
    ):
        from app.models.tenant import Tenant

        tenant_name = name or f"test-tenant-{uuid.uuid4().hex[:8]}"
        tenant = Tenant(name=tenant_name)
        session.add(tenant)
        await session.flush()
        return tenant

    return _create


@pytest.fixture
def create_test_user():
    """Factory to create a test user via admin session."""

    async def _create(
        session: AsyncSession,
        tenant_id: uuid.UUID | None,
        email: str | None = None,
        password: str = "TestPass123!",
        role: str = "tenant_admin",
        name: str = "Test User",
    ):
        from app.models.user import User
        from app.services.auth import hash_password

        user_email = email or f"test-{uuid.uuid4().hex[:8]}@example.com"
        user = User(
            email=user_email,
            hashed_password=hash_password(password),
            name=name,
            role=role,
            tenant_id=tenant_id,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        return user

    return _create


@pytest.fixture
def create_test_device():
    """Factory to create a test device via admin session."""

    async def _create(
        session: AsyncSession,
        tenant_id: uuid.UUID,
        hostname: str | None = None,
        ip_address: str | None = None,
        status: str = "online",
    ):
        from app.models.device import Device

        device_hostname = hostname or f"router-{uuid.uuid4().hex[:8]}"
        device_ip = ip_address or f"10.0.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}"
        device = Device(
            tenant_id=tenant_id,
            hostname=device_hostname,
            ip_address=device_ip,
            api_port=8728,
            api_ssl_port=8729,
            status=status,
        )
        session.add(device)
        await session.flush()
        return device

    return _create


@pytest.fixture
def auth_headers_factory(create_test_tenant, create_test_user):
    """Factory to create authenticated headers for a test user.

    Creates a tenant + user, commits to disk, then mints a JWT directly.
    The commit ensures data is visible to API endpoint sessions.
    """

    async def _create(
        admin_session: AsyncSession,
        email: str | None = None,
        password: str = "TestPass123!",
        role: str = "tenant_admin",
        tenant_name: str | None = None,
        existing_tenant_id: uuid.UUID | None = None,
    ) -> dict[str, Any]:
        """Create user, commit, mint JWT, return headers + tenant/user info."""
        from app.services.auth import create_access_token

        if existing_tenant_id:
            tenant_id = existing_tenant_id
        else:
            tenant = await create_test_tenant(admin_session, name=tenant_name)
            tenant_id = tenant.id

        user = await create_test_user(
            admin_session,
            tenant_id=tenant_id,
            email=email,
            password=password,
            role=role,
        )
        # Commit to disk so API endpoint sessions can see this data
        await admin_session.commit()

        access_token = create_access_token(
            user_id=user.id,
            tenant_id=tenant_id,
            role=role,
        )

        return {
            "headers": {"Authorization": f"Bearer {access_token}"},
            "access_token": access_token,
            "refresh_token": None,
            "tenant_id": str(tenant_id),
            "user_id": str(user.id),
            "user_email": user.email,
        }

    return _create
