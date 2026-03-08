"""Database engine, session factory, and dependency injection."""

import uuid
from collections.abc import AsyncGenerator
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


# Primary engine using postgres superuser (for migrations/admin)
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=settings.DB_ADMIN_POOL_SIZE,
    max_overflow=settings.DB_ADMIN_MAX_OVERFLOW,
)

# App user engine (enforces RLS — no superuser bypass)
app_engine = create_async_engine(
    settings.APP_USER_DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
)

# Session factory for the app_user connection (RLS enforced)
AsyncSessionLocal = async_sessionmaker(
    app_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Admin session factory (for bootstrap/migrations only)
AdminAsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency that yields an async database session using app_user (RLS enforced).

    The tenant context (SET LOCAL app.current_tenant) must be set by
    tenant_context middleware before any tenant-scoped queries.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_admin_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency that yields an admin database session (bypasses RLS).
    USE ONLY for bootstrap operations and internal system tasks.
    """
    async with AdminAsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def set_tenant_context(session: AsyncSession, tenant_id: Optional[str]) -> None:
    """
    Set the PostgreSQL session variable for RLS enforcement.

    This MUST be called before any tenant-scoped query to activate RLS policies.
    Uses SET LOCAL so the context resets at transaction end.
    """
    if tenant_id:
        # Allow 'super_admin' as a special RLS context value for cross-tenant access.
        # Otherwise validate tenant_id is a valid UUID to prevent SQL injection.
        # SET LOCAL cannot use parameterized queries in PostgreSQL.
        if tenant_id != "super_admin":
            try:
                uuid.UUID(tenant_id)
            except ValueError:
                raise ValueError(f"Invalid tenant_id format: {tenant_id!r}")
        await session.execute(text(f"SET LOCAL app.current_tenant = '{tenant_id}'"))
    else:
        # For super_admin users: set empty string which will not match any tenant
        # The super_admin uses the admin engine which bypasses RLS
        await session.execute(text("SET LOCAL app.current_tenant = ''"))
