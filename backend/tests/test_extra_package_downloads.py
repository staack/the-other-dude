"""Real HTTP/ZIP payloads and SFTP failure paths for complete package upgrades."""

import io
import zipfile
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.services import firmware_service as firmware, upgrade_service as upgrade
from tests.test_firmware_issue_regressions import upgrade_mocks as _upgrade_mocks

upgrade_mocks = _upgrade_mocks


def npk(data=b"signed-package-placeholder"):
    return firmware._NPK_MAGIC + len(data).to_bytes(4, "little") + data


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as bundle:
        for name, payload in entries.items():
            bundle.writestr(name, payload)
    return output.getvalue()


@pytest.fixture
def downloads(monkeypatch, tmp_path):
    monkeypatch.setattr(firmware.settings, "FIRMWARE_CACHE_DIR", str(tmp_path))
    real_client = httpx.AsyncClient
    requests = []
    responses = {}

    def respond(request):
        requests.append(request.url.path)
        payload = responses.get(request.url.path)
        return httpx.Response(404) if payload is None else httpx.Response(200, content=payload)

    monkeypatch.setattr(
        firmware.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    return SimpleNamespace(root=tmp_path, requests=requests, responses=responses)


async def test_archive_selects_exact_packages_and_reuses_cache(downloads):
    downloads.responses["/routeros/7.20.6/all_packages-arm64-7.20.6.zip"] = archive(
        {
            "wifi-qcom-7.20.6-arm64.npk": npk(b"wifi"),
            "container-7.20.6-arm64.npk": npk(b"container"),
            "zerotier-7.20.6-arm64.npk": npk(b"unrequested"),
            "../outside.npk": npk(b"unsafe"),
        }
    )
    paths = await firmware.download_extra_packages("arm64", "7.20.6", {"wifi-qcom", "container"})
    assert [p.rsplit("/", 1)[-1] for p in paths] == [
        "container-7.20.6-arm64.npk",
        "wifi-qcom-7.20.6-arm64.npk",
    ]
    assert not (downloads.root / "outside.npk").exists()
    assert not list(downloads.root.rglob("zerotier*.npk"))
    await firmware.download_extra_packages("arm64", "7.20.6", {"container"})
    assert len(downloads.requests) == 1


@pytest.mark.parametrize(
    "entries",
    [
        {"wifi-qcom-7.20.5-arm64.npk": npk()},
        {"wifi-qcom-7.20.6-arm.npk": npk()},
        {"../wifi-qcom-7.20.6-arm64.npk": npk()},
        {"wifi-qcom-7.20.6-arm64.npk": b"not an NPK"},
    ],
)
async def test_missing_wrong_release_architecture_or_invalid_payload(downloads, entries):
    downloads.responses["/routeros/7.20.6/all_packages-arm64-7.20.6.zip"] = archive(entries)
    with pytest.raises(ValueError):
        await firmware.download_extra_packages("arm64", "7.20.6", {"wifi-qcom"})
    assert not list(downloads.root.rglob("*.npk"))
    assert not list(downloads.root.rglob("*.part"))


async def test_corrupt_zip_can_be_downloaded_again(downloads):
    url = "/routeros/7.20.6/all_packages-arm64-7.20.6.zip"
    downloads.responses[url] = b"interrupted ZIP"
    with pytest.raises(zipfile.BadZipFile):
        await firmware.download_extra_packages("arm64", "7.20.6", {"container"})
    assert not list(downloads.root.rglob("*.zip"))
    downloads.responses[url] = archive({"container-7.20.6-arm64.npk": npk()})
    assert len(await firmware.download_extra_packages("arm64", "7.20.6", {"container"})) == 1
    assert len(downloads.requests) == 2


@pytest.mark.parametrize(
    "version,arch,package",
    [
        ("../../other", "arm64", "container"),
        ("7.20.6", "../arm64", "container"),
        ("7.20.6", "arm64", "../../outside"),
    ],
)
async def test_inventory_cannot_escape_cache(downloads, version, arch, package):
    with pytest.raises(ValueError):
        await firmware.download_extra_packages(arch, version, {package})
    assert downloads.requests == []


async def test_main_download_replaces_partial_cache_and_records_complete_file(
    downloads, monkeypatch
):
    cache = downloads.root / "7.20.6"
    cache.mkdir()
    destination = cache / "routeros-7.20.6-arm64.npk"
    destination.write_bytes(b"interrupted")
    downloads.responses["/routeros/7.20.6/routeros-7.20.6-arm64.npk"] = npk()
    session = AsyncMock()

    @asynccontextmanager
    async def factory():
        yield session

    monkeypatch.setattr(firmware, "AdminAsyncSessionLocal", factory)
    assert await firmware.download_firmware("arm64", "stable", "7.20.6") == str(destination)
    assert destination.read_bytes() == npk()
    session.commit.assert_awaited_once()


async def test_404_never_publishes_cache(downloads):
    with pytest.raises(httpx.HTTPStatusError):
        await firmware.download_extra_packages("arm64", "7.20.6", {"container"})
    assert not list(downloads.root.rglob("*.part"))
    assert not list(downloads.root.rglob("*.zip"))


async def test_interrupted_http_transfer_cannot_be_reused_as_cache(monkeypatch, tmp_path):
    class Interrupted(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"first chunk"
            raise httpx.ReadError("network interrupted")

    client = httpx.AsyncClient
    monkeypatch.setattr(
        firmware.httpx,
        "AsyncClient",
        lambda **kwargs: client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=Interrupted())),
            **kwargs,
        ),
    )
    destination = tmp_path / "packages.zip"
    with pytest.raises(httpx.ReadError):
        await firmware._download_to_cache("https://download.mikrotik.com/test", destination)
    assert not destination.exists()
    assert not list(tmp_path.glob("*.part"))


