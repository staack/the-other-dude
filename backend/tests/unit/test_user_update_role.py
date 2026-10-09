"""The user update schema applies the same role policy as the create schema."""

import pytest
from pydantic import ValidationError

from app.models.user import UserRole
from app.schemas.user import UserCreate, UserUpdate


def test_user_update_rejects_super_admin():
    with pytest.raises(ValidationError):
        UserUpdate(role=UserRole.SUPER_ADMIN)


def test_user_update_accepts_tenant_roles():
    for role in (UserRole.TENANT_ADMIN, UserRole.OPERATOR, UserRole.VIEWER):
        assert UserUpdate(role=role).role == role


def test_user_update_and_create_agree_on_allowed_roles():
    """One policy, two schemas: they must reject the same role."""
    with pytest.raises(ValidationError):
        UserCreate(name="x", email="x@example.com", password="longenough", role="super_admin")
    with pytest.raises(ValidationError):
        UserUpdate(role="super_admin")
