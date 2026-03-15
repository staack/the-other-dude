"""Unit tests for maintenance window model, router schemas, and alert suppression.

Tests cover:
- MaintenanceWindow ORM model imports and field definitions
- MaintenanceWindowCreate/Update/Response Pydantic schema validation
- Alert evaluator _is_device_in_maintenance integration
- Router registration in main app
"""

from datetime import datetime, timezone, timedelta

import pytest


class TestMaintenanceWindowModel:
    """Test that the MaintenanceWindow ORM model is importable and has correct fields."""

    def test_model_importable(self):
        from app.models.maintenance_window import MaintenanceWindow

        assert MaintenanceWindow.__tablename__ == "maintenance_windows"

    def test_model_exported_from_init(self):
        from app.models import MaintenanceWindow

        assert MaintenanceWindow.__tablename__ == "maintenance_windows"

    def test_model_has_required_columns(self):
        from app.models.maintenance_window import MaintenanceWindow

        mapper = MaintenanceWindow.__mapper__
        column_names = {c.key for c in mapper.columns}
        expected = {
            "id",
            "tenant_id",
            "name",
            "device_ids",
            "start_at",
            "end_at",
            "suppress_alerts",
            "notes",
            "created_by",
            "created_at",
            "updated_at",
        }
        assert expected.issubset(column_names), f"Missing columns: {expected - column_names}"


class TestMaintenanceWindowSchemas:
    """Test Pydantic schemas for request/response validation."""

    def test_create_schema_valid(self):
        from app.routers.maintenance_windows import MaintenanceWindowCreate

        data = MaintenanceWindowCreate(
            name="Nightly update",
            device_ids=["abc-123"],
            start_at=datetime.now(timezone.utc),
            end_at=datetime.now(timezone.utc) + timedelta(hours=2),
            suppress_alerts=True,
            notes="Scheduled maintenance",
        )
        assert data.name == "Nightly update"
        assert data.suppress_alerts is True

    def test_create_schema_defaults(self):
        from app.routers.maintenance_windows import MaintenanceWindowCreate

        data = MaintenanceWindowCreate(
            name="Quick reboot",
            device_ids=[],
            start_at=datetime.now(timezone.utc),
            end_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        assert data.suppress_alerts is True  # default
        assert data.notes is None

    def test_update_schema_partial(self):
        from app.routers.maintenance_windows import MaintenanceWindowUpdate

        data = MaintenanceWindowUpdate(name="Updated name")
        assert data.name == "Updated name"
        assert data.device_ids is None  # all optional

    def test_response_schema(self):
        from app.routers.maintenance_windows import MaintenanceWindowResponse

        data = MaintenanceWindowResponse(
            id="abc",
            tenant_id="def",
            name="Test",
            device_ids=["x"],
            start_at=datetime.now(timezone.utc).isoformat(),
            end_at=datetime.now(timezone.utc).isoformat(),
            suppress_alerts=True,
            notes=None,
            created_by="ghi",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        assert data.id == "abc"


class TestRouterRegistration:
    """Test that the maintenance_windows router is properly registered."""

    def test_router_importable(self):
        from app.routers.maintenance_windows import router

        assert router is not None

    def test_router_has_routes(self):
        from app.routers.maintenance_windows import router

        paths = [r.path for r in router.routes]
        assert any("maintenance-windows" in p for p in paths)

    def test_main_app_includes_router(self):
        try:
            from app.main import app
        except ImportError:
            pytest.skip("app.main requires full dependencies (prometheus, etc.)")
        route_paths = [r.path for r in app.routes]
        route_paths_str = " ".join(route_paths)
        assert "maintenance-windows" in route_paths_str


class TestAlertEvaluatorMaintenance:
    """Test that alert_evaluator has maintenance window check capability."""

    def test_maintenance_cache_exists(self):
        from app.services import alert_evaluator

        assert hasattr(alert_evaluator, "_maintenance_cache")

    def test_is_device_in_maintenance_function_exists(self):
        from app.services.alert_evaluator import _is_device_in_maintenance

        assert callable(_is_device_in_maintenance)
