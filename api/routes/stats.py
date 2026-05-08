from __future__ import annotations

from typing import Optional

from fastapi import APIRouter

from api.db import get_conn
from api.models import ClubStats

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/clubs", response_model=list[ClubStats])
def club_stats(
    include_outliers: bool = False,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    session_type: Optional[str] = None,
    effort: Optional[str] = None,
    session_id: Optional[str] = None,
    disabled_clubs: Optional[str] = None,
    limit_sessions: Optional[int] = None,
):
    conn = get_conn()
    conditions = ["sh.club_type IS NOT NULL", "sh.club IS NOT NULL"]
    params: list = []

    if not include_outliers:
        conditions.append("sh.is_outlier = false")
    if session_id:
        conditions.append("sh.session_id = ?")
        params.append(session_id)
    if effort == "full":
        conditions.append(
            "sh.swing_effort = (SELECT CAST(MAX(t.bucket_index) AS VARCHAR) FROM swing_effort_thresholds t WHERE t.club_type = sh.club_type)"
        )
    elif effort:
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
    if session_type:
        conditions.append("s.session_type = ?")
        params.append(session_type)
    if disabled_clubs:
        pairs = [c.strip() for c in disabled_clubs.split(",") if c.strip() and "|" in c]
        if pairs:
            placeholders = ",".join("?" * len(pairs))
            conditions.append(f"(sh.club_type || '|' || sh.club) NOT IN ({placeholders})")
            params.extend(pairs)
    if limit_sessions:
        conditions.append(f"sh.session_id IN (SELECT session_id FROM sessions ORDER BY session_date DESC LIMIT {limit_sessions})")

    where = " AND ".join(conditions)
    # IQR_THRESHOLD: clubs with fewer shots skip IQR filtering (not enough data).
    # For qualifying clubs the CASE expression passes only values inside
    # [Q1 - 1.5*IQR, Q3 + 1.5*IQR]; AVG/STDDEV naturally ignore the NULLs.
    rows = conn.execute(
        f"""
        WITH iqr AS (
            SELECT
                sh.club,
                sh.club_type,
                COUNT(*)                                                              AS shot_count,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.carry_distance)      AS carry_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.carry_distance)      AS carry_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.total_distance)      AS total_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.total_distance)      AS total_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.ball_speed)          AS ball_speed_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.ball_speed)          AS ball_speed_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.spin_rate)           AS spin_rate_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.spin_rate)           AS spin_rate_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.smash_factor)        AS smash_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.smash_factor)        AS smash_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.side_carry)          AS side_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.side_carry)          AS side_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.launch_angle)        AS launch_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.launch_angle)        AS launch_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.club_speed)          AS club_speed_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.club_speed)          AS club_speed_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.spin_axis)           AS spin_axis_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.spin_axis)           AS spin_axis_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.club_path)           AS club_path_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.club_path)           AS club_path_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.attack_angle)        AS attack_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.attack_angle)        AS attack_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.launch_direction)    AS launch_dir_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.launch_direction)    AS launch_dir_q3,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sh.apex)                AS apex_q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sh.apex)                AS apex_q3
            FROM shots sh
            JOIN sessions s ON s.session_id = sh.session_id
            WHERE {where}
            GROUP BY sh.club, sh.club_type
        )
        SELECT
            sh.club,
            sh.club_type,
            q.shot_count,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.carry_distance  BETWEEN q.carry_q1  - 1.5*(q.carry_q3-q.carry_q1)
                                               AND q.carry_q3  + 1.5*(q.carry_q3-q.carry_q1)
                THEN sh.carry_distance  END)                                           AS carry_mean,
            STDDEV(CASE WHEN q.shot_count < 8
                        OR sh.carry_distance BETWEEN q.carry_q1 - 1.5*(q.carry_q3-q.carry_q1)
                                                 AND q.carry_q3 + 1.5*(q.carry_q3-q.carry_q1)
                THEN sh.carry_distance END)                                            AS carry_std,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.total_distance  BETWEEN q.total_q1  - 1.5*(q.total_q3-q.total_q1)
                                               AND q.total_q3  + 1.5*(q.total_q3-q.total_q1)
                THEN sh.total_distance  END)                                           AS total_mean,
            STDDEV(CASE WHEN q.shot_count < 8
                        OR sh.total_distance BETWEEN q.total_q1 - 1.5*(q.total_q3-q.total_q1)
                                                 AND q.total_q3 + 1.5*(q.total_q3-q.total_q1)
                THEN sh.total_distance END)                                            AS total_std,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.ball_speed      BETWEEN q.ball_speed_q1 - 1.5*(q.ball_speed_q3-q.ball_speed_q1)
                                               AND q.ball_speed_q3 + 1.5*(q.ball_speed_q3-q.ball_speed_q1)
                THEN sh.ball_speed      END)                                           AS ball_speed_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.spin_rate       BETWEEN q.spin_rate_q1  - 1.5*(q.spin_rate_q3-q.spin_rate_q1)
                                               AND q.spin_rate_q3  + 1.5*(q.spin_rate_q3-q.spin_rate_q1)
                THEN sh.spin_rate       END)                                           AS spin_rate_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.smash_factor    BETWEEN q.smash_q1      - 1.5*(q.smash_q3-q.smash_q1)
                                               AND q.smash_q3      + 1.5*(q.smash_q3-q.smash_q1)
                THEN sh.smash_factor    END)                                           AS smash_factor_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.side_carry      BETWEEN q.side_q1       - 1.5*(q.side_q3-q.side_q1)
                                               AND q.side_q3       + 1.5*(q.side_q3-q.side_q1)
                THEN sh.side_carry      END)                                           AS side_carry_mean,
            STDDEV(CASE WHEN q.shot_count < 8
                        OR sh.side_carry   BETWEEN q.side_q1 - 1.5*(q.side_q3-q.side_q1)
                                               AND q.side_q3 + 1.5*(q.side_q3-q.side_q1)
                THEN sh.side_carry END)                                                AS side_carry_std,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.launch_angle    BETWEEN q.launch_q1     - 1.5*(q.launch_q3-q.launch_q1)
                                               AND q.launch_q3     + 1.5*(q.launch_q3-q.launch_q1)
                THEN sh.launch_angle    END)                                           AS launch_angle_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.club_speed      BETWEEN q.club_speed_q1 - 1.5*(q.club_speed_q3-q.club_speed_q1)
                                               AND q.club_speed_q3 + 1.5*(q.club_speed_q3-q.club_speed_q1)
                THEN sh.club_speed      END)                                           AS club_speed_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.spin_axis       BETWEEN q.spin_axis_q1  - 1.5*(q.spin_axis_q3-q.spin_axis_q1)
                                               AND q.spin_axis_q3  + 1.5*(q.spin_axis_q3-q.spin_axis_q1)
                THEN sh.spin_axis       END)                                           AS spin_axis_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.club_path       BETWEEN q.club_path_q1  - 1.5*(q.club_path_q3-q.club_path_q1)
                                               AND q.club_path_q3  + 1.5*(q.club_path_q3-q.club_path_q1)
                THEN sh.club_path       END)                                           AS club_path_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.attack_angle    BETWEEN q.attack_q1     - 1.5*(q.attack_q3-q.attack_q1)
                                               AND q.attack_q3     + 1.5*(q.attack_q3-q.attack_q1)
                THEN sh.attack_angle    END)                                           AS attack_angle_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.launch_direction BETWEEN q.launch_dir_q1 - 1.5*(q.launch_dir_q3-q.launch_dir_q1)
                                                AND q.launch_dir_q3 + 1.5*(q.launch_dir_q3-q.launch_dir_q1)
                THEN sh.launch_direction END)                                          AS launch_direction_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.apex             BETWEEN q.apex_q1       - 1.5*(q.apex_q3-q.apex_q1)
                                                AND q.apex_q3       + 1.5*(q.apex_q3-q.apex_q1)
                THEN sh.apex            END)                                           AS apex_mean,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.carry_distance  BETWEEN q.carry_q1  - 1.5*(q.carry_q3-q.carry_q1)
                                               AND q.carry_q3  + 1.5*(q.carry_q3-q.carry_q1)
                THEN sh.carry_distance_adj END)                                        AS carry_mean_adj,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.total_distance  BETWEEN q.total_q1  - 1.5*(q.total_q3-q.total_q1)
                                               AND q.total_q3  + 1.5*(q.total_q3-q.total_q1)
                THEN sh.total_distance_adj END)                                        AS total_mean_adj,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.ball_speed      BETWEEN q.ball_speed_q1 - 1.5*(q.ball_speed_q3-q.ball_speed_q1)
                                               AND q.ball_speed_q3 + 1.5*(q.ball_speed_q3-q.ball_speed_q1)
                THEN sh.ball_speed_adj END)                                            AS ball_speed_mean_adj,
            AVG(CASE WHEN q.shot_count < 8
                     OR sh.club_speed      BETWEEN q.club_speed_q1 - 1.5*(q.club_speed_q3-q.club_speed_q1)
                                               AND q.club_speed_q3 + 1.5*(q.club_speed_q3-q.club_speed_q1)
                THEN sh.club_speed_adj END)                                            AS club_speed_mean_adj
        FROM shots sh
        JOIN sessions s ON s.session_id = sh.session_id
        JOIN iqr q ON q.club = sh.club AND q.club_type = sh.club_type
        WHERE {where}
        GROUP BY sh.club, sh.club_type, q.shot_count
        ORDER BY AVG(sh.carry_distance) DESC NULLS LAST
        """,
        params * 2,
    ).fetchall()

    cols = [
        "club", "club_type", "shot_count", "carry_mean", "carry_std",
        "total_mean", "total_std",
        "ball_speed_mean", "spin_rate_mean", "smash_factor_mean",
        "side_carry_mean", "side_carry_std", "launch_angle_mean", "club_speed_mean",
        "spin_axis_mean", "club_path_mean", "attack_angle_mean",
        "launch_direction_mean", "apex_mean",
        "carry_mean_adj", "total_mean_adj", "ball_speed_mean_adj", "club_speed_mean_adj",
    ]
    return [ClubStats(**dict(zip(cols, r))) for r in rows]


