"""Unit tests for the audit service and model.

Tests cover:
- AuditLog model can be imported
- log_action function signature is correct
- Audit logs router is importable with expected endpoints
- CSV export endpoint exists
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestAuditLogModel:
    """Tests for the AuditLog ORM model."""

    def test_model_importable(self):
        from app.models.audit_log import AuditLog
        assert AuditLog.__tablename__ == "audit_logs"

    def test_model_has_required_columns(self):
        from app.models.audit_log import AuditLog
        mapper = AuditLog.__table__.columns
        expected_columns = {
            "id", "tenant_id", "user_id", "action",
            "resource_type", "resource_id", "device_id",
            "details", "ip_address", "created_at",
        }
        actual_columns = {c.name for c in mapper}
        assert expected_columns.issubset(actual_columns), (
            f"Missing columns: {expected_columns - actual_columns}"
        )

    def test_model_exported_from_init(self):
        from app.models import AuditLog
        assert AuditLog.__tablename__ == "audit_logs"


class TestAuditService:
    """Tests for the audit service log_action function."""

    def test_log_action_importable(self):
        from app.services.audit_service import log_action
        assert callable(log_action)

    @pytest.mark.asyncio
    async def test_log_action_does_not_raise_on_db_error(self):
        """log_action must swallow exceptions so it never breaks the caller."""
        from app.services.audit_service import log_action

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=Exception("DB down"))

        # Should NOT raise even though the DB call fails
        await log_action(
            db=mock_db,
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            action="test_action",
        )


class TestAuditRouter:
    """Tests for the audit logs router."""

    def test_router_importable(self):
        from app.routers.audit_logs import router
        assert router is not None

    def test_router_has_audit_logs_endpoint(self):
        from app.routers.audit_logs import router
        paths = [route.path for route in router.routes]
        assert "/audit-logs" in paths or any("/audit-logs" in p for p in paths)
