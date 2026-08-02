"""
Single-worker background queue for running syncs. A lone worker thread pulling
from a lone queue guarantees two users' syncs never write to DuckDB concurrently,
without needing an external broker (Redis/SQS) at this scale.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time

import schedule

from api.db import get_conn

log = logging.getLogger("sync_queue")

_JOB_COLS = ["job_id", "user_id", "status", "trigger", "created_at", "started_at", "finished_at", "result", "error"]

_queue: "queue.Queue[tuple[int, int]]" = queue.Queue()
_started = False
_start_lock = threading.Lock()


def enqueue_sync(user_id: int, trigger: str = "manual") -> int:
    row = get_conn().execute(
        "INSERT INTO sync_jobs (user_id, trigger, status) VALUES (?, ?, 'queued') RETURNING job_id",
        [user_id, trigger],
    ).fetchone()
    job_id = row[0]
    _queue.put((job_id, user_id))
    return job_id


def get_job(job_id: int) -> dict | None:
    row = get_conn().execute(
        f"SELECT {', '.join(_JOB_COLS)} FROM sync_jobs WHERE job_id = ?", [job_id]
    ).fetchone()
    return dict(zip(_JOB_COLS, row)) if row else None


def list_jobs_for_user(user_id: int, limit: int = 20) -> list[dict]:
    rows = get_conn().execute(
        f"SELECT {', '.join(_JOB_COLS)} FROM sync_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        [user_id, limit],
    ).fetchall()
    return [dict(zip(_JOB_COLS, r)) for r in rows]


def _run_job(job_id: int, user_id: int) -> None:
    from sync import run_sync_for_user

    get_conn().execute("UPDATE sync_jobs SET status = 'running', started_at = now() WHERE job_id = ?", [job_id])
    try:
        n = run_sync_for_user(user_id, headless=True)
        get_conn().execute(
            "UPDATE sync_jobs SET status = 'success', finished_at = now(), result = ? WHERE job_id = ?",
            [f"{n} new shot(s)", job_id],
        )
    except Exception as e:
        log.exception("Sync job %d failed for user_id=%d", job_id, user_id)
        get_conn().execute(
            "UPDATE sync_jobs SET status = 'failed', finished_at = now(), error = ? WHERE job_id = ?",
            [str(e), job_id],
        )


def _worker_loop() -> None:
    while True:
        job_id, user_id = _queue.get()
        try:
            _run_job(job_id, user_id)
        finally:
            _queue.task_done()


def _enqueue_all_users_nightly() -> None:
    user_ids = [r[0] for r in get_conn().execute("SELECT user_id FROM users").fetchall()]
    for user_id in user_ids:
        enqueue_sync(user_id, trigger="scheduled")
    log.info("Enqueued nightly sync for %d user(s)", len(user_ids))


def _scheduler_loop() -> None:
    sync_time = os.environ.get("SYNC_TIME", "02:00")
    schedule.every().day.at(sync_time).do(_enqueue_all_users_nightly)
    while True:
        schedule.run_pending()
        time.sleep(60)


def start() -> None:
    """Start the worker thread, the nightly scheduler thread, and re-enqueue any
    jobs left 'queued' from before a process restart. Call once at app startup."""
    global _started
    with _start_lock:
        if _started:
            return
        _started = True

        threading.Thread(target=_worker_loop, daemon=True, name="sync-worker").start()
        threading.Thread(target=_scheduler_loop, daemon=True, name="sync-scheduler").start()

        stuck = get_conn().execute("SELECT job_id, user_id FROM sync_jobs WHERE status = 'queued'").fetchall()
        for job_id, user_id in stuck:
            _queue.put((job_id, user_id))
        if stuck:
            log.info("Re-enqueued %d job(s) left over from before restart", len(stuck))
