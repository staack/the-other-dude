"""Firmware version cache service and NPK downloader.

Responsibilities:
- check_latest_versions(): fetch latest RouterOS versions from download.mikrotik.com
- download_firmware(): download NPK packages to local PVC cache
- get_firmware_overview(): return fleet firmware status for a tenant
- schedule_firmware_checks(): register daily firmware check job with APScheduler

Version discovery comes from two sources:
1. Go poller runs /system/package/update per device (rate-limited to once/day)
   and publishes via NATS -> firmware_subscriber processes these events
2. check_latest_versions() fetches LATEST.7 / LATEST.6 from download.mikrotik.com
"""

import logging
import re
import tempfile
import zipfile
from pathlib import Path

import httpx
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = logging.getLogger(__name__)

_MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
_MAX_PACKAGE_BYTES = 128 * 1024 * 1024
_NPK_MAGIC = b"\x1e\xf1\xd0\xba"


def _validate_package_target(architecture: str, version: str) -> None:
    if architecture not in _V7_ARCHITECTURES or not re.fullmatch(
        r"[67]\.\d+(?:\.\d+)*(?:(?:rc|beta)\d+)?", version
    ):
        raise ValueError("Unsupported RouterOS architecture or version")


def _valid_npk(path: Path) -> bool:
    if not path.is_file() or not 8 <= path.stat().st_size <= _MAX_PACKAGE_BYTES:
        return False
    with path.open("rb") as package:
        header = package.read(8)
    return header[:4] == _NPK_MAGIC and int.from_bytes(header[4:8], "little") == (
        path.stat().st_size - 8
    )


async def _download_to_cache(url: str, path: Path) -> None:
    """Publish only a complete download; interrupted jobs never poison shared cache."""
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix=".part") as output:
        temporary = Path(output.name)
        try:
            async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    size = 0
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        size += len(chunk)
                        if size > _MAX_DOWNLOAD_BYTES:
                            raise ValueError("Firmware download exceeds size limit")
                        output.write(chunk)
                    length = response.headers.get("content-length")
                    if not size or (length is not None and size != int(length)):
                        raise ValueError("Incomplete firmware download")
            output.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


async def download_extra_packages(architecture: str, version: str, packages: set[str]) -> list[str]:
    """Extract only requested, exact-release NPKs from MikroTik's official archive.

    Never extract arbitrary archive paths. Check every member before publishing any
    package, and let ZIP CRC checks reject truncated/corrupt payloads.
    """
    _validate_package_target(architecture, version)
    if not packages or any(not re.fullmatch(r"[a-z][a-z0-9-]*", p) for p in packages):
        raise ValueError("Invalid extra-package inventory")
    cache = Path(settings.FIRMWARE_CACHE_DIR) / version
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"all_packages-{architecture}-{version}.zip"
    if not archive.exists():
        await _download_to_cache(
            f"https://download.mikrotik.com/routeros/{version}/{archive.name}", archive
        )
    filenames = [f"{p}-{version}-{architecture}.npk" for p in sorted(packages)]
    prepared: list[tuple[Path, Path]] = []
    try:
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            missing = [name for name in filenames if names.count(name) != 1]
            if missing:
                raise ValueError(
                    "Target release does not supply required packages: " + ", ".join(missing)
                )
            for name in filenames:
                info = bundle.getinfo(name)
                if info.is_dir() or not 8 <= info.file_size <= _MAX_PACKAGE_BYTES:
                    raise ValueError(f"Invalid package size: {name}")
                with tempfile.NamedTemporaryFile(dir=cache, delete=False, suffix=".part") as output:
                    temporary = Path(output.name)
                    prepared.append((temporary, cache / name))
                    with bundle.open(info) as source:
                        while chunk := source.read(65536):
                            output.write(chunk)
                if not _valid_npk(temporary):
                    raise ValueError(f"Invalid NPK payload: {name}")
        for temporary, destination in prepared:
            temporary.replace(destination)
    except (zipfile.BadZipFile, EOFError):
        # A corrupt cached ZIP must not prevent a fresh download on retry.
        archive.unlink(missing_ok=True)
        raise
    finally:
        for temporary, _ in prepared:
            temporary.unlink(missing_ok=True)
    return [str(cache / name) for name in filenames]


