"""
Writes parsed, deduplicated session and shot records into DuckDB.
"""

from __future__ import annotations

import duckdb
from pathlib import Path

from ingester.parse import ParsedSession, Shot
from ingester.deduplicate import filter_new_shots, session_exists
from ingester.impute import impute_club_speeds, compute_stopping_power
from api.compute import recompute_adjustments
from db import get_connection

_DB_PATH = Path(__file__).parent.parent / "db" / "golf_analytics.duckdb"


def _apply_effort_thresholds(shot_ids: list[str]) -> None:
    """Classify new shots using existing thresholds so they appear on the Clubs page."""
    if not shot_ids:
        return
    conn = get_connection()
    rows = conn.execute(
        "SELECT club_type, bucket_index, upper_bound FROM swing_effort_thresholds ORDER BY club_type, bucket_index"
    ).fetchall()
    if not rows:
        return

    thresholds: dict[str, list[tuple[int, float | None]]] = {}
    for club_type, bucket_index, upper_bound in rows:
        thresholds.setdefault(club_type, []).append((bucket_index, upper_bound))

    placeholders = ",".join("?" * len(shot_ids))
    shots = conn.execute(
        f"SELECT shot_id, club_type, club_speed FROM shots WHERE shot_id IN ({placeholders})",
        shot_ids,
    ).fetchall()

    for shot_id, club_type, club_speed in shots:
        if club_type not in thresholds:
            continue
        if club_speed is None:
            conn.execute("UPDATE shots SET swing_effort = 'unknown' WHERE shot_id = ?", [shot_id])
        else:
            effort = str(thresholds[club_type][-1][0])
            for bucket_index, upper_bound in thresholds[club_type]:
                if upper_bound is None or club_speed <= upper_bound:
                    effort = str(bucket_index)
                    break
            conn.execute("UPDATE shots SET swing_effort = ? WHERE shot_id = ?", [effort, shot_id])


def load_session(session: ParsedSession) -> int:
    """
    Insert the session and any new shots into the database.
    Returns the number of new shots inserted.
    """
    conn = get_connection()

    if not session_exists(session.session_id):
        conn.execute(
            """
            INSERT INTO sessions (session_id, session_date, session_type, scraped_at)
            VALUES (?, ?, ?, ?)
            """,
            [session.session_id, session.session_date, session.session_type, session.scraped_at],
        )

    new_shots = filter_new_shots(session)
    if new_shots:
        conn.executemany(
            """
            INSERT INTO shots (
                shot_id, session_id, shot_number, club, club_type, target_distance,
                ball_speed, launch_angle, launch_direction,
                spin_rate, spin_axis, smash_factor,
                carry_distance, total_distance, side_carry,
                apex, descent_angle,
                club_speed, attack_angle, club_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    s.shot_id, s.session_id, s.shot_number, s.club, s.club_type,
                    s.target_distance,
                    s.ball_speed, s.launch_angle, s.launch_direction,
                    s.spin_rate, s.spin_axis, s.smash_factor,
                    s.carry_distance, s.total_distance, s.side_carry,
                    s.apex, s.descent_angle,
                    s.club_speed, s.attack_angle, s.club_path,
                )
                for s in new_shots
            ],
        )

    if new_shots:
        impute_club_speeds()
        _apply_effort_thresholds(shot_ids=[s.shot_id for s in new_shots])
        compute_stopping_power(shot_ids=[s.shot_id for s in new_shots])
        adj_conn = duckdb.connect(str(_DB_PATH))
        try:
            recompute_adjustments(adj_conn)
        finally:
            adj_conn.close()

    return len(new_shots)
