"""
Discovers sessions in r-cloud and returns those not yet in the database.

The sessions page filters by type (Practice, Combine, Courses, etc.).
We click through each filter tab to collect all sessions across all types.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import Page

from db import get_connection

SESSION_TYPES = [
    "Practice", "Combine", "Courses", "Range",
    "Target Range", "Closest to Pin", "Speed",
]


@dataclass
class RemoteSession:
    session_id: str
    session_date: str   # raw string from the UI (MM/DD/YY); parsed in ingester
    session_type: str   # as it appears in the URL query param (e.g. "practice")


def get_new_sessions(page: Page) -> list[RemoteSession]:
    """Return sessions on r-cloud that are not yet in the local database."""
    all_sessions = _scrape_all_session_types(page)
    known_ids = _get_known_session_ids()
    return [s for s in all_sessions if s.session_id not in known_ids]


def _get_known_session_ids() -> set[str]:
    conn = get_connection()
    rows = conn.execute("SELECT session_id FROM sessions").fetchall()
    return {r[0] for r in rows}


def _scrape_all_session_types(page: Page) -> list[RemoteSession]:
    base_url = os.environ["RCLOUD_BASE_URL"].rstrip("/")
    page.goto(f"{base_url}/sessions")
    _wait(page)

    # SPAs can take a moment to hydrate after navigation; retry with a longer timeout
    page.wait_for_selector(".type-filter-option", timeout=30_000)

    sessions: list[RemoteSession] = []
    seen_ids: set[str] = set()

    for session_type_label in SESSION_TYPES:
        tab = page.locator(f".type-filter-option:has-text('{session_type_label}')").first
        if not tab.count():
            continue

        tab.click()
        _wait(page)
        page.wait_for_timeout(800)  # let React re-render the table after tab switch

        for session in _scrape_current_tab(page):
            if session.session_id not in seen_ids:
                seen_ids.add(session.session_id)
                sessions.append(session)

    return sessions


def _scrape_current_tab(page: Page) -> list[RemoteSession]:
    sessions: list[RemoteSession] = []

    while True:
        try:
            page.wait_for_selector(".rdt_TableRow", timeout=8_000)
        except Exception:
            break  # no rows on this tab

        rows = page.locator(".rdt_TableRow").all()
        for row in rows:
            anchor = row.locator("a[href*='/session/']").first
            if not anchor.count():
                continue

            href = anchor.get_attribute("href") or ""
            session_id, session_type = _parse_session_href(href)
            if not session_id:
                continue

            cells = row.locator("[class*='rdt_TableCell']").all()
            date_str = cells[0].inner_text().strip() if cells else ""

            sessions.append(RemoteSession(
                session_id=session_id,
                session_date=date_str,
                session_type=session_type,
            ))

        next_btn = page.locator(
            "button[aria-label='Next Page'], button[id='pagination-next-page']"
        ).first
        if next_btn.count() and next_btn.is_enabled():
            next_btn.click()
            _wait(page)
        else:
            break

    return sessions


def _parse_session_href(href: str) -> tuple[str, str]:
    match = re.search(r"/session/([a-zA-Z0-9_-]+)", href)
    if not match:
        return "", "practice"
    session_id = match.group(1)
    qs = parse_qs(urlparse(href).query)
    session_type = qs.get("sessionType", ["practice"])[0]
    return session_id, session_type


def _wait(page: Page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except Exception:
        page.wait_for_load_state("domcontentloaded", timeout=15_000)
