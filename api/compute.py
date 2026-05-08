from __future__ import annotations

import duckdb

from api.corrections import apply_shot_correction

_ADJ_COLS = [
    "ball_speed_adj",
    "club_speed_adj",
    "carry_distance_adj",
    "total_distance_adj",
    "smash_factor_adj",
]


def ensure_adj_columns(conn: duckdb.DuckDBPyConnection) -> None:
    for col in _ADJ_COLS:
        try:
            conn.execute(f"ALTER TABLE shots ADD COLUMN IF NOT EXISTS {col} DOUBLE")
        except Exception:
            pass


def recompute_adjustments(conn: duckdb.DuckDBPyConnection) -> int:
    """Recompute all _adj columns for all shots using current user_settings.
    Returns the number of shots updated."""
    settings = conn.execute(
        "SELECT elevation_ft, temperature_f FROM user_settings WHERE id = 1"
    ).fetchone()
    elev = settings[0] if settings else 900.0
    temp = settings[1] if settings else 70.0

    rows = conn.execute(
        """
        SELECT
            shot_id,
            club_type,
            ball_speed,
            club_speed,
            carry_distance,
            total_distance
        FROM shots
        """
    ).fetchall()

    updates = []
    for shot_id, club_type, ball_speed, club_speed, carry_distance, total_distance in rows:
        shot_dict = {
            "club_type": club_type,
            "ball_speed": ball_speed,
            "club_speed": club_speed,
            "carry_distance": carry_distance,
            "total_distance": total_distance,
        }
        adj = apply_shot_correction(shot_dict, elev, temp)
        updates.append((
            adj["ball_speed_adj"],
            adj["club_speed_adj"],
            adj["carry_distance_adj"],
            adj["total_distance_adj"],
            adj["smash_factor_adj"],
            shot_id,
        ))

    if updates:
        conn.executemany(
            """
            UPDATE shots SET
                ball_speed_adj     = ?,
                club_speed_adj     = ?,
                carry_distance_adj = ?,
                total_distance_adj = ?,
                smash_factor_adj   = ?
            WHERE shot_id = ?
            """,
            updates,
        )
    return len(updates)
