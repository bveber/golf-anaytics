"""
Writes parsed, deduplicated session and shot records into DuckDB.
"""

from __future__ import annotations

from ingester.parse import ParsedSession, Shot
from ingester.deduplicate import filter_new_shots, session_exists
from ingester.impute import impute_club_speeds, compute_stopping_power
from db import get_connection


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
        compute_stopping_power(shot_ids=[s.shot_id for s in new_shots])

    return len(new_shots)
