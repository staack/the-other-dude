"""Talks to mikrotik.com to find the latest WinBox release.

MikroTik does not publish a version index or JSON feed for WinBox (verified
2026-08-30 -- see docs/DEPLOYMENT.md's "WinBox Binary Updates" section). The
download page at mikrotik.com/download/winbox is a client-rendered Livewire
app: the version number and download links only exist in the DOM after JS
has run, so a plain HTTP GET returns nothing usable and this module drives a
real (headless) browser instead.

What MikroTik *does* publish, and what this whole pipeline leans on, is a
predictable per-file checksum: every download at
https://download.mikrotik.com/routeros/winbox/<version>/<file> has a sibling
at the same URL with `.sha256` appended, containing a standard
`<hexdigest>  <filename>` line for that exact file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

DOWNLOAD_PAGE_URL = "https://mikrotik.com/download/winbox"

_LINUX_ZIP_URL_RE = re.compile(
    r"^https://download\.mikrotik\.com/routeros/winbox/"
    r"(?P<version>\d+\.\d+(?:\.\d+)?)/WinBox_Linux\.zip$"
)


class ScrapeError(RuntimeError):
    """The download page didn't look the way this pipeline expects.

    Raised instead of guessing so a page-shape change on mikrotik.com shows
    up as a failed scheduled job someone notices, rather than a permanently
    stale WinBox pin or (worse) a bump built from data we didn't verify.
    """


@dataclass(frozen=True)
class WinboxRelease:
    version: str
    linux_zip_url: str
    checksum_url: str


def release_from_linux_href(href: str | None) -> WinboxRelease:
    """Turn a scraped WinBox-for-Linux download link into a WinboxRelease.

    Raises ScrapeError for anything that isn't exactly the expected
    `.../winbox/<version>/WinBox_Linux.zip` shape on the real MikroTik
    download host.
    """
    if not href:
        raise ScrapeError("no WinBox Linux download link found on the download page")

    match = _LINUX_ZIP_URL_RE.match(href)
    if not match:
        raise ScrapeError(
            f"WinBox Linux download URL doesn't match the expected shape: {href!r}"
        )

    return WinboxRelease(
        version=match.group("version"),
        linux_zip_url=href,
        checksum_url=href + ".sha256",
    )


def fetch_latest_release(page_url: str = DOWNLOAD_PAGE_URL) -> WinboxRelease:
    """Render the MikroTik WinBox download page and extract the latest release.

    Requires Playwright with the Chromium browser installed
    (`playwright install --with-deps chromium`).
    """
    from playwright.sync_api import (
        sync_playwright,  # lazy: only the live job needs this
    )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(page_url, wait_until="networkidle")
            link = page.wait_for_selector("a[href$='WinBox_Linux.zip']", timeout=15000)
            href = link.get_attribute("href")
        finally:
            browser.close()

    return release_from_linux_href(href)


def fetch_text(url: str) -> str:
    import requests  # lazy: only the live job needs this

    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.text


def download(url: str, dest: Path) -> None:
    import requests  # lazy: only the live job needs this

    response = requests.get(url, timeout=120, stream=True)
    response.raise_for_status()
    with open(dest, "wb") as f:
        f.writelines(response.iter_content(chunk_size=1024 * 1024))