# Architectures supported by RouterOS v7 and v6
_V7_ARCHITECTURES = ["arm", "arm64", "mipsbe", "mmips", "smips", "tile", "ppc", "x86"]
_V6_ARCHITECTURES = ["mipsbe", "mmips", "smips", "tile", "ppc", "x86"]

# Version source files on download.mikrotik.com
_VERSION_SOURCES = [
    ("LATEST.7", "stable", 7),
    ("LATEST.7long", "long-term", 7),
    ("LATEST.6", "stable", 6),
    ("LATEST.6long", "long-term", 6),
]


async def check_latest_versions() -> list[dict]:
    """Fetch latest RouterOS versions from download.mikrotik.com.

    Checks LATEST.7, LATEST.7long, LATEST.6, and LATEST.6long files for
    version strings, then upserts into firmware_versions table for each
    architecture/channel combination.

    Returns list of discovered version dicts.
    """
    results: list[dict] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for channel_file, channel, major in _VERSION_SOURCES:
            try:
                resp = await client.get(f"https://download.mikrotik.com/routeros/{channel_file}")
                if resp.status_code != 200:
                    logger.warning(
                        "MikroTik version check returned %d for %s",
                        resp.status_code,
                        channel_file,
                    )
                    continue

                version = resp.text.strip()
                if not version or not version[0].isdigit():
                    logger.warning("Invalid version string from %s: %r", channel_file, version)
                    continue

                architectures = _V7_ARCHITECTURES if major == 7 else _V6_ARCHITECTURES
                for arch in architectures:
                    npk_url = (
                        f"https://download.mikrotik.com/routeros/"
                        f"{version}/routeros-{version}-{arch}.npk"
                    )
                    results.append(
                        {
                            "architecture": arch,
                            "channel": channel,
                            "version": version,
                            "npk_url": npk_url,
                        }
                    )

            except Exception as e:
                logger.warning("Failed to check %s: %s", channel_file, e)

    # Upsert into firmware_versions table
    if results:
        async with AdminAsyncSessionLocal() as session:
            for r in results:
                await session.execute(
                    text("""
                        INSERT INTO firmware_versions (id, architecture, channel, version, npk_url, checked_at)
                        VALUES (gen_random_uuid(), :arch, :channel, :version, :npk_url, NOW())
                        ON CONFLICT (architecture, channel, version) DO UPDATE SET checked_at = NOW()
                    """),
                    {
                        "arch": r["architecture"],
                        "channel": r["channel"],
                        "version": r["version"],
                        "npk_url": r["npk_url"],
                    },
                )
            await session.commit()

    logger.info("Firmware version check complete — %d versions discovered", len(results))
    return results


async def download_firmware(architecture: str, channel: str, version: str) -> str:
    """Download an NPK package to the local firmware cache.

    Returns the local file path. Skips download if file already exists
    and size matches.
    """
    _validate_package_target(architecture, version)
    cache_dir = Path(settings.FIRMWARE_CACHE_DIR) / version
    cache_dir.mkdir(parents=True, exist_ok=True)

    filename = f"routeros-{version}-{architecture}.npk"
    local_path = cache_dir / filename
    npk_url = f"https://download.mikrotik.com/routeros/{version}/{filename}"

    # Check if already cached
    if _valid_npk(local_path):
        logger.info("Firmware already cached: %s", local_path)
        return str(local_path)

    logger.info("Downloading firmware: %s", npk_url)

    await _download_to_cache(npk_url, local_path)
    if not _valid_npk(local_path):
        local_path.unlink(missing_ok=True)
        raise ValueError("Invalid main RouterOS NPK payload")

    file_size = local_path.stat().st_size
    logger.info("Firmware downloaded: %s (%d bytes)", local_path, file_size)

    # Update firmware_versions table with local path and size
    async with AdminAsyncSessionLocal() as session:
        await session.execute(
            text("""
                UPDATE firmware_versions
                SET npk_local_path = :path, npk_size_bytes = :size
                WHERE architecture = :arch AND channel = :channel AND version = :version
            """),
            {
                "path": str(local_path),
                "size": file_size,
                "arch": architecture,
                "channel": channel,
                "version": version,
            },
        )
        await session.commit()

    return str(local_path)


def normalize_routeros_version(version: str | None) -> str | None:
    """Strip RouterOS's channel suffix while retaining release qualifiers (rc/beta)."""
    parts = (version or "").split()
    return parts[0] if parts else None