async def test_declared_http_length_must_match(monkeypatch, tmp_path):
    client = httpx.AsyncClient
    monkeypatch.setattr(
        firmware.httpx,
        "AsyncClient",
        lambda **kwargs: client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, headers={"content-length": "100"}, content=b"short")
            ),
            **kwargs,
        ),
    )
    destination = tmp_path / "packages.zip"
    with pytest.raises(ValueError, match="Incomplete"):
        await firmware._download_to_cache("https://download.mikrotik.com/test", destination)
    assert not destination.exists()


async def test_inventory_excludes_available_but_includes_disabled(upgrade_mocks):
    upgrade_mocks.conn.run.side_effect = None
    upgrade_mocks.conn.run.return_value.stdout = (
        "routeros|7.20.6|false|false|\n"
        "container|7.20.6|false|false|\n"  # disabled isn't a reason to omit it
        "zerotier|7.20.6|true|false|\n"
    )
    inventory = await upgrade._get_installed_packages("ip", "user", "password")
    assert set(inventory) == {"routeros", "container"}


def test_v6_bundle_subpackages_are_not_uploaded_twice():
    p = upgrade.InstalledPackage
    assert upgrade._package_plan(
        {
            "routeros-mipsbe": p("6.49.18"),
            "system": p("6.49.18", True),
            "wireless": p("6.49.18", True),
            "user-manager": p("6.49.18"),
        },
        "mipsbe",
        "6.49.19",
    ) == (True, {"user-manager"})


def test_v6_split_install_keeps_split_packages():
    p = upgrade.InstalledPackage
    assert upgrade._package_plan(
        {"system": p("6.49.18"), "wireless": p("6.49.18")}, "mipsbe", "6.49.19"
    ) == (False, {"system", "wireless"})


@pytest.mark.parametrize(
    "packages,target",
    [
        ({"routeros": upgrade.InstalledPackage("7.12.1")}, "7.20.6"),
        ({"routeros-mipsbe": upgrade.InstalledPackage("6.49.19")}, "7.20.6"),
        (
            {
                "routeros-mipsbe": upgrade.InstalledPackage("6.49.18"),
                "system": upgrade.InstalledPackage("6.49.18", None),
            },
            "6.49.19",
        ),
    ],
)
def test_ambiguous_layout_migrations_and_unknown_bundle_flags_fail_closed(packages, target):
    with pytest.raises(ValueError):
        upgrade._package_plan(packages, "mipsbe", target)


async def test_v6_split_package_archive_names(downloads):
    downloads.responses["/routeros/6.49.19/all_packages-mipsbe-6.49.19.zip"] = archive(
        {
            "system-6.49.19-mipsbe.npk": npk(b"system"),
            "wireless-6.49.19-mipsbe.npk": npk(b"wireless"),
        }
    )
    assert (
        len(await firmware.download_extra_packages("mipsbe", "6.49.19", {"system", "wireless"}))
        == 2
    )


async def test_extra_package_failure_never_uploads_or_reboots(monkeypatch, upgrade_mocks):
    upgrade_mocks.conn.run.side_effect = None
    upgrade_mocks.conn.run.return_value.stdout = (
        "routeros|7.16.1|false|false|\ncontainer|7.16.1|false|false|\n"
    )
    monkeypatch.setattr(
        firmware, "download_extra_packages", AsyncMock(side_effect=ValueError("missing container"))
    )
    await upgrade.start_upgrade("job")
    upgrade_mocks.sftp.open.assert_not_called()
    assert not any("reboot" in c.args[0] for c in upgrade_mocks.conn.run.await_args_list)
    assert "missing container" in upgrade._update_job.call_args.kwargs["error_message"]


async def test_complete_package_set_uploads_before_reboot_and_verifies_every_package(
    monkeypatch,
    tmp_path,
    upgrade_mocks,
):
    extra = tmp_path / "container-7.24.5-arm64.npk"
    extra.write_bytes(b"test-package")
    monkeypatch.setattr(firmware, "download_extra_packages", AsyncMock(return_value=[str(extra)]))
    inventory = AsyncMock(
        side_effect=[
            {
                "routeros": upgrade.InstalledPackage("7.16.1"),
                "container": upgrade.InstalledPackage("7.16.1"),
            },
            {
                "routeros": upgrade.InstalledPackage("7.16.1"),
                "container": upgrade.InstalledPackage("7.16.1"),
            },
            {
                "routeros": upgrade.InstalledPackage("7.24.5"),
                "container": upgrade.InstalledPackage("7.24.5"),
            },
        ]
    )
    monkeypatch.setattr(upgrade, "_get_installed_packages", inventory)
    await upgrade.start_upgrade("job")
    assert upgrade_mocks.sftp.rename.await_count == 2
    assert upgrade_mocks.file.write.await_count == 2
    assert upgrade._update_job.call_args.kwargs["status"] == "completed"


