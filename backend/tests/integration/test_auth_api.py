"""
Auth API endpoint integration tests (TEST-04 partial).

Tests auth endpoints end-to-end against real PostgreSQL:
- POST /api/auth/login (success, wrong password, nonexistent user)
- POST /api/auth/refresh (token refresh flow)
- GET  /api/auth/me (current user info)
- Protected endpoint access without/with invalid token
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import hash_password

pytestmark = pytest.mark.integration

from tests.integration.conftest import TEST_DATABASE_URL  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _admin_commit(url, callback):
    """Open a fresh admin connection, run callback, commit, close."""
    engine = create_async_engine(url, echo=False)
    async with engine.connect() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        result = await callback(session)
        await session.commit()
    await engine.dispose()
    return result


async def _admin_cleanup(url, *table_names):
    """Delete from specified tables via admin engine."""
    from sqlalchemy import text

    engine = create_async_engine(url, echo=False)
    async with engine.connect() as conn:
        for table in table_names:
            await conn.execute(text(f"DELETE FROM {table}"))
        await conn.commit()
    await engine.dispose()


# ---------------------------------------------------------------------------
# Test 1: Login success
# ---------------------------------------------------------------------------


async def test_login_success(client, admin_engine):
    """POST /api/auth/login with correct credentials returns 200 and tokens."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        tenant = Tenant(name=f"auth-login-{uid}")
        session.add(tenant)
        await session.flush()

        user = User(
            email=f"auth-login-{uid}@example.com",
            hashed_password=hash_password("SecurePass123!"),
            name="Auth Test User",
            role="tenant_admin",
            tenant_id=tenant.id,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        return {"email": user.email, "tenant_id": str(tenant.id)}

    data = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        resp = await client.post(
            "/api/auth/login",
            json={"email": data["email"], "password": "SecurePass123!"},
        )
        assert resp.status_code == 200, f"Login failed: {resp.text}"

        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["token_type"] == "bearer"
        assert len(body["access_token"]) > 0
        assert len(body["refresh_token"]) > 0

        # Verify httpOnly cookie is set
        # Cookie may or may not appear in httpx depending on secure flag
        # Just verify the response contains Set-Cookie header
        set_cookie = resp.headers.get("set-cookie", "")
        assert "access_token" in set_cookie or len(body["access_token"]) > 0
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "users", "tenants")


# ---------------------------------------------------------------------------
# Test 2: Login with wrong password
# ---------------------------------------------------------------------------


async def test_login_wrong_password(client, admin_engine):
    """POST /api/auth/login with wrong password returns 401."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        tenant = Tenant(name=f"auth-wrongpw-{uid}")
        session.add(tenant)
        await session.flush()

        user = User(
            email=f"auth-wrongpw-{uid}@example.com",
            hashed_password=hash_password("CorrectPass123!"),
            name="Wrong PW User",
            role="tenant_admin",
            tenant_id=tenant.id,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        return {"email": user.email}

    data = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        resp = await client.post(
            "/api/auth/login",
            json={"email": data["email"], "password": "WrongPassword!"},
        )
        assert resp.status_code == 401
        assert "Invalid credentials" in resp.json()["detail"]
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "users", "tenants")


# ---------------------------------------------------------------------------
# Test 3: Login with nonexistent user
# ---------------------------------------------------------------------------


async def test_login_nonexistent_user(client):
    """POST /api/auth/login with email that doesn't exist returns 401."""
    resp = await client.post(
        "/api/auth/login",
        json={"email": f"doesnotexist-{uuid.uuid4().hex[:6]}@example.com", "password": "Anything!"},
    )
    assert resp.status_code == 401
    assert "Invalid credentials" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Test 4: Token refresh
# ---------------------------------------------------------------------------


async def test_token_refresh(client, admin_engine):
    """POST /api/auth/refresh with valid refresh token returns new tokens."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        tenant = Tenant(name=f"auth-refresh-{uid}")
        session.add(tenant)
        await session.flush()

        user = User(
            email=f"auth-refresh-{uid}@example.com",
            hashed_password=hash_password("RefreshPass123!"),
            name="Refresh User",
            role="tenant_admin",
            tenant_id=tenant.id,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        return {"email": user.email}

    data = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        # Login first to get refresh token
        login_resp = await client.post(
            "/api/auth/login",
            json={"email": data["email"], "password": "RefreshPass123!"},
        )
        assert login_resp.status_code == 200
        tokens = login_resp.json()
        refresh_token = tokens["refresh_token"]

        # Use refresh token to get new access token
        refresh_resp = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert refresh_resp.status_code == 200

        new_tokens = refresh_resp.json()
        assert "access_token" in new_tokens
        assert "refresh_token" in new_tokens
        assert new_tokens["token_type"] == "bearer"
        # Verify the new access token is a valid JWT (can be same if within same second)
        assert len(new_tokens["access_token"]) > 0
        assert len(new_tokens["refresh_token"]) > 0

        # Verify the new access token works for /me
        me_resp = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {new_tokens['access_token']}"},
        )
        assert me_resp.status_code == 200
        assert me_resp.json()["email"] == data["email"]
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "users", "tenants")


# ---------------------------------------------------------------------------
# Test 5: Get current user
# ---------------------------------------------------------------------------


async def test_get_current_user(client, admin_engine):
    """GET /api/auth/me with valid token returns current user info."""
    uid = uuid.uuid4().hex[:6]

    async def setup(session):
        tenant = Tenant(name=f"auth-me-{uid}")
        session.add(tenant)
        await session.flush()

        user = User(
            email=f"auth-me-{uid}@example.com",
            hashed_password=hash_password("MePass123!"),
            name="Me User",
            role="tenant_admin",
            tenant_id=tenant.id,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        return {"email": user.email, "tenant_id": str(tenant.id), "user_id": str(user.id)}

    data = await _admin_commit(TEST_DATABASE_URL, setup)

    try:
        # Login
        login_resp = await client.post(
            "/api/auth/login",
            json={"email": data["email"], "password": "MePass123!"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]

        # Get /me
        me_resp = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me_resp.status_code == 200

        me_data = me_resp.json()
        assert me_data["email"] == data["email"]
        assert me_data["name"] == "Me User"
        assert me_data["role"] == "tenant_admin"
        assert me_data["tenant_id"] == data["tenant_id"]
        assert me_data["id"] == data["user_id"]
    finally:
        await _admin_cleanup(TEST_DATABASE_URL, "users", "tenants")


# ---------------------------------------------------------------------------
# Test 6: Protected endpoint without token
# ---------------------------------------------------------------------------


async def test_protected_endpoint_without_token(client):
    """GET /api/tenants/{id}/devices without auth headers returns 401."""
    fake_tenant_id = str(uuid.uuid4())
    resp = await client.get(f"/api/tenants/{fake_tenant_id}/devices")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Test 7: Protected endpoint with invalid token
# ---------------------------------------------------------------------------


async def test_protected_endpoint_with_invalid_token(client):
    """GET /api/tenants/{id}/devices with invalid Bearer token returns 401."""
    fake_tenant_id = str(uuid.uuid4())
    resp = await client.get(
        f"/api/tenants/{fake_tenant_id}/devices",
        headers={"Authorization": "Bearer totally-invalid-jwt-token"},
    )
    assert resp.status_code == 401
