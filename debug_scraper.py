"""
Debug script: opens a visible browser, steps through auth + session discovery,
and saves screenshots at each stage to debug/.

Usage: .venv/bin/python debug_scraper.py
"""

import os
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

OUT = Path("debug")
OUT.mkdir(exist_ok=True)


def shot(page, name: str) -> None:
    path = OUT / f"{name}.png"
    page.wait_for_timeout(1500)  # let fonts/animations settle
    try:
        page.screenshot(path=str(path), full_page=True, timeout=10_000)
    except Exception as e:
        print(f"  [screenshot failed: {e}]")
        return
    print(f"  [screenshot] {path}")


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=500)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        # --- Step 1: Load login page ---
        login_url = os.environ["RCLOUD_LOGIN_URL"]
        print(f"\n1. Navigating to login page: {login_url}")
        page.goto(login_url)
        _wait(page)
        shot(page, "01_login_page")
        print(f"   URL: {page.url}")
        print(f"   Title: {page.title()}")

        # --- Step 2: Fill credentials ---
        print("\n2. Filling credentials...")
        email = os.environ["RCLOUD_EMAIL"]
        password = os.environ["RCLOUD_PASSWORD"]

        # Try to find and fill the email field
        email_sel = _find_selector(page, [
            'input[type="email"]', 'input[name="email"]', '#email',
            'input[placeholder*="email" i]', 'input[placeholder*="username" i]',
        ])
        print(f"   Email selector: {email_sel}")
        if email_sel:
            page.fill(email_sel, email)

        password_sel = _find_selector(page, [
            'input[type="password"]', 'input[name="password"]', '#password',
        ])
        print(f"   Password selector: {password_sel}")
        if password_sel:
            page.fill(password_sel, password)

        shot(page, "02_credentials_filled")

        # --- Step 3: Submit ---
        print("\n3. Submitting login form...")
        submit_sel = _find_selector(page, [
            'button[type="submit"]', 'input[type="submit"]',
            'button:has-text("Login")', 'button:has-text("Sign in")',
            'button:has-text("Log in")',
        ])
        print(f"   Submit selector: {submit_sel}")
        if submit_sel:
            page.click(submit_sel)
        else:
            print("   WARNING: no submit button found — pressing Enter instead")
            if password_sel:
                page.press(password_sel, "Enter")

        _wait(page)
        shot(page, "03_after_login")
        print(f"   URL after login: {page.url}")
        print(f"   Title: {page.title()}")

        # --- Step 4: Find + click the Sessions nav link ---
        print("\n4. Finding Sessions nav link...")
        # Dump all nav/menu anchor hrefs so we can see the real URL structure
        nav_links = page.evaluate("""
            () => [...document.querySelectorAll('a[href], .menu-item, .menu-item-content')]
                .map(el => ({ text: el.innerText?.trim(), href: el.getAttribute('href') }))
                .filter(l => l.text || l.href)
        """)
        print("   Nav elements found:")
        for link in nav_links:
            print(f"     text={link['text']!r:30s}  href={link['href']!r}")

        sessions_link = page.locator(".menu-item:has-text('SESSIONS'), a:has-text('SESSIONS')").first
        if sessions_link.count():
            sessions_link.click()
            _wait(page)
        shot(page, "04_sessions_page")
        print(f"   URL after clicking Sessions: {page.url}")
        print(f"   Title: {page.title()}")

        # --- Step 4b: Probe the session type filter ---
        print("\n4b. Probing type filter options...")
        filter_options = page.evaluate("""
            () => [...document.querySelectorAll('[class*="type-filter-option"], [class*="typeFilter"], [class*="filter-option"]')]
                .map(el => ({ text: el.innerText.trim(), cls: el.className }))
        """)
        print(f"   Filter options: {filter_options}")

        # --- Step 5: Inspect table row structure ---
        print("\n5. Probing session table rows...")

        # Wait for table rows to appear
        try:
            page.wait_for_selector("[class*='rdt_TableRow']", timeout=10_000)
        except Exception:
            print("   WARNING: no rdt_TableRow elements found within 10s")

        row_count = page.locator("[class*='rdt_TableRow']").count()
        print(f"   rdt_TableRow count: {row_count}")

        # Print table headers
        headers = page.evaluate("""
            () => [...document.querySelectorAll('[class*="rdt_TableCol"]')]
                .map(el => el.innerText.trim())
                .filter(Boolean)
        """)
        print(f"   Table headers: {headers}")

        # Print first 3 rows' full text content + any data attributes
        rows_data = page.evaluate("""
            () => [...document.querySelectorAll('[class*="rdt_TableRow"]')].slice(0, 3).map(row => ({
                text: row.innerText.replace(/\\n/g, ' | '),
                attrs: [...row.attributes].map(a => `${a.name}=${a.value}`),
                hrefs: [...row.querySelectorAll('a')].map(a => a.href),
                dataAttrs: Object.fromEntries(
                    [...row.attributes]
                        .filter(a => a.name.startsWith('data-'))
                        .map(a => [a.name, a.value])
                ),
            }))
        """)
        print(f"\n   First {len(rows_data)} row(s):")
        for i, row in enumerate(rows_data):
            print(f"\n   Row {i+1}:")
            print(f"     text:  {row['text'][:120]}")
            print(f"     attrs: {row['attrs']}")
            print(f"     hrefs: {row['hrefs']}")
            print(f"     data:  {row['dataAttrs']}")

        shot(page, "05_sessions_table")

        # --- Step 6: Navigate into first session and probe for export button ---
        print("\n6. Navigating into first session...")
        first_link = page.locator(".rdt_TableRow a[href*='/session/']").first
        if first_link.count():
            session_href = first_link.get_attribute("href")
            print(f"   Session URL: {session_href}")
            first_link.click()
            _wait(page)
            shot(page, "06_session_detail")
            print(f"   URL: {page.url}")

            # Probe for export/download button
            export_probes = [
                "button:has-text('Export')", "button:has-text('Download')",
                "a:has-text('Export')", "a:has-text('Download')",
                "a:has-text('CSV')", "button:has-text('CSV')",
                "[aria-label*='export' i]", "[aria-label*='download' i]",
                "[class*='export']", "[class*='download']",
            ]
            print("   Export button candidates:")
            for sel in export_probes:
                try:
                    count = page.locator(sel).count()
                    if count:
                        texts = [page.locator(sel).nth(i).inner_text() for i in range(min(count, 3))]
                        print(f"     {sel!r:45s} → {count}x  text={texts}")
                except Exception:
                    pass

            # Dump all buttons and links on the page
            buttons = page.evaluate("""
                () => [...document.querySelectorAll('button, a[href]')]
                    .map(el => ({ tag: el.tagName, text: el.innerText?.trim().slice(0, 40), href: el.getAttribute('href'), cls: el.className?.slice(0, 60) }))
                    .filter(el => el.text)
            """)
            print("\n   All buttons/links on session detail page:")
            for b in buttons:
                print(f"     [{b['tag']}] text={b['text']!r:35s} href={str(b['href'])[:50]:50s} cls={b['cls']}")
        else:
            print("   No session links found")

        print("\nBrowser staying open for 60s — inspect it manually, then it will close.")
        page.wait_for_timeout(60_000)
        browser.close()

    print(f"\nScreenshots saved to {OUT}/")


def _wait(page) -> None:
    """Wait for page to settle — falls back gracefully on SPA continuous requests."""
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except Exception:
        page.wait_for_load_state("domcontentloaded", timeout=15_000)


def _find_selector(page, candidates: list[str]) -> str | None:
    for sel in candidates:
        try:
            if page.locator(sel).count() > 0:
                return sel
        except Exception:
            pass
    return None


if __name__ == "__main__":
    main()
