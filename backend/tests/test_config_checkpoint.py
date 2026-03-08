"""Tests for config checkpoint endpoint."""

import uuid
from unittest.mock import AsyncMock, patch, MagicMock

import pytest


class TestCheckpointEndpointExists:
    """Verify the checkpoint route is registered on the config_backups router."""

    def test_router_has_checkpoint_route(self):
        from app.routers.config_backups import router

        paths = [r.path for r in router.routes]
        assert any("checkpoint" in p for p in paths), (
            f"No checkpoint route found. Routes: {paths}"
        )

    def test_checkpoint_route_is_post(self):
        from app.routers.config_backups import router

        for route in router.routes:
            if hasattr(route, "path") and "checkpoint" in route.path:
                assert "POST" in route.methods, (
                    f"Checkpoint route should be POST, got {route.methods}"
                )
                break
        else:
            pytest.fail("No checkpoint route found")


class TestCheckpointFunction:
    """Test the create_checkpoint handler logic."""

    @pytest.mark.asyncio
    async def test_checkpoint_calls_backup_service_with_checkpoint_trigger(self):
        """create_checkpoint should call backup_service.run_backup with trigger_type='checkpoint'."""
        from app.routers.config_backups import create_checkpoint

        mock_result = {
            "commit_sha": "abc1234",
            "trigger_type": "checkpoint",
            "lines_added": 100,
            "lines_removed": 0,
        }

        mock_db = AsyncMock()
        mock_user = MagicMock()

        tenant_id = uuid.uuid4()
        device_id = uuid.uuid4()

        mock_request = MagicMock()

        with patch(
            "app.routers.config_backups.backup_service.run_backup",
            new_callable=AsyncMock,
            return_value=mock_result,
        ) as mock_backup, patch(
            "app.routers.config_backups._check_tenant_access",
            new_callable=AsyncMock,
        ), patch(
            "app.routers.config_backups.limiter.enabled",
            False,
        ):
            result = await create_checkpoint(
                request=mock_request,
                tenant_id=tenant_id,
                device_id=device_id,
                db=mock_db,
                current_user=mock_user,
            )

        assert result["trigger_type"] == "checkpoint"
        assert result["commit_sha"] == "abc1234"
        mock_backup.assert_called_once_with(
            device_id=str(device_id),
            tenant_id=str(tenant_id),
            trigger_type="checkpoint",
            db_session=mock_db,
        )
