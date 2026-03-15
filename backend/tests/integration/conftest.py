"""
Integration test fixtures for the TOD backend.

Provides:
- Database engines (admin + app_user) pointing at real PostgreSQL+TimescaleDB
- Per-test session fixtures with transaction rollback for isolation
- app_session_factory for RLS multi-tenant tests (creates sessions with tenant context)
- FastAPI test client with dependency overrides
- Entity factory fixtures (tenants, users, devices)
- Auth helper for getting login tokens

All fixtures use the existing docker-compose PostgreSQL instance.
Set TEST_DATABASE_URL / TEST_APP_USER_DATABASE_URL env vars to override defaults.

Event loop strategy: All async fixtures are function-scoped to avoid the
pytest-asyncio 0.26 session/function loop mismatch. Engine creation and DB
setup use synchronous subprocess calls (Alembic) and module-level singletons.
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
    # Ensure DATABASE_URL points at the test database, not the dev/prod URL
    # hardcoded in alembic.ini.  alembic/env.py reads this variable and overrides
    # sqlalchemy.url before opening any connection.
    env["DATABASE_URL"] = TEST_DATABASE_URL
    # Migration 029 (VPN tenant isolation) encrypts a WireGuard server private key
    # and requires CREDENTIAL_ENCRYPTION_KEY.  Provide the dev default if the
    # environment does not already supply it (CI always sets this explicitly).
    env.setdefault("CREDENTIAL_ENCRYPTION_KEY", "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w=")

    # Run Alembic migrations via subprocess (handles DB creation and schema)
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
    """Admin engine (superuser) -- bypasses RLS.

    Created fresh per-test to avoid event loop issues.
    pool_size=2 since each test only needs a few connections.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=2, max_overflow=3
    )
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def app_engine():
    """App-user engine -- RLS enforced.

    Created fresh per-test to avoid event loop issues.
    """
    engine = create_async_engine(
        TEST_APP_USER_DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=2, max_overflow=3
    )
    yield engine
    await engine.dispose()


# ---------------------------------------------------------------------------
# Function-scoped session fixtures (fresh per test)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def admin_conn(admin_engine):
    """Shared admin connection with transaction rollback.

    Both admin_session and test_app bind to the same connection so that
    data created in the test (via admin_session) is visible to API
    endpoints (via get_db / get_admin_db overrides).
    """
    conn = await admin_engine.connect()
    trans = await conn.begin()
    try:
        yield conn
    finally:
        await trans.rollback()
        await conn.close()


@pytest_asyncio.fixture
async def admin_session(admin_conn) -> AsyncGenerator[AsyncSession, None]:
    """Per-test admin session sharing the admin_conn transaction."""
    session = AsyncSession(bind=admin_conn, expire_on_commit=False)
    try:
        yield session
    finally:
        await session.close()


@pytest_asyncio.fixture
async def app_session(app_engine) -> AsyncGenerator[AsyncSession, None]:
    """Per-test app_user session with transaction rollback (RLS enforced).

    Caller must call set_tenant_context() before querying.
    """
    async with app_engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False)
        # Reset tenant context
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

    Usage:
        async with app_session_factory(tenant_id=str(tenant.id)) as session:
            result = await session.execute(select(Device))
    """
    from app.database import set_tenant_context

    @asynccontextmanager
    async def _create(tenant_id: str | None = None):
        async with app_engine.connect() as conn:
            trans = await conn.begin()
            session = AsyncSession(bind=conn, expire_on_commit=False)
            # Reset tenant context to prevent leakage
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
async def test_app(admin_conn, app_engine):
    """Create a FastAPI app instance with test database dependency overrides.

    Both get_db and get_admin_db bind to admin_conn (the shared connection
    from admin_conn fixture).  This means data created via admin_session
    is visible to API endpoints, and everything rolls back after the test.
    """
    from fastapi import FastAPI

    from app.database import get_admin_db, get_db

    # Create a minimal app without lifespan
    app = FastAPI(lifespan=None)

    # Import and mount all routers (same as main app)
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

    # Register rate limiter (auth endpoints use @limiter.limit)
    from app.middleware.rate_limit import setup_rate_limiting

    setup_rate_limiting(app)

    # API endpoints bind to the same shared connection as admin_session
    # so test-created data is visible across the transaction.
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        session = AsyncSession(bind=admin_conn, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()

    async def override_get_admin_db() -> AsyncGenerator[AsyncSession, None]:
        session = AsyncSession(bind=admin_conn, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()

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
        # Rate limiter uses Redis DB 1 (see app/middleware/rate_limit.py)
        r = redis.Redis(host="localhost", port=6379, db=1)
        r.flushdb()
        r.close()
    except Exception:
        pass  # Redis not available -- skip clearing

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

    Creates a tenant + user, generates a JWT directly (no HTTP login
    round-trip), and returns the Authorization headers dict.

    We mint the token directly rather than going through /api/auth/login
    because the test admin_session uses a savepoint transaction that is
    invisible to the login endpoint's own DB session.
    """

    async def _create(
        admin_session: AsyncSession,
        email: str | None = None,
        password: str = "TestPass123!",
        role: str = "tenant_admin",
        tenant_name: str | None = None,
        existing_tenant_id: uuid.UUID | None = None,
    ) -> dict[str, Any]:
        """Create user, mint JWT, return headers + tenant/user info."""
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
        await admin_session.flush()

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
