"""
Authentication endpoints.

POST /api/auth/login                  — email/password login, returns JWT tokens
POST /api/auth/refresh                — refresh access token using refresh token
POST /api/auth/logout                 — clear httpOnly cookie
GET  /api/auth/me                     — return current user info
POST /api/auth/forgot-password        — send password reset email
POST /api/auth/reset-password         — reset password with token
POST /api/auth/srp/init               — SRP Step 1: return salt and server ephemeral B
POST /api/auth/srp/verify             — SRP Step 2: verify client proof M1, return tokens
GET  /api/auth/emergency-kit-template — generate Emergency Kit PDF (without Secret Key)
POST /api/auth/register-srp           — store SRP verifier and encrypted key set
"""

import base64
import hashlib
import io
import json
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request as StarletteRequest

from app.config import settings
from app.database import AdminAsyncSessionLocal, get_admin_db
from app.services.audit_service import log_action
from app.services.srp_service import srp_init, srp_verify
from app.services.key_service import get_user_key_set, log_key_access, store_user_key_set
from app.middleware.rate_limit import limiter
from app.middleware.rbac import require_authenticated
from app.middleware.tenant_context import CurrentUser
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    DeleteAccountResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    ResetPasswordRequest,
    SRPInitRequest,
    SRPInitResponse,
    SRPRegisterRequest,
    SRPVerifyRequest,
    SRPVerifyResponse,
    TokenResponse,
    UserMeResponse,
)
from app.services.account_service import delete_user_account, export_user_data
from app.services.auth import (
    create_access_token,
    create_refresh_token,
    hash_password,
    is_token_revoked,
    revoke_user_tokens,
    verify_password,
    verify_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Access token cookie settings
ACCESS_TOKEN_COOKIE = "access_token"
ACCESS_TOKEN_MAX_AGE = 15 * 60  # 15 minutes in seconds

# Refresh token cookie settings (httpOnly, longer-lived)
REFRESH_TOKEN_COOKIE = "refresh_token"
REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds

# Cookie Secure flag requires HTTPS. Safari strictly enforces this —
# it silently drops Secure cookies over plain HTTP, unlike Chrome
# which exempts localhost. Auto-detect from CORS origins: if all
# origins are HTTPS, enable Secure; otherwise disable it.
_COOKIE_SECURE = all(
    o.startswith("https://") for o in (settings.CORS_ORIGINS or "").split(",") if o.strip()
)

# ─── Redis for SRP Sessions ──────────────────────────────────────────────────

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    """Lazily initialise and return the SRP Redis client."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


# ─── SRP Zero-Knowledge Authentication ───────────────────────────────────────


@router.post("/srp/init", response_model=SRPInitResponse, summary="SRP Step 1: return salt and server ephemeral B")
@limiter.limit("5/minute")
async def srp_init_endpoint(
    request: StarletteRequest,
    body: SRPInitRequest,
    db: AsyncSession = Depends(get_admin_db),
) -> SRPInitResponse:
    """SRP Step 1: Return salt and server ephemeral B.

    Anti-enumeration: returns a deterministic fake response if the user
    does not exist or has no SRP credentials. The fake response is
    derived from a hash of the email so it is consistent for repeated
    queries against the same unknown address.
    """
    # Look up user (case-insensitive)
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()

    # Anti-enumeration: return fake salt/B if user not found or not SRP-enrolled
    if not user or not user.srp_verifier:
        fake_hash = hashlib.sha256(f"srp-fake-{body.email}".encode()).hexdigest()
        return SRPInitResponse(
            salt=fake_hash[:64],
            server_public=fake_hash * 8,  # 512 hex chars (256 bytes)
            session_id=secrets.token_urlsafe(16),
            pbkdf2_salt=base64.b64encode(bytes.fromhex(fake_hash[:64])).decode(),
            hkdf_salt=base64.b64encode(bytes.fromhex(fake_hash[:64])).decode(),
        )

    # Fetch key derivation salts from user_key_sets (needed by client BEFORE SRP verify)
    key_set = await get_user_key_set(db, user.id)

    # Generate server ephemeral
    try:
        server_public, server_private = await srp_init(
            user.email, user.srp_verifier.hex()
        )
    except ValueError as e:
        logger.error("SRP init failed for %s: %s", user.email, e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authentication initialization failed. Please try again.",
        )

    # Store session in Redis with 60s TTL
    session_id = secrets.token_urlsafe(16)
    redis = await get_redis()
    session_data = json.dumps({
        "email": user.email,
        "server_private": server_private,
        "srp_verifier_hex": user.srp_verifier.hex(),
        "srp_salt_hex": user.srp_salt.hex(),
        "user_id": str(user.id),
    })
    await redis.set(f"srp:session:{session_id}", session_data, ex=60)

    return SRPInitResponse(
        salt=user.srp_salt.hex(),
        server_public=server_public,
        session_id=session_id,
        pbkdf2_salt=base64.b64encode(key_set.pbkdf2_salt).decode() if key_set else "",
        hkdf_salt=base64.b64encode(key_set.hkdf_salt).decode() if key_set else "",
    )


@router.post("/srp/verify", response_model=SRPVerifyResponse, summary="SRP Step 2: verify client proof and return tokens")
@limiter.limit("5/minute")
async def srp_verify_endpoint(
    request: StarletteRequest,
    body: SRPVerifyRequest,
    response: Response,
    db: AsyncSession = Depends(get_admin_db),
) -> SRPVerifyResponse:
    """SRP Step 2: Verify client proof M1, return server proof M2 + JWT tokens.

    The session is consumed (deleted from Redis) immediately on retrieval
    to enforce single-use. If the proof is invalid, the session cannot
    be retried — the client must restart from /srp/init.
    """
    invalid_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
    )

    # Retrieve session from Redis
    redis = await get_redis()
    session_raw = await redis.get(f"srp:session:{body.session_id}")
    if not session_raw:
        raise invalid_error

    # Delete session immediately (one-use)
    await redis.delete(f"srp:session:{body.session_id}")

    session = json.loads(session_raw)

    # Verify email matches
    if session["email"] != body.email.lower():
        raise invalid_error

    # Run SRP verification
    try:
        is_valid, server_proof = await srp_verify(
            email=session["email"],
            srp_verifier_hex=session["srp_verifier_hex"],
            server_private=session["server_private"],
            client_public=body.client_public,
            client_proof=body.client_proof,
            srp_salt_hex=session["srp_salt_hex"],
        )
    except ValueError as e:
        logger.error("SRP verify failed for %s: %s", session["email"], e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authentication verification failed. Please try again.",
        )

    if not is_valid:
        raise invalid_error

    # Fetch user for token creation
    user_id = uuid.UUID(session["user_id"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise invalid_error

    # Create JWT tokens (same as existing login)
    access_token = create_access_token(user.id, user.tenant_id, user.role)
    refresh_token = create_refresh_token(user.id)

    # Update last_login and clear upgrade flag on successful SRP login
    await db.execute(
        update(User).where(User.id == user.id).values(
            last_login=datetime.now(UTC),
            must_upgrade_auth=False,
        )
    )
    await db.commit()

    # Set access token cookie
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=access_token,
        max_age=ACCESS_TOKEN_MAX_AGE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
    )
    # Set refresh token cookie (httpOnly, scoped to refresh endpoint)
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE,
        value=refresh_token,
        max_age=REFRESH_TOKEN_MAX_AGE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        path="/api/auth/refresh",
    )

    # Fetch encrypted key set
    key_set = await get_user_key_set(db, user.id)
    encrypted_key_set = None
    if key_set:
        encrypted_key_set = {
            "encrypted_private_key": base64.b64encode(key_set.encrypted_private_key).decode(),
            "private_key_nonce": base64.b64encode(key_set.private_key_nonce).decode(),
            "encrypted_vault_key": base64.b64encode(key_set.encrypted_vault_key).decode(),
            "vault_key_nonce": base64.b64encode(key_set.vault_key_nonce).decode(),
            "public_key": base64.b64encode(key_set.public_key).decode(),
            "pbkdf2_salt": base64.b64encode(key_set.pbkdf2_salt).decode(),
            "hkdf_salt": base64.b64encode(key_set.hkdf_salt).decode(),
            "pbkdf2_iterations": key_set.pbkdf2_iterations,
        }

    # Audit log
    try:
        async with AdminAsyncSessionLocal() as audit_db:
            await log_action(
                audit_db,
                tenant_id=user.tenant_id or uuid.UUID(int=0),
                user_id=user.id,
                action="login_srp",
                resource_type="auth",
                details={"email": user.email, "role": user.role},
                ip_address=request.client.host if request.client else None,
            )
            await audit_db.commit()
    except Exception:
        pass

    return SRPVerifyResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        server_proof=server_proof or "",
        encrypted_key_set=encrypted_key_set,
    )


@router.post("/login", response_model=TokenResponse, summary="Authenticate with email and password")
@limiter.limit("5/minute")
async def login(
    request: StarletteRequest,
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_admin_db),
) -> TokenResponse:
    """
    Login entry point — redirects to SRP for all enrolled users.

    For SRP-enrolled users: returns 409 srp_required (frontend auto-switches).
    For legacy bcrypt users (must_upgrade_auth=True): verifies bcrypt password
    and returns a temporary session with auth_upgrade_required=True so the
    frontend can register SRP credentials before completing login.

    Anti-enumeration: dummy verify_password for unknown users preserves timing.
    Rate limited to 5 requests per minute per IP.
    """
    # Look up user by email (case-insensitive)
    result = await db.execute(
        select(User).where(User.email == body.email.lower())
    )
    user = result.scalar_one_or_none()

    # Generic error — do not reveal whether email exists (no user enumeration)
    invalid_credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not user:
        # Perform dummy verification to prevent timing attacks
        verify_password("dummy", "$2b$12$/MSofyKqE3MkwXyzhigw.OHIefMM.qb5xGt/t9OAwbxgDGnyZjmrG")
        raise invalid_credentials_error

    if not user.is_active:
        # Still run dummy verify for timing consistency
        verify_password("dummy", "$2b$12$/MSofyKqE3MkwXyzhigw.OHIefMM.qb5xGt/t9OAwbxgDGnyZjmrG")
        raise invalid_credentials_error

    # SRP-enrolled users: redirect to SRP flow
    if user.srp_verifier is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="srp_required",
            headers={"X-Auth-Method": "srp"},
        )

    # Bcrypt user (auth_version 1) — verify password
    if user.hashed_password:
        if not verify_password(body.password, user.hashed_password):
            raise invalid_credentials_error

        # Correct bcrypt password — issue session
        access_token = create_access_token(
            user_id=user.id,
            tenant_id=user.tenant_id,
            role=user.role,
        )
        refresh = create_refresh_token(user.id)

        response.set_cookie(
            key=ACCESS_TOKEN_COOKIE,
            value=access_token,
            max_age=ACCESS_TOKEN_MAX_AGE,
            httponly=True,
            secure=_COOKIE_SECURE,
            samesite="lax",
        )
        # Also set refresh token as httpOnly cookie so auto-refresh works
        # without the frontend needing to persist the token in JS memory.
        if not user.must_upgrade_auth:
            response.set_cookie(
                key=REFRESH_TOKEN_COOKIE,
                value=refresh,
                max_age=REFRESH_TOKEN_MAX_AGE,
                httponly=True,
                secure=_COOKIE_SECURE,
                samesite="lax",
                path="/api/auth/refresh",  # scope cookie to refresh endpoint only
            )

        # Update last_login
        await db.execute(
            update(User).where(User.id == user.id).values(
                last_login=datetime.now(UTC),
            )
        )
        await db.commit()

        # Audit log (fire-and-forget)
        try:
            async with AdminAsyncSessionLocal() as audit_db:
                await log_action(
                    audit_db,
                    tenant_id=user.tenant_id or uuid.UUID(int=0),
                    user_id=user.id,
                    action="login_upgrade" if user.must_upgrade_auth else "login",
                    resource_type="auth",
                    details={"email": user.email, **({"upgrade": "bcrypt_to_srp"} if user.must_upgrade_auth else {})},
                    ip_address=request.client.host if request.client else None,
                )
                await audit_db.commit()
        except Exception:
            pass

        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh if not user.must_upgrade_auth else "",
            token_type="bearer",
            auth_upgrade_required=user.must_upgrade_auth,
        )

    # No valid credentials at all
    raise invalid_credentials_error


@router.post("/refresh", response_model=TokenResponse, summary="Refresh access token")
@limiter.limit("10/minute")
async def refresh_token(
    request: StarletteRequest,
    body: Optional[RefreshRequest] = None,
    response: Response = None,
    db: AsyncSession = Depends(get_admin_db),
    redis: aioredis.Redis = Depends(get_redis),
    refresh_token_cookie: Optional[str] = Cookie(default=None, alias="refresh_token"),
) -> TokenResponse:
    """
    Exchange a valid refresh token for a new access token.

    Accepts the refresh token either in the JSON body (legacy) or as an
    httpOnly cookie named 'refresh_token' (preferred — set automatically at login).
    Rate limited to 10 requests per minute per IP.
    """
    # Resolve token: body takes precedence over cookie
    raw_token = (body.refresh_token if body and body.refresh_token else None) or refresh_token_cookie
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token provided",
        )

    # Validate refresh token
    payload = verify_token(raw_token, expected_type="refresh")

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Check if token was revoked (issued before logout)
    issued_at = payload.get("iat", 0)
    if await is_token_revoked(redis, user_id_str, float(issued_at)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    # Fetch current user state from DB
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Issue new tokens
    new_access_token = create_access_token(
        user_id=user.id,
        tenant_id=user.tenant_id,
        role=user.role,
    )
    new_refresh_token = create_refresh_token(user_id=user.id)

    # Rotate access token cookie
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=new_access_token,
        max_age=ACCESS_TOKEN_MAX_AGE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
    )
    # Rotate refresh token cookie (silent token rotation)
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE,
        value=new_refresh_token,
        max_age=REFRESH_TOKEN_MAX_AGE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        path="/api/auth/refresh",
    )

    return TokenResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Log out and clear session cookie")
@limiter.limit("10/minute")
async def logout(
    request: StarletteRequest,
    response: Response,
    current_user: CurrentUser = Depends(require_authenticated),
    redis: aioredis.Redis = Depends(get_redis),
) -> None:
    """Clear the httpOnly access token cookie and revoke all refresh tokens."""
    # Revoke all refresh tokens for this user
    await revoke_user_tokens(redis, str(current_user.user_id))

    # Audit log for logout
    try:
        tenant_id = current_user.tenant_id or uuid.UUID(int=0)
        async with AdminAsyncSessionLocal() as audit_db:
            await log_action(
                audit_db, tenant_id, current_user.user_id, "logout",
                resource_type="auth",
                ip_address=request.client.host if request.client else None,
            )
            await audit_db.commit()
    except Exception:
        pass  # Fire-and-forget: never fail logout

    response.delete_cookie(
        key=ACCESS_TOKEN_COOKIE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
    )
    response.delete_cookie(
        key=REFRESH_TOKEN_COOKIE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        path="/api/auth/refresh",
    )


@router.post("/change-password", response_model=MessageResponse, summary="Change password for authenticated user")
@limiter.limit("3/minute")
async def change_password(
    request: StarletteRequest,
    body: ChangePasswordRequest,
    current_user: CurrentUser = Depends(require_authenticated),
    db: AsyncSession = Depends(get_admin_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> MessageResponse:
    """Change the current user's password. Revokes all existing sessions."""
    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # For SRP users (auth_version 2): client must provide new salt, verifier, and key bundle
    if user.auth_version == 2:
        if not body.new_srp_salt or not body.new_srp_verifier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="SRP users must provide new salt and verifier",
            )
        # Update SRP credentials
        user.srp_salt = bytes.fromhex(body.new_srp_salt)
        user.srp_verifier = bytes.fromhex(body.new_srp_verifier)

        # Also update bcrypt hash as a login fallback if SRP ever fails
        # (e.g., crypto.subtle unavailable on HTTP, stale Secret Key, etc.)
        if body.new_password:
            user.hashed_password = hash_password(body.new_password)

        # Update re-wrapped key bundle if provided
        if body.encrypted_private_key and body.pbkdf2_salt:
            existing_ks = await get_user_key_set(db, user.id)
            if existing_ks:
                existing_ks.encrypted_private_key = base64.b64decode(body.encrypted_private_key)
                existing_ks.private_key_nonce = base64.b64decode(body.private_key_nonce or "")
                existing_ks.encrypted_vault_key = base64.b64decode(body.encrypted_vault_key or "")
                existing_ks.vault_key_nonce = base64.b64decode(body.vault_key_nonce or "")
                existing_ks.public_key = base64.b64decode(body.public_key or "")
                existing_ks.pbkdf2_salt = base64.b64decode(body.pbkdf2_salt)
                existing_ks.hkdf_salt = base64.b64decode(body.hkdf_salt or "")
    else:
        # Legacy bcrypt user — verify current password
        if not user.hashed_password or not verify_password(body.current_password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )
        user.hashed_password = hash_password(body.new_password)

    # Revoke all existing sessions
    await revoke_user_tokens(redis, str(user.id))

    await db.commit()

    # Audit log
    try:
        async with AdminAsyncSessionLocal() as audit_db:
            await log_action(
                audit_db,
                tenant_id=user.tenant_id or uuid.UUID(int=0),
                user_id=user.id,
                action="password_change",
                resource_type="user",
                details={"ip": request.client.host if request.client else None},
                ip_address=request.client.host if request.client else None,
            )
            await audit_db.commit()
    except Exception:
        pass

    return MessageResponse(message="Password changed successfully. Please sign in again.")


