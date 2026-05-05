import json
import duckdb
from fastapi import APIRouter, UploadFile, File, HTTPException
from api.db import get_conn

router = APIRouter(prefix="/golf-tracker", tags=["golf-tracker"])

# ── Schema ─────────────────────────────────────────────────────────────────────

DROP_ORDER = [
    "gt_penalties", "gt_putts", "gt_shots",
    "gt_hole_stats", "gt_rounds", "gt_holes",
    "gt_tee_sets", "gt_courses",
]

CREATE_SQL = """
CREATE TABLE gt_courses (
    id INTEGER PRIMARY KEY,
    name VARCHAR, city VARCHAR, state VARCHAR, hole_count INTEGER
);
CREATE TABLE gt_tee_sets (
    id INTEGER PRIMARY KEY,
    course_id INTEGER, name VARCHAR, rating DOUBLE, slope INTEGER
);
CREATE TABLE gt_holes (
    id INTEGER PRIMARY KEY,
    course_id INTEGER, hole_number INTEGER, par INTEGER,
    handicap_index INTEGER,
    tee_lat DOUBLE, tee_lng DOUBLE, green_lat DOUBLE, green_lng DOUBLE
);
CREATE TABLE gt_rounds (
    id INTEGER PRIMARY KEY,
    course_id INTEGER, tee_set_id INTEGER,
    date VARCHAR, is_finalized BOOLEAN, is_practice BOOLEAN,
    notes VARCHAR, start_hole INTEGER, total_holes INTEGER
);
CREATE TABLE gt_hole_stats (
    id INTEGER PRIMARY KEY,
    round_id INTEGER, hole_id INTEGER,
    score INTEGER, score_manual BOOLEAN, is_scored BOOLEAN,
    putts INTEGER, chips INTEGER, sand_shots INTEGER,
    gir BOOLEAN, near_gir BOOLEAN, gir_override BOOLEAN,
    approach_mishit BOOLEAN, recovery_chip BOOLEAN,
    adjusted_yardage INTEGER, chip_distance INTEGER, chip_lie VARCHAR,
    tee_club_id INTEGER, tee_shot_distance INTEGER, tee_outcome VARCHAR,
    tee_mishit BOOLEAN, tee_in_trouble BOOLEAN,
    tee_lat DOUBLE, tee_lng DOUBLE,
    tee_dispersion_left INTEGER, tee_dispersion_right INTEGER,
    tee_dispersion_long INTEGER, tee_dispersion_short INTEGER,
    sg_approach DOUBLE, sg_around_green DOUBLE,
    sg_off_tee DOUBLE, sg_off_tee_expected DOUBLE,
    sg_putting DOUBLE, strokes_gained DOUBLE, difficulty_adjustment DOUBLE
);
CREATE TABLE gt_shots (
    id INTEGER PRIMARY KEY,
    hole_stat_id INTEGER, shot_number INTEGER, club_id INTEGER,
    distance_to_pin INTEGER, distance_traveled INTEGER,
    lie VARCHAR, outcome VARCHAR,
    is_mishit BOOLEAN, is_recovery BOOLEAN,
    strokes_gained DOUBLE, penalty_attribution DOUBLE,
    start_lat DOUBLE, start_lng DOUBLE,
    target_lat DOUBLE, target_lng DOUBLE,
    dispersion_left INTEGER, dispersion_right INTEGER,
    dispersion_long INTEGER, dispersion_short INTEGER
);
CREATE TABLE gt_putts (
    id INTEGER PRIMARY KEY,
    hole_stat_id INTEGER, putt_number INTEGER,
    distance DOUBLE, made BOOLEAN, strokes_gained DOUBLE,
    break_direction VARCHAR, direction_miss VARCHAR,
    pace_miss VARCHAR, slope_direction VARCHAR
);
CREATE TABLE gt_penalties (
    id INTEGER PRIMARY KEY,
    hole_stat_id INTEGER, shot_number INTEGER, strokes INTEGER, type VARCHAR
);
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _g(d: dict, *keys, default=None):
    """Safe nested get."""
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, default)
    return d


def _ingest(conn: duckdb.DuckDBPyConnection, data: list) -> dict:
    seen_courses: set = set()
    seen_tee_sets: set = set()
    seen_holes: set = set()

    total_holes = 0
    total_shots = 0
    total_putts = 0

    for entry in data:
        course = entry.get("course", {})
        tee_set = entry.get("teeSet", {})
        rnd = entry.get("round", {})

        # ── Course ──
        cid = course.get("id")
        if cid and cid not in seen_courses:
            seen_courses.add(cid)
            conn.execute(
                "INSERT INTO gt_courses VALUES (?,?,?,?,?)",
                [cid, course.get("name"), course.get("city"),
                 course.get("state"), course.get("holeCount")],
            )

        # ── Tee set ──
        tsid = tee_set.get("id")
        if tsid and tsid not in seen_tee_sets:
            seen_tee_sets.add(tsid)
            conn.execute(
                "INSERT INTO gt_tee_sets VALUES (?,?,?,?,?)",
                [tsid, tee_set.get("courseId"), tee_set.get("name"),
                 tee_set.get("rating"), tee_set.get("slope")],
            )

        # ── Round ──
        rid = rnd.get("id")
        conn.execute(
            "INSERT INTO gt_rounds VALUES (?,?,?,?,?,?,?,?,?)",
            [rid, rnd.get("courseId"), rnd.get("teeSetId"),
             rnd.get("date"), rnd.get("isFinalized"), rnd.get("isPractice"),
             rnd.get("notes", ""), rnd.get("startHole"), rnd.get("totalHoles")],
        )

        # ── Holes + hole stats ──
        for hs_entry in entry.get("holeStats", []):
            hole = hs_entry.get("hole", {})
            hs = hs_entry.get("holeStat", {})

            # Hole (deduplicated across rounds)
            hid = hole.get("id")
            if hid and hid not in seen_holes:
                seen_holes.add(hid)
                conn.execute(
                    "INSERT INTO gt_holes VALUES (?,?,?,?,?,?,?,?,?)",
                    [hid, hole.get("courseId"), hole.get("holeNumber"),
                     hole.get("par"), hole.get("handicapIndex"),
                     hole.get("teeLat"), hole.get("teeLng"),
                     hole.get("greenLat"), hole.get("greenLng")],
                )

            hsid = hs.get("id")
            conn.execute(
                """INSERT INTO gt_hole_stats VALUES
                (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    hsid, rid, hid,
                    hs.get("score"), hs.get("scoreManual"), hs.get("isScored"),
                    hs.get("putts"), hs.get("chips"), hs.get("sandShots"),
                    hs.get("gir"), hs.get("nearGir"), hs.get("girOverride"),
                    hs.get("approachMishit"), hs.get("recoveryChip"),
                    hs.get("adjustedYardage"), hs.get("chipDistance"), hs.get("chipLie"),
                    hs.get("teeClubId"), hs.get("teeShotDistance"), hs.get("teeOutcome"),
                    hs.get("teeMishit"), hs.get("teeInTrouble"),
                    hs.get("teeLat"), hs.get("teeLng"),
                    hs.get("teeDispersionLeft"), hs.get("teeDispersionRight"),
                    hs.get("teeDispersionLong"), hs.get("teeDispersionShort"),
                    hs.get("sgApproach"), hs.get("sgAroundGreen"),
                    hs.get("sgOffTee"), hs.get("sgOffTeeExpected"),
                    hs.get("sgPutting"), hs.get("strokesGained"),
                    hs.get("difficultyAdjustment"),
                ],
            )
            total_holes += 1

            # Shots
            for shot in hs_entry.get("shots", []):
                conn.execute(
                    """INSERT INTO gt_shots VALUES
                    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    [
                        shot.get("id"), hsid, shot.get("shotNumber"),
                        shot.get("clubId"),
                        shot.get("distanceToPin"), shot.get("distanceTraveled"),
                        shot.get("lie"), shot.get("outcome"),
                        shot.get("isMishit"), shot.get("isRecovery"),
                        shot.get("strokesGained"), shot.get("penaltyAttribution"),
                        shot.get("startLat"), shot.get("startLng"),
                        shot.get("targetLat"), shot.get("targetLng"),
                        shot.get("dispersionLeft"), shot.get("dispersionRight"),
                        shot.get("dispersionLong"), shot.get("dispersionShort"),
                    ],
                )
                total_shots += 1

            # Putts
            for putt in hs_entry.get("putts", []):
                conn.execute(
                    "INSERT INTO gt_putts VALUES (?,?,?,?,?,?,?,?,?,?)",
                    [
                        putt.get("id"), hsid, putt.get("puttNumber"),
                        putt.get("distance"), putt.get("made"),
                        putt.get("strokesGained"),
                        putt.get("breakDirection"), putt.get("directionMiss"),
                        putt.get("paceMiss"), putt.get("slopeDirection"),
                    ],
                )
                total_putts += 1

            # Penalties
            for pen in hs_entry.get("penalties", []):
                conn.execute(
                    "INSERT INTO gt_penalties VALUES (?,?,?,?,?)",
                    [pen.get("id"), hsid, pen.get("shotNumber"),
                     pen.get("strokes"), pen.get("type")],
                )

    return {
        "rounds": len(data),
        "holes": total_holes,
        "shots": total_shots,
        "putts": total_putts,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/ingest")
async def ingest(file: UploadFile = File(...)):
    if not file.filename.endswith(".json"):
        raise HTTPException(400, "Expected a .json file")

    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid JSON: {e}")

    if not isinstance(data, list):
        raise HTTPException(400, "Expected a JSON array of rounds")

    conn = get_conn()
    try:
        for table in DROP_ORDER:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
        for stmt in CREATE_SQL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                conn.execute(stmt)
        counts = _ingest(conn, data)
    except Exception as e:
        raise HTTPException(500, str(e))

    return {"ok": True, **counts}


@router.get("/rounds")
def list_rounds():
    conn = get_conn()
    tables = {r[0] for r in conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'gt_%'"
    ).fetchall()}
    if "gt_rounds" not in tables:
        return []

    rows = conn.execute("""
        SELECT
            r.id, r.date, r.is_practice, r.total_holes, r.notes,
            c.name, c.city, c.state,
            ts.name AS tee_name, ts.rating, ts.slope,
            SUM(CASE WHEN hs.is_scored THEN hs.score ELSE 0 END) AS total_score,
            SUM(CASE WHEN hs.is_scored THEN h.par ELSE 0 END) AS total_par,
            SUM(CASE WHEN hs.is_scored THEN hs.putts ELSE 0 END) AS total_putts,
            SUM(hs.sg_off_tee) AS sg_off_tee,
            SUM(hs.sg_approach) AS sg_approach,
            SUM(hs.sg_around_green) AS sg_around_green,
            SUM(hs.sg_putting) AS sg_putting,
            SUM(hs.strokes_gained) AS strokes_gained
        FROM gt_rounds r
        JOIN gt_courses c ON c.id = r.course_id
        JOIN gt_tee_sets ts ON ts.id = r.tee_set_id
        JOIN gt_hole_stats hs ON hs.round_id = r.id
        JOIN gt_holes h ON h.id = hs.hole_id
        GROUP BY r.id, r.date, r.is_practice, r.total_holes, r.notes,
                 c.name, c.city, c.state, ts.name, ts.rating, ts.slope
        ORDER BY r.date DESC
    """).fetchall()

    cols = [
        "id", "date", "is_practice", "total_holes", "notes",
        "course_name", "course_city", "course_state",
        "tee_name", "rating", "slope",
        "total_score", "total_par", "total_putts",
        "sg_off_tee", "sg_approach", "sg_around_green", "sg_putting", "strokes_gained",
    ]

    def fmt_sg(v):
        return round(v, 3) if v is not None else None

    result = []
    for r in rows:
        d = dict(zip(cols, r))
        for k in ["sg_off_tee", "sg_approach", "sg_around_green", "sg_putting", "strokes_gained"]:
            d[k] = fmt_sg(d[k])
        result.append(d)
    return result


@router.get("/rounds/{round_id}")
def get_round(round_id: int):
    conn = get_conn()

    rnd = conn.execute("""
        SELECT r.id, r.date, r.is_practice, r.total_holes, r.notes,
               c.name, c.city, c.state,
               ts.name, ts.rating, ts.slope
        FROM gt_rounds r
        JOIN gt_courses c ON c.id = r.course_id
        JOIN gt_tee_sets ts ON ts.id = r.tee_set_id
        WHERE r.id = ?
    """, [round_id]).fetchone()

    if not rnd:
        raise HTTPException(404, "Round not found")

    round_info = {
        "id": rnd[0], "date": rnd[1], "is_practice": rnd[2],
        "total_holes": rnd[3], "notes": rnd[4],
        "course_name": rnd[5], "course_city": rnd[6], "course_state": rnd[7],
        "tee_name": rnd[8], "rating": rnd[9], "slope": rnd[10],
    }

    hole_rows = conn.execute("""
        SELECT
            h.hole_number, h.par, h.handicap_index,
            hs.id, hs.score, hs.is_scored, hs.putts, hs.chips, hs.sand_shots,
            hs.gir, hs.tee_shot_distance, hs.tee_outcome, hs.tee_mishit, hs.tee_in_trouble,
            hs.tee_club_id, hs.adjusted_yardage,
            hs.tee_dispersion_left, hs.tee_dispersion_right,
            hs.tee_dispersion_long, hs.tee_dispersion_short,
            hs.sg_off_tee, hs.sg_approach, hs.sg_around_green, hs.sg_putting, hs.strokes_gained,
            (SELECT COUNT(*) FROM gt_penalties p WHERE p.hole_stat_id = hs.id) AS penalties
        FROM gt_hole_stats hs
        JOIN gt_holes h ON h.id = hs.hole_id
        WHERE hs.round_id = ?
        ORDER BY h.hole_number
    """, [round_id]).fetchall()

    hole_cols = [
        "hole_number", "par", "handicap_index",
        "hole_stat_id", "score", "is_scored", "putts", "chips", "sand_shots",
        "gir", "tee_shot_distance", "tee_outcome", "tee_mishit", "tee_in_trouble",
        "tee_club_id", "adjusted_yardage",
        "tee_dispersion_left", "tee_dispersion_right",
        "tee_dispersion_long", "tee_dispersion_short",
        "sg_off_tee", "sg_approach", "sg_around_green", "sg_putting", "strokes_gained",
        "penalties",
    ]
    holes = [dict(zip(hole_cols, r)) for r in hole_rows]

    # Round the SG values
    sg_keys = ["sg_off_tee", "sg_approach", "sg_around_green", "sg_putting", "strokes_gained"]
    for h in holes:
        for k in sg_keys:
            if h[k] is not None:
                h[k] = round(h[k], 3)

    return {"round": round_info, "holes": holes}


@router.get("/shots")
def get_all_shots(club_id: int | None = None):
    """All on-course shots (approach + tee), optionally filtered by club_id, with dispersion data."""
    conn = get_conn()
    where_approach = "WHERE s.club_id = ?" if club_id is not None else ""
    where_tee = "WHERE hs.tee_club_id = ?" if club_id is not None else ""
    params = [club_id] if club_id is not None else []
    rows = conn.execute(f"""
        SELECT
            s.club_id, s.distance_to_pin, s.distance_traveled,
            s.lie, s.outcome, s.is_mishit,
            s.strokes_gained,
            s.dispersion_left, s.dispersion_right,
            s.dispersion_long, s.dispersion_short,
            r.date AS round_date, c.name AS course_name,
            h.hole_number
        FROM gt_shots s
        JOIN gt_hole_stats hs ON hs.id = s.hole_stat_id
        JOIN gt_rounds r ON r.id = hs.round_id
        JOIN gt_courses c ON c.id = r.course_id
        JOIN gt_holes h ON h.id = hs.hole_id
        WHERE s.is_recovery = false
        {'AND s.club_id = ?' if club_id is not None else ''}
        UNION ALL
        SELECT
            hs.tee_club_id AS club_id,
            NULL AS distance_to_pin,
            hs.tee_shot_distance AS distance_traveled,
            'tee' AS lie,
            hs.tee_outcome AS outcome,
            hs.tee_mishit AS is_mishit,
            hs.sg_off_tee AS strokes_gained,
            hs.tee_dispersion_left AS dispersion_left,
            hs.tee_dispersion_right AS dispersion_right,
            hs.tee_dispersion_long AS dispersion_long,
            hs.tee_dispersion_short AS dispersion_short,
            r.date AS round_date, c.name AS course_name,
            h.hole_number
        FROM gt_hole_stats hs
        JOIN gt_rounds r ON r.id = hs.round_id
        JOIN gt_courses c ON c.id = r.course_id
        JOIN gt_holes h ON h.id = hs.hole_id
        WHERE hs.tee_club_id IS NOT NULL
          AND (hs.tee_dispersion_left IS NOT NULL OR hs.tee_dispersion_right IS NOT NULL
               OR hs.tee_dispersion_long IS NOT NULL OR hs.tee_dispersion_short IS NOT NULL)
          {'AND hs.tee_club_id = ?' if club_id is not None else ''}
        ORDER BY club_id
    """, params + params).fetchall()
    cols = [
        "club_id", "distance_to_pin", "distance_traveled",
        "lie", "outcome", "is_mishit",
        "strokes_gained",
        "dispersion_left", "dispersion_right",
        "dispersion_long", "dispersion_short",
        "round_date", "course_name", "hole_number",
    ]
    return [dict(zip(cols, r)) for r in rows]


@router.get("/rounds/{round_id}/shots")
def get_round_shots(round_id: int):
    """Approach shots for a round — used for comparison with launch monitor."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            h.hole_number, s.shot_number, s.club_id,
            s.distance_to_pin, s.distance_traveled,
            s.lie, s.outcome, s.is_mishit, s.is_recovery,
            s.strokes_gained, s.dispersion_left, s.dispersion_right,
            s.dispersion_long, s.dispersion_short
        FROM gt_shots s
        JOIN gt_hole_stats hs ON hs.id = s.hole_stat_id
        JOIN gt_holes h ON h.id = hs.hole_id
        WHERE hs.round_id = ?
        ORDER BY h.hole_number, s.shot_number
    """, [round_id]).fetchall()
    cols = [
        "hole_number", "shot_number", "club_id",
        "distance_to_pin", "distance_traveled",
        "lie", "outcome", "is_mishit", "is_recovery",
        "strokes_gained", "dispersion_left", "dispersion_right",
        "dispersion_long", "dispersion_short",
    ]
    return [dict(zip(cols, r)) for r in rows]
