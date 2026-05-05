"""
Handles r-cloud authentication and session cookie persistence.
Cookies are cached to disk so repeated runs avoid a full login.
"""

import json
import os
from pathlib import Path

from playwright.sync_api import Page, BrowserContext

COOKIE_PATH = Path(".rcloud_cookies.json")


def login(page: Page, context: BrowserContext) -> None:
    """Log in to r-cloud, reusing cached cookies when valid."""
    if _load_cookies(context):
        page.goto(os.environ["RCLOUD_BASE_URL"])
        if _is_authenticated(page):
            return

    _do_login(page)
    _save_cookies(context)


def _do_login(page: Page) -> None:
    page.goto(os.environ["RCLOUD_LOGIN_URL"])

    # Wait for the form to be interactive before filling
    page.wait_for_selector('input[name="email"]', state="visible", timeout=15_000)

    page.fill('input[name="email"]', os.environ["RCLOUD_EMAIL"])
    page.fill('input[type="password"]', os.environ["RCLOUD_PASSWORD"])
    page.click('button:has-text("Login")')

    # Wait for redirect away from the login/root page to the authenticated app
    page.wait_for_selector(".type-filter-option, .menu-item", timeout=20_000)


def _is_authenticated(page: Page) -> bool:
    # The app renders a sidebar with .menu-item when authenticated
    try:
        page.wait_for_selector(".menu-item", state="visible", timeout=8_000)
        return True
    except Exception:
        return False


def _save_cookies(context: BrowserContext) -> None:
    COOKIE_PATH.write_text(json.dumps(context.cookies()))


def _load_cookies(context: BrowserContext) -> bool:
    if not COOKIE_PATH.exists():
        return False
    try:
        cookies = json.loads(COOKIE_PATH.read_text())
        context.add_cookies(cookies)
        return True
    except Exception:
        return False


def clear_cookies() -> None:
    COOKIE_PATH.unlink(missing_ok=True)
