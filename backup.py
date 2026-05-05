"""
Backup utilities: DB snapshots + per-session CSV retention.

DB snapshots:  backups/db/golf_analytics_YYYY-MM-DD.duckdb  (keep last 30)
Session CSVs:  backups/sessions/<session_id>.csv             (kept forever)
"""

from __future__ import annotations

import os
import shutil
from datetime import date
from pathlib import Path


def backup_db() -> Path:
    db_path = Path(os.environ.get("DB_PATH", "db/golf_analytics.duckdb"))
    backup_dir = Path(os.environ.get("BACKUP_DIR", "backups")) / "db"
    backup_dir.mkdir(parents=True, exist_ok=True)

    dest = backup_dir / f"golf_analytics_{date.today()}.duckdb"
    shutil.copy2(db_path, dest)

    _prune_old_db_backups(backup_dir, keep=30)
    return dest


def _prune_old_db_backups(backup_dir: Path, keep: int) -> None:
    snapshots = sorted(backup_dir.glob("golf_analytics_*.duckdb"))
    for old in snapshots[:-keep]:
        old.unlink()
