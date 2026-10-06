"""Regression coverage for GitHub #9 (unsafe upgrades) and #10 (channel suffixes)."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import firmware_service as firmware, upgrade_service as upgrade


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("7.24.5 (stable)", "7.24.5"),
        (" 7.24.5 (long-term) ", "7.24.5"),
        ("7.25rc1 (testing)", "7.25rc1"),
        ("7.25beta2", "7.25beta2"),
        (None, None),
        (" ", None),
    ],
)
def test_normalize_version(raw, expected):
    assert firmware.normalize_routeros_version(raw) == expected


def session_factory(rows):
    result = MagicMock()
    result.fetchone.return_value = rows[0]
    result.fetchall.return_value = rows
    session = AsyncMock()
    session.execute.return_value = result

    @asynccontextmanager
    async def factory():
        yield session

    return factory, session


async def test_overview_groups_suffixes_and_respects_channel(monkeypatch):
    devices = [
        ("a", "current", "192.0.2.1", "7.24.5 (stable)", "arm64", "stable", 7, None, None, None),
        ("b", "current-bare", "192.0.2.2", "7.24.5", "arm64", "stable", 7, None, None, None),
        ("c", "old", "192.0.2.3", "7.24.4 (stable)", "arm64", "stable", 7, None, None, None),
        ("d", "unknown", "192.0.2.4", None, "arm64", "stable", 7, None, None, None),
    ]
    factory, session = session_factory(devices)
    versions = MagicMock()
    versions.fetchall.return_value = [("arm64", "stable", "7.24.5", "url")]
    device_result = MagicMock()
    device_result.fetchall.return_value = devices
    session.execute.side_effect = [device_result, versions]
    monkeypatch.setattr(firmware, "AdminAsyncSessionLocal", factory)
    result = await firmware.get_firmware_overview("tenant")
    assert result["summary"] == {"total": 4, "up_to_date": 2, "outdated": 1, "unknown": 1}
    group = next(g for g in result["version_groups"] if g["version"] == "7.24.5")
    assert group["count"] == 2 and group["is_latest"]


@pytest.fixture
def upgrade_mocks(monkeypatch, tmp_path):
    row = (
        "job",
        "device",
        "tenant",
        "7.24.5",
        "arm64",
        "stable",
        "pending",
        False,
        "192.0.2.1",
        "test-router",
        "encrypted",
        "7.16.1 (stable)",
        None,
    )
    factory, _ = session_factory([row])
    monkeypatch.setattr(upgrade, "AdminAsyncSessionLocal", factory)
    monkeypatch.setattr(upgrade, "_update_job", AsyncMock())
    monkeypatch.setattr(upgrade, "_publish_upgrade_progress", AsyncMock())
    from app.services import backup_service, crypto

    monkeypatch.setattr(
        backup_service, "run_backup", AsyncMock(return_value={"commit_sha": "abc12345"})
    )
    monkeypatch.setattr(
        crypto,
        "decrypt_credentials_hybrid",
        AsyncMock(return_value='{"username":"lab","password":"lab"}'),
    )
    npk = tmp_path / "routeros-7.24.5-arm64.npk"
    npk.write_bytes(b"test-package")
    download = AsyncMock(return_value=str(npk))
    monkeypatch.setattr(firmware, "download_firmware", download)
    conn = AsyncMock()
    conn.run.return_value = SimpleNamespace(stdout="routeros\n", stderr="", exit_status=0)
    sftp = AsyncMock()
    file = AsyncMock()
    sftp.open = MagicMock(return_value=file)
    conn.start_sftp_client = MagicMock(return_value=sftp)
    conn.__aenter__.return_value = conn
    sftp.__aenter__.return_value = sftp
    file.__aenter__.return_value = file
    connect = MagicMock(return_value=conn)
    monkeypatch.setattr(upgrade.asyncssh, "connect", connect)
    monkeypatch.setattr(upgrade.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(upgrade, "_check_ssh_reachable", AsyncMock(return_value=True))
    monkeypatch.setattr(upgrade, "_get_device_version", AsyncMock(return_value="7.24.5 (stable)"))
    return SimpleNamespace(conn=conn, connect=connect, download=download, sftp=sftp, file=file)


@pytest.mark.parametrize(
    "inventory",
    ["routeros\nwifi-qcom\n", "routeros\ncontainer\nzerotier\n", "", "routeros\nwireless\n"],
)
async def test_extra_or_unknown_packages_never_upload_or_reboot(
    monkeypatch, upgrade_mocks, inventory
):
    mocks = upgrade_mocks
    mocks.conn.run.return_value.stdout = inventory
    await upgrade.start_upgrade("job")
    mocks.download.assert_not_awaited()
    mocks.conn.start_sftp_client.assert_not_called()
    assert not any("reboot" in call.args[0] for call in mocks.conn.run.await_args_list)
    assert upgrade._update_job.call_args.kwargs["status"] == "failed"
    assert "pre-flight" in upgrade._update_job.call_args.kwargs["error_message"]


async def test_inventory_command_failure_never_uploads(upgrade_mocks):
    upgrade_mocks.conn.run.side_effect = RuntimeError("permission denied")
    await upgrade.start_upgrade("job")
    upgrade_mocks.download.assert_not_awaited()
    upgrade_mocks.conn.start_sftp_client.assert_not_called()
    assert upgrade._update_job.call_args.kwargs["status"] == "failed"


async def test_main_package_upgrade_reboots_and_verifies(upgrade_mocks):
    await upgrade.start_upgrade("job")
    upgrade_mocks.download.assert_awaited_once()
    upgrade_mocks.file.write.assert_awaited_once_with(b"test-package")
    assert any(call.args[0] == "/system reboot" for call in upgrade_mocks.conn.run.await_args_list)
    assert upgrade._update_job.call_args.kwargs["status"] == "completed"


@pytest.mark.parametrize(
    "actual", ["7.24.50 (stable)", "7.24.5rc1 (testing)", "", "7.16.1 (stable)"]
)
async def test_verification_requires_exact_release(monkeypatch, upgrade_mocks, actual):
    monkeypatch.setattr(upgrade, "_get_device_version", AsyncMock(return_value=actual))
    await upgrade.start_upgrade("job")
    assert upgrade._update_job.call_args.kwargs["status"] == "failed"


async def test_idle_radio_persists_without_false_signal_or_ccq():
    from app.services.metrics_subscriber import _insert_wireless_metrics

    session = AsyncMock()
    await _insert_wireless_metrics(
        session,
        {
            "device_id": "device",
            "tenant_id": "tenant",
            "collected_at": "2026-10-05T12:00:00Z",
            "wireless": [
                {"interface": "wifi1", "client_count": 0, "avg_signal": 0, "ccq": 0, "frequency": 0}
            ],
        },
    )
    values = session.execute.call_args.args[1]
    assert values["interface"] == "wifi1" and values["client_count"] == 0
    assert values["avg_signal"] is None and values["ccq"] is None and values["frequency"] is None


async def test_connected_legacy_radio_preserves_measured_zero_ccq():
    from app.services.metrics_subscriber import _insert_wireless_metrics

    session = AsyncMock()
    await _insert_wireless_metrics(
        session,
        {
            "device_id": "device",
            "tenant_id": "tenant",
            "collected_at": "2026-10-05T12:00:00Z",
            "wireless": [
                {
                    "interface": "wlan1",
                    "client_count": 1,
                    "avg_signal": -80,
                    "ccq": 0,
                    "frequency": 2412,
                }
            ],
        },
    )
    values = session.execute.call_args.args[1]
    assert values["ccq"] == 0 and values["avg_signal"] == -80
