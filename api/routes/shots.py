from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from api.db import get_conn
from api.models import CorrectedShot, OutlierUpdate, Shot

router = APIRouter(prefix="/shots", tags=["shots"])

SHOT_COLS = [
    "shot_id", "session_id", "shot_number", "club", "club_type",
    "target_distance", "is_outlier", "outlier_note",
    "ball_speed", "launch_angle", "launch_direction", "spin_rate", "spin_axis",
    "smash_factor", "carry_distance", "total_distance", "side_carry", "apex",
    "descent_angle", "club_speed", "attack_angle", "club_path", "swing_effort",
    "roll_medium_standard", "roll_medium_flyer", "flyer_carry_est",
    "ball_speed_adj", "club_speed_adj", "carry_distance_adj",
    "total_distance_adj", "smash_factor_adj",
]


@router.get("/session/{session_id}", response_model=list[CorrectedShot])
def get_shots_for_session(session_id: str) -> list[CorrectedShot]:
    conn = get_conn()
    rows = conn.execute(
        f"SELECT {', '.join(SHOT_COLS)} FROM shots WHERE session_id = ? ORDER BY shot_number",
        [session_id],
    ).fetchall()
    return [CorrectedShot(**dict(zip(SHOT_COLS, r))) for r in rows]


@router.get("/club/{club_type}", response_model=list[CorrectedShot])
def get_shots_by_club(
    club_type: str,
    include_outliers: bool = False,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    effort: Optional[str] = None,
    disabled_clubs: Optional[str] = None,
    limit_sessions: Optional[int] = None,
) -> list[CorrectedShot]:
    conn = get_conn()
    conditions = ["sh.club_type = ?"]
    params: list = [club_type]

    if not include_outliers:
        conditions.append("sh.is_outlier = false")
    if effort:
        buckets = [e.strip() for e in effort.split(",")]
        placeholders = ",".join("?" * len(buckets))
        conditions.append(f"sh.swing_effort IN ({placeholders})")
        params.extend(buckets)
    if date_from:
        conditions.append("s.session_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("s.session_date <= ?")
        params.append(date_to)
    if disabled_clubs:
        pairs = [c.strip() for c in disabled_clubs.split(",") if c.strip() and "|" in c]
        if pairs:
            placeholders = ",".join("?" * len(pairs))
            conditions.append(f"(sh.club_type || '|' || sh.club) NOT IN ({placeholders})")
            params.extend(pairs)
    if limit_sessions:
        conditions.append(f"sh.session_id IN (SELECT session_id FROM sessions ORDER BY session_date DESC LIMIT {limit_sessions})")

    where = " AND ".join(conditions)
    club_cols = [f"sh.{c}" for c in SHOT_COLS] + ["CAST(s.session_date AS VARCHAR) AS session_date"]
    rows = conn.execute(
        f"""
        SELECT {", ".join(club_cols)}
        FROM shots sh
        JOIN sessions s ON s.session_id = sh.session_id
        WHERE {where}
        ORDER BY s.session_date, sh.session_id, sh.shot_number
        """,
        params,
    ).fetchall()

    cols = SHOT_COLS + ["session_date"]
    return [CorrectedShot(**dict(zip(cols, r))) for r in rows]


@router.patch("/{shot_id}/outlier")
def update_outlier(shot_id: str, body: OutlierUpdate):
    conn = get_conn()
    exists = conn.execute("SELECT 1 FROM shots WHERE shot_id = ?", [shot_id]).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Shot not found")
    conn.execute(
        "UPDATE shots SET is_outlier = ?, outlier_note = ? WHERE shot_id = ?",
        [body.is_outlier, body.outlier_note, shot_id],
    )
    return {"ok": True}
