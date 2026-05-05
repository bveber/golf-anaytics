"""
Nightly scheduler: runs sync automatically at the configured SYNC_TIME (default 02:00).

Usage:
    python -m scraper.scheduler          # runs forever, syncs nightly
    python -m scraper.scheduler --once   # run one sync immediately and exit
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import time

import click
import schedule
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [scheduler] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def run_sync() -> None:
    log.info("Starting nightly sync...")
    result = subprocess.run(
        [sys.executable, "sync.py", "--headless"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        log.info("Sync completed.\n%s", result.stdout.strip())
    else:
        log.error("Sync failed (exit %d):\n%s\n%s", result.returncode, result.stdout, result.stderr)


@click.command()
@click.option("--once", is_flag=True, help="Run one sync immediately and exit")
def main(once: bool) -> None:
    if once:
        run_sync()
        return

    sync_time = os.environ.get("SYNC_TIME", "02:00")
    schedule.every().day.at(sync_time).do(run_sync)
    log.info("Scheduler running. Next sync at %s daily. Ctrl-C to stop.", sync_time)

    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    main()