@router.get("/me", response_model=UserMeResponse, summary="Get current user profile")
async def get_me(
    current_user: CurrentUser = Depends(require_authenticated),
    db: AsyncSession = Depends(get_admin_db),
) -> UserMeResponse:
    """Return current user info from JWT payload."""
    # Fetch from DB to get latest data
    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserMeResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        tenant_id=user.tenant_id,
        auth_version=user.auth_version or 1,
    )


# ─── Account Self-Service (Deletion & Export) ─────────────────────────────────


@router.delete(
    "/delete-my-account",
    response_model=DeleteAccountResponse,
    summary="Delete your own account and erase all PII",
)
@limiter.limit("1/minute")
async def delete_my_account(
    request: StarletteRequest,
    body: DeleteAccountRequest,
    response: Response,
    current_user: CurrentUser = Depends(require_authenticated),
    db: AsyncSession = Depends(get_admin_db),
) -> DeleteAccountResponse:
    """Permanently delete the authenticated user's account.

    Performs full PII erasure: anonymizes audit logs, scrubs encrypted
    details, and hard-deletes the user row (CASCADE handles related
    tables). Requires typing 'DELETE' as confirmation.
    """
    from sqlalchemy import text as sa_text

    # Validate confirmation
    if body.confirmation != "DELETE":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="You must type 'DELETE' to confirm account deletion.",
        )

    # Super admin protection: cannot delete last super admin
    if current_user.role == "super_admin":
        result = await db.execute(
            sa_text(
                "SELECT COUNT(*) AS cnt FROM users "
                "WHERE role = 'super_admin' AND is_active = true "
                "AND id != :current_user_id"
            ),
            {"current_user_id": current_user.user_id},
        )
        other_admins = result.scalar_one()
        if other_admins == 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot delete the last super admin account. Transfer the role first.",
            )

    # Fetch user email BEFORE deletion (needed for audit hash)
    result = await db.execute(
        sa_text("SELECT email FROM users WHERE id = :user_id"),
        {"user_id": current_user.user_id},
    )
    email_row = result.mappings().first()
    if not email_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )
    user_email = email_row["email"]

    # Perform account deletion
    await delete_user_account(
        db=db,
        user_id=current_user.user_id,
        tenant_id=current_user.tenant_id,
        user_email=user_email,
    )

    # Clear access token cookie (same pattern as logout)
    response.delete_cookie(
        key=ACCESS_TOKEN_COOKIE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
    )

    return DeleteAccountResponse(
        message="Account deleted successfully. All personal data has been erased.",
        deleted=True,
    )


