"""
Downloads the CSV export for a single session from r-cloud.

Session detail URL pattern: /session/{session_id}?sessionType={session_type}
The export button triggers a file download which Playwright captures.
"""

from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Page

from scraper.sessions import RemoteSession


def download_session_csv(page: Page, session: RemoteSession, backup_dir: Path) -> Path:
    """
    Navigate to the session detail page, click the CSV export button,
    and save to backup_dir/sessions/<session_id>.csv.

    Returns the path to the saved CSV file.
    """
    base_url = os.environ["RCLOUD_BASE_URL"].rstrip("/")
    url = f"{base_url}/session/{session.session_id}?sessionType={session.session_type}"

    page.goto(url)
    _wait(page)

    dest = backup_dir / "sessions" / f"{session.session_id}.csv"
    dest.parent.mkdir(parents=True, exist_ok=True)

    with page.expect_download() as download_info:
        page.click("button:has-text('EXPORT SESSION')")

    download = download_info.value
    download.save_as(str(dest))
    return dest


def _wait(page: Page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except Exception:
        page.wait_for_load_state("domcontentloaded", timeout=15_000)
