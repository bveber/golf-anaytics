"""
Handles r-cloud authentication and session cookie persistence.
Cookies are cached to disk (per-user) so repeated runs avoid a full login.
"""

import json
from pathlib import Path

from playwright.sync_api import Page, BrowserContext


def login(
    page: Page,
    context: BrowserContext,
    email: str,
    password: str,
    base_url: str,
    login_url: str,
    cookie_path: Path,
) -> None:
    """Log in to r-cloud, reusing cached cookies when valid."""
    if _load_cookies(context, cookie_path):
        page.goto(base_url)
        if _is_authenticated(page):
            return

    _do_login(page, email, password, login_url)
    _save_cookies(context, cookie_path)


def _do_login(page: Page, email: str, password: str, login_url: str) -> None:
    page.goto(login_url)

    # Wait for the form to be interactive before filling
    page.wait_for_selector('input[name="email"]', state="visible", timeout=15_000)

    page.fill('input[name="email"]', email)
    page.fill('input[type="password"]', password)
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


def _save_cookies(context: BrowserContext, cookie_path: Path) -> None:
    cookie_path.parent.mkdir(parents=True, exist_ok=True)
    cookie_path.write_text(json.dumps(context.cookies()))


def _load_cookies(context: BrowserContext, cookie_path: Path) -> bool:
    if not cookie_path.exists():
        return False
    try:
        cookies = json.loads(cookie_path.read_text())
        context.add_cookies(cookies)
        return True
    except Exception:
        return False


def clear_cookies(cookie_path: Path) -> None:
    cookie_path.unlink(missing_ok=True)