@router.get(
    "/export-my-data",
    summary="Export all your personal data (GDPR Art. 20)",
)
@limiter.limit("3/minute")
async def export_my_data(
    request: StarletteRequest,
    current_user: CurrentUser = Depends(require_authenticated),
    db: AsyncSession = Depends(get_admin_db),
) -> JSONResponse:
    """Export all personal data for the authenticated user.

    Returns a JSON file containing user profile, API keys, audit logs,
    and key access log entries. Complies with GDPR Article 20
    (Right to Data Portability).
    """
    data = await export_user_data(
        db=db,
        user_id=current_user.user_id,
        tenant_id=current_user.tenant_id,
    )

    # Audit log the export action
    try:
        async with AdminAsyncSessionLocal() as audit_db:
            await log_action(
                audit_db,
                tenant_id=current_user.tenant_id or uuid.UUID(int=0),
                user_id=current_user.user_id,
                action="data_export",
                resource_type="user",
                details={"type": "gdpr_art20"},
                ip_address=request.client.host if request.client else None,
            )
            await audit_db.commit()
    except Exception:
        pass  # Fire-and-forget: never fail the export

    return JSONResponse(
        content=data,
        headers={
            "Content-Disposition": 'attachment; filename="my-data-export.json"',
        },
    )


# ─── Emergency Kit & SRP Registration ─────────────────────────────────────────


