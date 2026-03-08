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
import os
from pathlib import Path

import httpx
from sqlalchemy import text

from app.config import settings
from app.database import AdminAsyncSessionLocal

logger = logging.getLogger(__name__)

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
                resp = await client.get(
                    f"https://download.mikrotik.com/routeros/{channel_file}"
                )
                if resp.status_code != 200:
                    logger.warning(
                        "MikroTik version check returned %d for %s",
                        resp.status_code, channel_file,
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
                    results.append({
                        "architecture": arch,
                        "channel": channel,
                        "version": version,
                        "npk_url": npk_url,
                    })

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
    cache_dir = Path(settings.FIRMWARE_CACHE_DIR) / version
    cache_dir.mkdir(parents=True, exist_ok=True)

    filename = f"routeros-{version}-{architecture}.npk"
    local_path = cache_dir / filename
    npk_url = f"https://download.mikrotik.com/routeros/{version}/{filename}"

    # Check if already cached
    if local_path.exists() and local_path.stat().st_size > 0:
        logger.info("Firmware already cached: %s", local_path)
        return str(local_path)

    logger.info("Downloading firmware: %s", npk_url)

    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("GET", npk_url) as response:
            response.raise_for_status()
            with open(local_path, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    f.write(chunk)

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
        current_version = dev[3]
        arch = dev[4]
        channel = dev[5] or "stable"

        latest = latest_versions.get((arch, channel)) if arch else None
        latest_version = latest["version"] if latest else None

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
        # A version is "latest" if it matches the latest for any arch/channel combo
        is_latest = any(
            v["version"] == ver for v in latest_versions.values()
        )
        groups.append({
            "version": ver,
            "count": len(devs),
            "is_latest": is_latest,
            "devices": devs,
        })

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
                cached.append({
                    "path": str(npk_file),
                    "version": version_dir.name,
                    "filename": npk_file.name,
                    "size_bytes": npk_file.stat().st_size,
                })

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
