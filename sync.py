"""
Manual sync CLI: python sync.py [--headless] [--dry-run]

Authenticates to r-cloud, finds new sessions, downloads their CSV exports,
parses and loads them into DuckDB, then backs up the database.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import click
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()


@click.command()
@click.option("--headless/--no-headless", default=True, help="Run browser headlessly")
@click.option("--dry-run", is_flag=True, help="Discover sessions but do not write to DB")
@click.option("--session-id", default=None, help="Force sync a specific session ID")
def main(headless: bool, dry_run: bool, session_id: str | None) -> None:
    _validate_env()

    from scraper.auth import login
    from scraper.sessions import get_new_sessions, RemoteSession
    from scraper.export import download_session_csv
    from ingester.parse import parse_csv
    from ingester.load import load_session
    from backup import backup_db

    backup_dir = Path(os.environ.get("BACKUP_DIR", "backups"))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        click.echo("Logging in to r-cloud...")
        login(page, context)
        click.echo("Authenticated.")

        if session_id:
            # Force-sync a single session by constructing a minimal RemoteSession.
            # session_date and session_type will be populated from the CSV or left blank.
            sessions = [RemoteSession(session_id=session_id, session_date="", session_type="Practice")]
            click.echo(f"Force-syncing session {session_id}")
        else:
            click.echo("Discovering new sessions...")
            sessions = get_new_sessions(page)
            click.echo(f"Found {len(sessions)} new session(s).")

        if not sessions:
            click.echo("Nothing to sync.")
            browser.close()
            return

        total_shots = 0
        for i, session in enumerate(sessions, 1):
            click.echo(f"[{i}/{len(sessions)}] Session {session.session_id} ({session.session_type})")

            csv_path = download_session_csv(page, session, backup_dir)
            click.echo(f"  Downloaded → {csv_path}")

            parsed = parse_csv(csv_path, session.session_id, session.session_date, session.session_type)
            click.echo(f"  Parsed {len(parsed.shots)} shots")

            if not dry_run:
                n = load_session(parsed)
                click.echo(f"  Loaded {n} new shots into DB")
                total_shots += n
            else:
                click.echo("  [dry-run] skipping DB write")

        browser.close()

    if not dry_run and total_shots > 0:
        dest = backup_db()
        click.echo(f"DB backed up → {dest}")

    click.echo(f"Done. {total_shots} total shots ingested.")


def _validate_env() -> None:
    required = ["RCLOUD_EMAIL", "RCLOUD_PASSWORD", "RCLOUD_BASE_URL", "RCLOUD_LOGIN_URL"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        click.echo(f"Missing required env vars: {', '.join(missing)}", err=True)
        click.echo("Copy .env.example to .env and fill in your credentials.", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