@pytest.mark.parametrize("actual", [{}, {"container": upgrade.InstalledPackage("7.16.1")}])
async def test_main_version_alone_cannot_complete_extra_package_upgrade(
    monkeypatch,
    tmp_path,
    upgrade_mocks,
    actual,
):
    extra = tmp_path / "container-7.24.5-arm64.npk"
    extra.write_bytes(b"test-package")
    monkeypatch.setattr(firmware, "download_extra_packages", AsyncMock(return_value=[str(extra)]))
    monkeypatch.setattr(
        upgrade,
        "_get_installed_packages",
        AsyncMock(
            side_effect=[
                {
                    "routeros": upgrade.InstalledPackage("7.16.1"),
                    "container": upgrade.InstalledPackage("7.16.1"),
                },
                {
                    "routeros": upgrade.InstalledPackage("7.16.1"),
                    "container": upgrade.InstalledPackage("7.16.1"),
                },
                {"routeros": upgrade.InstalledPackage("7.24.5"), **actual},
            ]
        ),
    )
    await upgrade.start_upgrade("job")
    assert upgrade._update_job.call_args.kwargs["status"] == "failed"
    assert "container" in upgrade._update_job.call_args.kwargs["error_message"]
    assert any(c.args[0] == "/system reboot" for c in upgrade_mocks.conn.run.await_args_list)


@pytest.mark.parametrize("failure", ["write", "size", "rename", "cleanup"])
async def test_partial_upload_is_cleaned_and_never_rebooted(upgrade_mocks, failure):
    sftp = upgrade_mocks.sftp
    if failure in ("write", "cleanup"):
        upgrade_mocks.file.write.side_effect = OSError("disk full")
    elif failure == "size":
        sftp.stat.return_value.size = 1
    else:
        sftp.rename.side_effect = OSError("rename failed")
    if failure == "cleanup":
        sftp.remove.side_effect = OSError("connection lost")
    await upgrade.start_upgrade("job")
    sftp.remove.assert_awaited()
    assert not any("reboot" in c.args[0] for c in upgrade_mocks.conn.run.await_args_list)
    message = upgrade._update_job.call_args.kwargs["error_message"]
    assert (
        "cleanup was incomplete" in message if failure == "cleanup" else "upload failed" in message
    )


async def test_preexisting_npk_is_not_overwritten(upgrade_mocks):
    upgrade_mocks.sftp.listdir.return_value = ["operator-upload.npk"]
    await upgrade.start_upgrade("job")
    upgrade_mocks.sftp.open.assert_not_called()
    upgrade_mocks.sftp.remove.assert_not_awaited()
    assert not any("reboot" in c.args[0] for c in upgrade_mocks.conn.run.await_args_list)


async def test_promotion_failure_removes_already_promoted_and_uncertain_destination(
    tmp_path,
    upgrade_mocks,
):
    paths = [tmp_path / "first.npk", tmp_path / "second.npk"]
    for path in paths:
        path.write_bytes(b"test-package")
    upgrade_mocks.sftp.rename.side_effect = [None, OSError("connection dropped after rename")]
    with pytest.raises(OSError):
        await upgrade._upload_packages("ip", "user", "password", [str(p) for p in paths])
    removed = {call.args[0] for call in upgrade_mocks.sftp.remove.await_args_list}
    assert "/first.npk" in removed and "/second.npk" in removed
    assert any(name.endswith(".part") for name in removed)


async def test_other_attempts_staging_reservation_is_not_removed(upgrade_mocks):
    upgrade_mocks.sftp.mkdir.side_effect = OSError("already exists")
    await upgrade.start_upgrade("job")
    upgrade_mocks.sftp.open.assert_not_called()
    upgrade_mocks.sftp.remove.assert_not_awaited()
    upgrade_mocks.sftp.rmdir.assert_not_awaited()
    assert upgrade._update_job.call_args.kwargs["status"] == "failed"


async def test_changed_inventory_aborts_before_upload(monkeypatch, upgrade_mocks):
    monkeypatch.setattr(
        upgrade,
        "_get_installed_packages",
        AsyncMock(
            side_effect=[
                {"routeros": upgrade.InstalledPackage("7.16.1")},
                {
                    "routeros": upgrade.InstalledPackage("7.16.1"),
                    "container": upgrade.InstalledPackage("7.16.1"),
                },
            ]
        ),
    )
    await upgrade.start_upgrade("job")
    upgrade_mocks.sftp.open.assert_not_called()
    assert "inventory changed" in upgrade._update_job.call_args.kwargs["error_message"]
