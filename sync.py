"""
Sync one user's Rapsodo/MLM2Pro data into DuckDB.

Manual CLI: python sync.py [--user-id N] [--headless] [--dry-run]

Fetches that user's r-cloud credentials from Secrets Manager, authenticates,
finds new sessions, downloads their CSV exports, parses and loads them into
DuckDB, then backs up the database.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import click
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()


def run_sync_for_user(
    user_id: int,
    headless: bool = True,
    dry_run: bool = False,
    session_id: str | None = None,
) -> int:
    """Run a sync for one user's Rapsodo account. Returns the number of new shots ingested."""
    _validate_env()

    from api.secrets import get_rcloud_credentials
    from scraper.auth import login
    from scraper.sessions import get_new_sessions, RemoteSession
    from scraper.export import download_session_csv
    from ingester.parse import parse_csv
    from ingester.load import load_session
    from backup import backup_db

    creds = get_rcloud_credentials(user_id)
    if not creds:
        raise RuntimeError(f"No Rapsodo credentials configured for user_id={user_id}")
    email, password = creds

    base_url = os.environ["RCLOUD_BASE_URL"]
    login_url = os.environ["RCLOUD_LOGIN_URL"]
    backup_dir = Path(os.environ.get("BACKUP_DIR", "backups"))
    cookie_path = Path(f".cookies/{user_id}.json")

    total_shots = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        click.echo(f"[user {user_id}] Logging in to r-cloud...")
        login(page, context, email, password, base_url, login_url, cookie_path)
        click.echo(f"[user {user_id}] Authenticated.")

        if session_id:
            # Force-sync a single session by constructing a minimal RemoteSession.
            # session_date and session_type will be populated from the CSV or left blank.
            sessions = [RemoteSession(session_id=session_id, session_date="", session_type="Practice")]
            click.echo(f"[user {user_id}] Force-syncing session {session_id}")
        else:
            click.echo(f"[user {user_id}] Discovering new sessions...")
            sessions = get_new_sessions(page, base_url, user_id)
            click.echo(f"[user {user_id}] Found {len(sessions)} new session(s).")

        for i, session in enumerate(sessions, 1):
            click.echo(f"[user {user_id}] [{i}/{len(sessions)}] Session {session.session_id} ({session.session_type})")
            csv_path = download_session_csv(page, session, backup_dir, base_url, user_id)
            parsed = parse_csv(csv_path, session.session_id, session.session_date, session.session_type)

            if not dry_run:
                n = load_session(parsed, user_id)
                click.echo(f"[user {user_id}]   Loaded {n} new shots")
                total_shots += n
            else:
                click.echo(f"[user {user_id}]   [dry-run] parsed {len(parsed.shots)} shots, skipping DB write")

        browser.close()

    if not dry_run and total_shots > 0:
        backup_db()

    return total_shots


def _validate_env() -> None:
    required = ["RCLOUD_BASE_URL", "RCLOUD_LOGIN_URL"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")


@click.command()
@click.option("--headless/--no-headless", default=True, help="Run browser headlessly")
@click.option("--dry-run", is_flag=True, help="Discover sessions but do not write to DB")
@click.option("--session-id", default=None, help="Force sync a specific session ID")
@click.option("--user-id", default=1, type=int, help="App user_id to sync")
def main(headless: bool, dry_run: bool, session_id: str | None, user_id: int) -> None:
    try:
        n = run_sync_for_user(user_id, headless=headless, dry_run=dry_run, session_id=session_id)
    except RuntimeError as e:
        click.echo(str(e), err=True)
        sys.exit(1)
    click.echo(f"Done. {n} total shots ingested for user_id={user_id}.")


if __name__ == "__main__":
    main()