async def get_firmware_overview(tenant_id: str) -> dict:
    """Return fleet firmware status for a tenant.

    Returns devices grouped by firmware version, annotated with up-to-date status
    based on the latest known version for each device's architecture and preferred channel.
    """
    async with AdminAsyncSessionLocal() as session:
        # Get all devices for tenant
        devices_result = await session.execute(
            text("""
                SELECT id, hostname, ip_address, routeros_version, architecture,
                       preferred_channel, routeros_major_version,
                       serial_number, firmware_version, model
                FROM devices
                WHERE tenant_id = CAST(:tenant_id AS uuid)
                ORDER BY hostname
            """),
            {"tenant_id": tenant_id},
        )
        devices = devices_result.fetchall()

        # Get latest firmware versions per architecture/channel
        versions_result = await session.execute(
            text("""
                SELECT DISTINCT ON (architecture, channel)
                    architecture, channel, version, npk_url
                FROM firmware_versions
                ORDER BY architecture, channel, checked_at DESC
            """)
        )
        latest_versions = {
            (row[0], row[1]): {"version": row[2], "npk_url": row[3]}
            for row in versions_result.fetchall()
        }

    # Build per-device status
    device_list = []
    version_groups: dict[str, list] = {}
    summary = {"total": 0, "up_to_date": 0, "outdated": 0, "unknown": 0}

    for dev in devices:
        dev_id = str(dev[0])
        hostname = dev[1]
        current_version = normalize_routeros_version(dev[3])
        arch = dev[4]
        channel = dev[5] or "stable"

        latest = latest_versions.get((arch, channel)) if arch else None
        latest_version = normalize_routeros_version(latest["version"]) if latest else None

        is_up_to_date = False
        if not current_version or not arch:
            summary["unknown"] += 1
        elif latest_version and current_version == latest_version:
            is_up_to_date = True
            summary["up_to_date"] += 1
        else:
            summary["outdated"] += 1

        summary["total"] += 1

        dev_info = {
            "id": dev_id,
            "hostname": hostname,
            "ip_address": dev[2],
            "routeros_version": current_version,
            "architecture": arch,
            "latest_version": latest_version,
            "channel": channel,
            "is_up_to_date": is_up_to_date,
            "serial_number": dev[7],
            "firmware_version": dev[8],
            "model": dev[9],
        }
        device_list.append(dev_info)

        # Group by version
        ver_key = current_version or "unknown"
        if ver_key not in version_groups:
            version_groups[ver_key] = []
        version_groups[ver_key].append(dev_info)

    # Build version groups with is_latest flag
    groups = []
    for ver, devs in sorted(version_groups.items()):
        # A group is current only when every device matches its own architecture/channel.
        is_latest = all(d["is_up_to_date"] for d in devs)
        groups.append(
            {
                "version": ver,
                "count": len(devs),
                "is_latest": is_latest,
                "devices": devs,
            }
        )

    return {
        "devices": device_list,
        "version_groups": groups,
        "summary": summary,
    }


async def get_cached_firmware() -> list[dict]:
    """List all locally cached NPK files with their sizes."""
    cache_dir = Path(settings.FIRMWARE_CACHE_DIR)
    cached = []

    if not cache_dir.exists():
        return cached

    for version_dir in sorted(cache_dir.iterdir()):
        if not version_dir.is_dir():
            continue
        for npk_file in sorted(version_dir.iterdir()):
            if npk_file.suffix == ".npk":
                cached.append(
                    {
                        "path": str(npk_file),
                        "version": version_dir.name,
                        "filename": npk_file.name,
                        "size_bytes": npk_file.stat().st_size,
                    }
                )

    return cached


def schedule_firmware_checks() -> None:
    """Register daily firmware version check with APScheduler.

    Called from FastAPI lifespan startup to schedule check_latest_versions()
    at 3am UTC daily.
    """
    from apscheduler.triggers.cron import CronTrigger
    from app.services.backup_scheduler import backup_scheduler

    backup_scheduler.add_job(
        check_latest_versions,
        trigger=CronTrigger(hour=3, minute=0, timezone="UTC"),
        id="firmware_version_check",
        name="Check for new RouterOS firmware versions",
        max_instances=1,
        replace_existing=True,
    )

    logger.info("Firmware version check scheduled — daily at 3am UTC")