@router.get("/emergency-kit-template", summary="Generate Emergency Kit PDF template")
@limiter.limit("3/minute")
async def get_emergency_kit_template(
    request: StarletteRequest,
    current_user: CurrentUser = Depends(require_authenticated),
    db: AsyncSession = Depends(get_admin_db),
) -> StreamingResponse:
    """Generate Emergency Kit PDF template (without Secret Key).

    The Secret Key is injected client-side. This endpoint returns
    a PDF with a placeholder that the browser fills in before
    the user downloads it.
    """
    from app.services.emergency_kit_service import generate_emergency_kit_template

    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    pdf_bytes = await generate_emergency_kit_template(email=user.email)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="MikroTik-Portal-Emergency-Kit.pdf"',
        },
    )


@router.post("/register-srp", response_model=MessageResponse, summary="Register SRP credentials for a user")
@limiter.limit("3/minute")
async def register_srp(
    request: StarletteRequest,
    body: SRPRegisterRequest,
    current_user: CurrentUser = Depends(require_authenticated),
    db: AsyncSession = Depends(get_admin_db),
) -> MessageResponse:
    """Store SRP verifier and encrypted key set for the current user.

    Called after client-side key generation during initial setup
    or when upgrading from bcrypt to SRP.
    """
    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.srp_verifier is not None:
        raise HTTPException(status_code=409, detail="SRP already registered")

    # Update user with SRP credentials and clear upgrade flag
    await db.execute(
        update(User).where(User.id == user.id).values(
            srp_salt=bytes.fromhex(body.srp_salt),
            srp_verifier=bytes.fromhex(body.srp_verifier),
            auth_version=2,
            must_upgrade_auth=False,
        )
    )

    # Store encrypted key set
    await store_user_key_set(
        db=db,
        user_id=user.id,
        tenant_id=user.tenant_id,
        encrypted_private_key=base64.b64decode(body.encrypted_private_key),
        private_key_nonce=base64.b64decode(body.private_key_nonce),
        encrypted_vault_key=base64.b64decode(body.encrypted_vault_key),
        vault_key_nonce=base64.b64decode(body.vault_key_nonce),
        public_key=base64.b64decode(body.public_key),
        pbkdf2_salt=base64.b64decode(body.pbkdf2_salt),
        hkdf_salt=base64.b64decode(body.hkdf_salt),
    )

    await db.commit()

    # Audit log
    try:
        async with AdminAsyncSessionLocal() as audit_db:
            await log_key_access(
                audit_db, user.tenant_id or uuid.UUID(int=0), user.id,
                "create_key_set", resource_type="user_key_set",
                ip_address=request.client.host if request.client else None,
            )
            await audit_db.commit()
    except Exception:
        pass

    return MessageResponse(message="SRP credentials registered successfully")


