"""
Filters parsed sessions/shots down to only records not yet in the database.
Ingestion is fully idempotent — re-running never duplicates data.
"""

from __future__ import annotations

from ingester.parse import ParsedSession, Shot
from db import get_connection


def filter_new_shots(session: ParsedSession) -> list[Shot]:
    conn = get_connection()
    existing = {
        r[0]
        for r in conn.execute(
            "SELECT shot_id FROM shots WHERE session_id = ?",
            [session.session_id],
        ).fetchall()
    }
    return [s for s in session.shots if s.shot_id not in existing]


def session_exists(session_id: str) -> bool:
    conn = get_connection()
    row = conn.execute(
        "SELECT 1 FROM sessions WHERE session_id = ?", [session_id]
    ).fetchone()
    return row is not None
