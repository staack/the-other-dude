"""Unit tests for the JWT authentication service.

Tests cover:
- Password hashing and verification (bcrypt)
- JWT access token creation and validation
- JWT refresh token creation and validation
- Token rejection for wrong type, expired, invalid, missing subject

These are pure function tests -- no database or async required.
"""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from jose import jwt

from app.services.auth import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_token,
)
from app.config import settings


class TestPasswordHashing:
    """Tests for bcrypt password hashing."""

    def test_hash_returns_different_string(self):
        password = "test-password-123!"
        hashed = hash_password(password)
        assert hashed != password

    def test_hash_verify_roundtrip(self):
        password = "test-password-123!"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True

    def test_verify_rejects_wrong_password(self):
        hashed = hash_password("correct-password")
        assert verify_password("wrong-password", hashed) is False

    def test_hash_uses_unique_salts(self):
        """Each hash should be different even for the same password (random salt)."""
        hash1 = hash_password("same-password")
        hash2 = hash_password("same-password")
        assert hash1 != hash2

    def test_verify_both_hashes_valid(self):
        """Both unique hashes should verify against the original password."""
        password = "same-password"
        hash1 = hash_password(password)
        hash2 = hash_password(password)
        assert verify_password(password, hash1) is True
        assert verify_password(password, hash2) is True


class TestAccessToken:
    """Tests for JWT access token creation and validation."""

    def test_create_and_verify_roundtrip(self):
        user_id = uuid.uuid4()
        tenant_id = uuid.uuid4()
        token = create_access_token(user_id=user_id, tenant_id=tenant_id, role="admin")
        payload = verify_token(token, expected_type="access")

        assert payload["sub"] == str(user_id)
        assert payload["tenant_id"] == str(tenant_id)
        assert payload["role"] == "admin"
        assert payload["type"] == "access"

    def test_super_admin_null_tenant(self):
        user_id = uuid.uuid4()
        token = create_access_token(user_id=user_id, tenant_id=None, role="super_admin")
        payload = verify_token(token, expected_type="access")

        assert payload["sub"] == str(user_id)
        assert payload["tenant_id"] is None
        assert payload["role"] == "super_admin"

    def test_contains_expiry(self):
        token = create_access_token(
            user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), role="viewer"
        )
        payload = verify_token(token, expected_type="access")
        assert "exp" in payload
        assert "iat" in payload


class TestRefreshToken:
    """Tests for JWT refresh token creation and validation."""

    def test_create_and_verify_roundtrip(self):
        user_id = uuid.uuid4()
        token = create_refresh_token(user_id=user_id)
        payload = verify_token(token, expected_type="refresh")

        assert payload["sub"] == str(user_id)
        assert payload["type"] == "refresh"

    def test_refresh_token_has_no_tenant_or_role(self):
        token = create_refresh_token(user_id=uuid.uuid4())
        payload = verify_token(token, expected_type="refresh")

        # Refresh tokens intentionally omit tenant_id and role
        assert "tenant_id" not in payload
        assert "role" not in payload


class TestTokenRejection:
    """Tests for JWT token validation failure cases."""

    def test_rejects_wrong_type(self):
        """Access token should not verify as refresh, and vice versa."""
        access_token = create_access_token(
            user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), role="admin"
        )
        with pytest.raises(HTTPException) as exc_info:
            verify_token(access_token, expected_type="refresh")
        assert exc_info.value.status_code == 401

    def test_rejects_expired_token(self):
        """Manually craft an expired token and verify it is rejected."""
        expired_payload = {
            "sub": str(uuid.uuid4()),
            "type": "access",
            "exp": datetime.now(UTC) - timedelta(hours=1),
            "iat": datetime.now(UTC) - timedelta(hours=2),
        }
        expired_token = jwt.encode(
            expired_payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
        )
        with pytest.raises(HTTPException) as exc_info:
            verify_token(expired_token, expected_type="access")
        assert exc_info.value.status_code == 401

    def test_rejects_invalid_token(self):
        with pytest.raises(HTTPException) as exc_info:
            verify_token("not-a-valid-jwt", expected_type="access")
        assert exc_info.value.status_code == 401

    def test_rejects_wrong_signing_key(self):
        """Token signed with a different key should be rejected."""
        payload = {
            "sub": str(uuid.uuid4()),
            "type": "access",
            "exp": datetime.now(UTC) + timedelta(hours=1),
        }
        wrong_key_token = jwt.encode(payload, "wrong-secret-key", algorithm="HS256")
        with pytest.raises(HTTPException) as exc_info:
            verify_token(wrong_key_token, expected_type="access")
        assert exc_info.value.status_code == 401

    def test_rejects_missing_subject(self):
        """Token without 'sub' claim should be rejected."""
        no_sub_payload = {
            "type": "access",
            "exp": datetime.now(UTC) + timedelta(hours=1),
        }
        no_sub_token = jwt.encode(
            no_sub_payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
        )
        with pytest.raises(HTTPException) as exc_info:
            verify_token(no_sub_token, expected_type="access")
        assert exc_info.value.status_code == 401