# ─── SSE Exchange Tokens ─────────────────────────────────────────────────────


@router.post("/sse-token", summary="Issue a short-lived SSE exchange token")
async def create_sse_token(
    current_user: CurrentUser = Depends(require_authenticated),
    redis: aioredis.Redis = Depends(get_redis),
) -> dict:
    """Issue a 30-second, single-use token for SSE connections.

    Replaces sending the full JWT in the SSE URL query parameter.
    The returned token is stored in Redis with user context and a 30s TTL.
    The SSE endpoint retrieves and deletes it on first use (single-use).
    """
    token = secrets.token_urlsafe(32)
    key = f"sse_token:{token}"
    # Store user context for the SSE endpoint to retrieve
    await redis.set(key, json.dumps({
        "user_id": str(current_user.user_id),
        "tenant_id": str(current_user.tenant_id) if current_user.tenant_id else None,
        "role": current_user.role,
    }), ex=30)  # 30 second TTL
    return {"token": token}


# ─── Password Reset ──────────────────────────────────────────────────────────


def _hash_token(token: str) -> str:
    """SHA-256 hash a reset token so plaintext is never stored."""
    return hashlib.sha256(token.encode()).hexdigest()


async def _send_reset_email(email: str, token: str) -> None:
    """Send password reset email via unified email service."""
    from app.routers.settings import get_smtp_config
    from app.services.email_service import send_email

    reset_url = f"{settings.APP_BASE_URL}/reset-password?token={token}"
    expire_mins = settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES

    plain = (
        f"You requested a password reset for The Other Dude.\n\n"
        f"Click the link below to reset your password (valid for {expire_mins} minutes):\n\n"
        f"{reset_url}\n\n"
        f"If you did not request this, you can safely ignore this email."
    )

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0f172a; padding: 24px; border-radius: 8px 8px 0 0;">
            <h2 style="color: #38bdf8; margin: 0;">Password Reset</h2>
        </div>
        <div style="background: #1e293b; padding: 24px; border-radius: 0 0 8px 8px; color: #e2e8f0;">
            <p>You requested a password reset for The Other Dude.</p>
            <p>Click the button below to reset your password. This link is valid for {expire_mins} minutes.</p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="{reset_url}" style="background: #38bdf8; color: #0f172a; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                    Reset Password
                </a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">
                If you did not request this, you can safely ignore this email.
            </p>
            <p style="color: #64748b; font-size: 12px; margin-top: 24px;">
                TOD — Fleet Management for MikroTik RouterOS
            </p>
        </div>
    </div>
    """

    smtp_config = await get_smtp_config()
    await send_email(email, "TOD — Password Reset", html, plain, smtp_config)


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    summary="Request password reset email",
)
@limiter.limit("3/minute")
async def forgot_password(
    request: StarletteRequest,
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_admin_db),
) -> MessageResponse:
    """Send a password reset link if the email exists.

    Always returns success to prevent user enumeration.
    Rate limited to 3 requests per minute per IP.
    """
    generic_msg = "If an account with that email exists, a reset link has been sent."

    result = await db.execute(
        select(User).where(User.email == body.email.lower())
    )
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        return MessageResponse(message=generic_msg)

    # Generate a secure token
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = datetime.now(UTC) + timedelta(
        minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    )

    # Insert token record (using raw SQL to avoid importing the model globally)
    from sqlalchemy import text

    await db.execute(
        text(
            "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) "
            "VALUES (:user_id, :token_hash, :expires_at)"
        ),
        {"user_id": user.id, "token_hash": token_hash, "expires_at": expires_at},
    )
    await db.commit()

    # Send email (best-effort)
    try:
        await _send_reset_email(user.email, raw_token)
    except Exception as e:
        logger.warning("Failed to send password reset email to %s: %s", user.email, e)

    return MessageResponse(message=generic_msg)


@router.post(
    "/reset-password",
    response_model=MessageResponse,
    summary="Reset password with token",
)
@limiter.limit("5/minute")
async def reset_password(
    request: StarletteRequest,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_admin_db),
) -> MessageResponse:
    """Validate the reset token and update the user's password.

    Rate limited to 5 requests per minute per IP.
    """
    from sqlalchemy import text

    token_hash = _hash_token(body.token)

    # Find the token record
    result = await db.execute(
        text(
            "SELECT id, user_id, expires_at, used_at "
            "FROM password_reset_tokens "
            "WHERE token_hash = :token_hash"
        ),
        {"token_hash": token_hash},
    )
    row = result.mappings().first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )

    if row["used_at"] is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link has already been used.",
        )

    if row["expires_at"] < datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )

    # Validate password strength (minimum 8 characters)
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters.",
        )

    # Update the user's password and clear SRP credentials for re-registration.
    # The bcrypt hash is kept as a temporary credential for the upgrade flow:
    # user logs in with bcrypt -> gets temp session -> registers SRP -> done.
    new_hash = hash_password(body.new_password)
    await db.execute(
        text(
            "UPDATE users SET hashed_password = :pw, auth_version = 1, "
            "must_upgrade_auth = true, srp_salt = NULL, srp_verifier = NULL, "
            "updated_at = now() WHERE id = :uid"
        ),
        {"pw": new_hash, "uid": row["user_id"]},
    )

    # Mark token as used
    await db.execute(
        text("UPDATE password_reset_tokens SET used_at = now() WHERE id = :tid"),
        {"tid": row["id"]},
    )

    await db.commit()

    # Audit log
    try:
        async with AdminAsyncSessionLocal() as audit_db:
            await log_action(
                audit_db,
                tenant_id=uuid.UUID(int=0),
                user_id=row["user_id"],
                action="password_reset",
                resource_type="auth",
                ip_address=request.client.host if request.client else None,
            )
            await audit_db.commit()
    except Exception:
        pass

    return MessageResponse(message="Password has been reset successfully.")
