"""Tests for the preview-restore endpoint."""

import uuid
from unittest.mock import AsyncMock, patch, MagicMock

import pytest


class TestPreviewRestoreEndpointExists:
    """Verify the preview-restore route is registered on the config_backups router."""

    def test_router_has_preview_restore_route(self):
        from app.routers.config_backups import router

        paths = [r.path for r in router.routes]
        assert any("preview-restore" in p for p in paths), (
            f"No preview-restore route found. Routes: {paths}"
        )

    def test_preview_restore_route_is_post(self):
        from app.routers.config_backups import router

        for route in router.routes:
            if hasattr(route, "path") and "preview-restore" in route.path:
                assert "POST" in route.methods, (
                    f"preview-restore route should be POST, got {route.methods}"
                )
                break
        else:
            pytest.fail("No preview-restore route found")


class TestPreviewRestoreFunction:
    """Test the preview_restore handler logic."""

    @pytest.mark.asyncio
    async def test_preview_returns_impact_analysis(self):
        """preview_restore should return diff, categories, warnings, validation."""
        from app.routers.config_backups import preview_restore, RestoreRequest

        tenant_id = uuid.uuid4()
        device_id = uuid.uuid4()

        current_export = "/ip address\nadd address=192.168.1.1/24 interface=ether1\n"
        target_export = "/ip address\nadd address=10.0.0.1/24 interface=ether1\n"

        mock_db = AsyncMock()
        mock_user = MagicMock()
        mock_request = MagicMock()
        body = RestoreRequest(commit_sha="abc1234")

        # Mock device query result
        mock_device = MagicMock()
        mock_device.ip_address = "192.168.88.1"
        mock_device.encrypted_credentials_transit = "vault:v1:abc"
        mock_device.encrypted_credentials = None
        mock_device.tenant_id = tenant_id

        mock_scalar = MagicMock()
        mock_scalar.scalar_one_or_none.return_value = mock_device
        mock_db.execute.return_value = mock_scalar

        with (
            patch(
                "app.routers.config_backups._check_tenant_access",
                new_callable=AsyncMock,
            ),
            patch(
                "app.routers.config_backups.limiter.enabled",
                False,
            ),
            patch(
                "app.routers.config_backups.git_store.read_file",
                return_value=target_export.encode(),
            ),
            patch(
                "app.routers.config_backups.backup_service.capture_export",
                new_callable=AsyncMock,
                return_value=current_export,
            ),
            patch(
                "app.routers.config_backups.decrypt_credentials_hybrid",
                new_callable=AsyncMock,
                return_value='{"username": "admin", "password": "pass"}',
            ),
            patch(
                "app.routers.config_backups.settings",
            ),
        ):
            result = await preview_restore(
                request=mock_request,
                tenant_id=tenant_id,
                device_id=device_id,
                body=body,
                db=mock_db,
                current_user=mock_user,
            )

        assert "diff" in result
        assert "categories" in result
        assert "warnings" in result
        assert "validation" in result
        # Both exports have /ip address with different commands
        assert isinstance(result["categories"], list)
        assert isinstance(result["diff"], dict)
        assert "added" in result["diff"]
        assert "removed" in result["diff"]

    @pytest.mark.asyncio
    async def test_preview_falls_back_to_latest_backup_when_device_unreachable(self):
        """When live capture fails, preview should fall back to the latest backup."""
        from app.routers.config_backups import preview_restore, RestoreRequest

        tenant_id = uuid.uuid4()
        device_id = uuid.uuid4()

        current_export = "/ip address\nadd address=192.168.1.1/24 interface=ether1\n"
        target_export = "/ip address\nadd address=10.0.0.1/24 interface=ether1\n"

        mock_db = AsyncMock()
        mock_user = MagicMock()
        mock_request = MagicMock()
        body = RestoreRequest(commit_sha="abc1234")

        # Mock device query result
        mock_device = MagicMock()
        mock_device.ip_address = "192.168.88.1"
        mock_device.encrypted_credentials_transit = "vault:v1:abc"
        mock_device.encrypted_credentials = None
        mock_device.tenant_id = tenant_id

        # First call: device query, second call: latest backup query
        mock_device_result = MagicMock()
        mock_device_result.scalar_one_or_none.return_value = mock_device

        mock_latest_run = MagicMock()
        mock_latest_run.commit_sha = "latest123"
        mock_backup_result = MagicMock()
        mock_backup_result.scalar_one_or_none.return_value = mock_latest_run

        mock_db.execute.side_effect = [mock_device_result, mock_backup_result]

        def mock_read_file(tid, sha, did, filename):
            if sha == "abc1234":
                return target_export.encode()
            elif sha == "latest123":
                return current_export.encode()
            return b""

        with (
            patch(
                "app.routers.config_backups._check_tenant_access",
                new_callable=AsyncMock,
            ),
            patch(
                "app.routers.config_backups.limiter.enabled",
                False,
            ),
            patch(
                "app.routers.config_backups.git_store.read_file",
                side_effect=mock_read_file,
            ),
            patch(
                "app.routers.config_backups.backup_service.capture_export",
                new_callable=AsyncMock,
                side_effect=ConnectionError("Device unreachable"),
            ),
            patch(
                "app.routers.config_backups.decrypt_credentials_hybrid",
                new_callable=AsyncMock,
                return_value='{"username": "admin", "password": "pass"}',
            ),
            patch(
                "app.routers.config_backups.settings",
            ),
        ):
            result = await preview_restore(
                request=mock_request,
                tenant_id=tenant_id,
                device_id=device_id,
                body=body,
                db=mock_db,
                current_user=mock_user,
            )

        assert "diff" in result
        assert "categories" in result
        assert "warnings" in result
        assert "validation" in result

    @pytest.mark.asyncio
    async def test_preview_404_when_backup_not_found(self):
        """preview_restore should return 404 when the target backup doesn't exist."""
        from app.routers.config_backups import preview_restore, RestoreRequest
        from fastapi import HTTPException

        tenant_id = uuid.uuid4()
        device_id = uuid.uuid4()

        mock_db = AsyncMock()
        mock_user = MagicMock()
        mock_request = MagicMock()
        body = RestoreRequest(commit_sha="nonexistent")

        with (
            patch(
                "app.routers.config_backups._check_tenant_access",
                new_callable=AsyncMock,
            ),
            patch(
                "app.routers.config_backups.limiter.enabled",
                False,
            ),
            patch(
                "app.routers.config_backups.git_store.read_file",
                side_effect=KeyError("not found"),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await preview_restore(
                    request=mock_request,
                    tenant_id=tenant_id,
                    device_id=device_id,
                    body=body,
                    db=mock_db,
                    current_user=mock_user,
                )

        assert exc_info.value.status_code == 404
