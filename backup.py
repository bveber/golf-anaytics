"""
Backup utilities: DB snapshots + per-session CSV retention.

DB snapshots:  backups/db/golf_analytics_YYYY-MM-DD.duckdb            (keep last 30 locally; mirrored to S3 db/)
Session CSVs:  backups/sessions/user_<user_id>/<session_id>.csv       (kept forever; mirrored to S3 sessions/user_<user_id>/)
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
    _upload_to_s3(dest, f"db/{dest.name}")
    return dest


def backup_session_csv(csv_path: Path, user_id: int) -> None:
    """Mirror a downloaded session CSV to S3 under a per-user path."""
    _upload_to_s3(csv_path, f"sessions/user_{user_id}/{csv_path.name}")


def _upload_to_s3(path: Path, key: str) -> None:
    bucket = os.environ.get("BACKUP_S3_BUCKET")
    if not bucket:
        return
    import boto3

    boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1")).upload_file(
        str(path), bucket, key
    )


def _prune_old_db_backups(backup_dir: Path, keep: int) -> None:
    snapshots = sorted(backup_dir.glob("golf_analytics_*.duckdb"))
    for old in snapshots[:-keep]:
        old.unlink()