@router.get("/club/{club_type}/trend")
def club_trend(
    club_type: str,
    metric: str = "carry_distance",
    include_outliers: bool = False,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    disabled_clubs: Optional[str] = None,
):
    allowed = {
        "carry_distance", "total_distance", "ball_speed", "launch_angle",
        "spin_rate", "spin_axis", "smash_factor", "side_carry", "apex",
        "descent_angle", "club_speed", "attack_angle", "club_path", "launch_direction",
    }
    if metric not in allowed:
        from fastapi import HTTPException
        raise HTTPException(400, f"metric must be one of {sorted(allowed)}")

    conn = get_conn()
    conditions = ["sh.club_type = ?"]
    params: list = [club_type]

    if not include_outliers:
        conditions.append("sh.is_outlier = false")
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

    where = " AND ".join(conditions)
    rows = conn.execute(
        f"""
        SELECT
            s.session_date,
            s.session_id,
            AVG(sh.{metric}) AS mean_val,
            STDDEV(sh.{metric}) AS std_val,
            COUNT(*) AS shot_count
        FROM shots sh
        JOIN sessions s ON s.session_id = sh.session_id
        WHERE {where}
        GROUP BY s.session_date, s.session_id
        ORDER BY s.session_date
        """,
        params,
    ).fetchall()

    return [
        {
            "session_date": r[0].isoformat() if r[0] else None,
            "session_id": r[1],
            "mean": round(r[2], 2) if r[2] is not None else None,
            "std": round(r[3], 2) if r[3] is not None else None,
            "shot_count": r[4],
        }
        for r in rows
    ]


@router.get("/clubs/list")
def list_clubs():
    conn = get_conn()
    rows = conn.execute(
        "SELECT DISTINCT club, club_type FROM shots WHERE club IS NOT NULL ORDER BY club"
    ).fetchall()

    return [{"club": r[0], "club_type": r[1]} for r in rows]
