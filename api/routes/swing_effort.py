from __future__ import annotations

from collections import defaultdict
from typing import Optional

import jenkspy
from fastapi import APIRouter, HTTPException

from api.corrections import _carry_mult, _pct_club

router = APIRouter(prefix="/swing-effort", tags=["swing-effort"])

MIN_SHOTS = 20
MAX_BUCKETS = 8
MIN_BUCKETS = 2
GVF_TARGET = 0.90        # use smallest k where GVF reaches this threshold
MAX_TOP_BUCKET_WIDTH = 8.0  # mph — keep increasing k until full-effort bucket is this narrow


# ── Jenks helpers ─────────────────────────────────────────────────────────────

def _gvf(data: list, breaks: list) -> float:
    """Goodness-of-Variance Fit: fraction of total variance explained by the classification."""
    mean = sum(data) / len(data)
    sdam = sum((x - mean) ** 2 for x in data)
    if sdam == 0:
        return 1.0
    sdcm = 0.0
    k = len(breaks) - 1
    for i in range(k):
        lo = breaks[i]
        hi = breaks[i + 1]
        cluster = [x for x in data if (lo <= x <= hi if i == 0 else lo < x <= hi)]
        if cluster:
            cm = sum(cluster) / len(cluster)
            sdcm += sum((x - cm) ** 2 for x in cluster)
    return 1.0 - sdcm / sdam


def _best_breaks(speeds: list) -> list:
    """Return jenks breaks. Increases k until both GVF >= GVF_TARGET and the top bucket
    is narrow enough (≤ MAX_TOP_BUCKET_WIDTH mph). Caps at MAX_BUCKETS."""
    unique_count = len(set(speeds))
    k_max = min(MAX_BUCKETS, unique_count)
    best_breaks = jenkspy.jenks_breaks(speeds, min(MIN_BUCKETS, k_max))
    for k in range(MIN_BUCKETS, k_max + 1):
        breaks = jenkspy.jenks_breaks(speeds, k)
        best_breaks = breaks
        top_width = breaks[-1] - breaks[-2]
        if _gvf(speeds, breaks) >= GVF_TARGET and top_width <= MAX_TOP_BUCKET_WIDTH:
            break
    return [float(b) for b in best_breaks]


def _classify(club_speed: float, breaks: list) -> str:
    """Return 1-based bucket index string. Bucket N = highest speed = full effort."""
    k = len(breaks) - 1
    for i in range(k - 1, 0, -1):
        if club_speed > breaks[i]:
            return str(i + 1)
    return "1"


def _make_label(rank: int, total: int, lo: float, hi: Optional[float]) -> str:
    """rank=1 is highest speed (full effort); total is the number of buckets."""
    speed_range = f"{round(lo)}+" if hi is None else f"{round(lo)}-{round(hi)}"
    if rank == 1:
        return f"Full Effort - E1 ({speed_range})"
    return f"E{rank} ({speed_range})"


# ── Schema migration ──────────────────────────────────────────────────────────

def _ensure_schema(conn) -> bool:
    """Create new narrow-schema thresholds table, migrating from old wide schema if present.
    Returns True if old data was wiped (caller should remind user to recalibrate)."""
    wiped = False
    try:
        old_cols = {r[0] for r in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'swing_effort_thresholds'"
        ).fetchall()}
        if "full_speed" in old_cols:
            conn.execute("DROP TABLE swing_effort_thresholds")
            conn.execute("UPDATE shots SET swing_effort = NULL")
            wiped = True
    except Exception:
        pass

    conn.execute("""
        CREATE TABLE IF NOT EXISTS swing_effort_thresholds (
            club_type    TEXT NOT NULL,
            bucket_index INTEGER NOT NULL,
            lower_bound  DOUBLE NOT NULL,
            upper_bound  DOUBLE,
            label        TEXT NOT NULL,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (club_type, bucket_index)
        )
    """)
    conn.execute("ALTER TABLE shots ADD COLUMN IF NOT EXISTS swing_effort TEXT")
    return wiped


# ── Calibration ───────────────────────────────────────────────────────────────

def _calibrate_club(conn, club_type_val: str) -> dict:
    speeds = [r[0] for r in conn.execute(
        "SELECT club_speed FROM shots WHERE club_type = ? AND club_speed IS NOT NULL AND is_outlier = false ORDER BY club_speed",
        [club_type_val],
    ).fetchall()]
    n = len(speeds)
    if n < MIN_SHOTS:
        return {}

    breaks = _best_breaks(speeds)
    k = len(breaks) - 1

    conn.execute("DELETE FROM swing_effort_thresholds WHERE club_type = ?", [club_type_val])
    for i in range(1, k + 1):
        lo = breaks[i - 1]
        hi = breaks[i] if i < k else None
        rank = k - i + 1  # rank 1 = highest speed = full effort
        label = _make_label(rank, k, lo, hi)
        conn.execute(
            "INSERT INTO swing_effort_thresholds (club_type, bucket_index, lower_bound, upper_bound, label, updated_at) VALUES (?, ?, ?, ?, ?, now())",
            [club_type_val, i, lo, hi, label],
        )

    shots = conn.execute(
        "SELECT shot_id, club_speed FROM shots WHERE club_type = ? AND club_speed IS NOT NULL",
        [club_type_val],
    ).fetchall()
    for shot_id, cs in shots:
        conn.execute("UPDATE shots SET swing_effort = ? WHERE shot_id = ?", [_classify(cs, breaks), shot_id])
    conn.execute(
        "UPDATE shots SET swing_effort = 'unknown' WHERE club_type = ? AND club_speed IS NULL",
        [club_type_val],
    )

    return {
        "club_type": club_type_val,
        "shot_count": n,
        "k": k,
        "gvf": round(_gvf(speeds, breaks), 4),
        "breaks": [round(b, 1) for b in breaks],
    }


@router.post("/calibrate")
def calibrate(club_type: Optional[str] = None):
    """Recompute Jenks breaks for all club types (or one) and reclassify shots."""
    from api.db import get_conn
    conn = get_conn()
    _ensure_schema(conn)

    if club_type:
        eligible = [club_type]
    else:
        eligible = [r[0] for r in conn.execute(
            f"SELECT club_type FROM shots WHERE club_type IS NOT NULL AND club_speed IS NOT NULL AND is_outlier = false GROUP BY club_type HAVING COUNT(*) >= {MIN_SHOTS}"
        ).fetchall()]

    updated = [r for ct in eligible if (r := _calibrate_club(conn, ct))]
    return {"calibrated": updated}


# ── Manual threshold override ─────────────────────────────────────────────────

@router.patch("/thresholds/{club_type}")
def update_thresholds(club_type: str, body: dict):
    """Override bucket boundaries. body: {"boundaries": [b1, b2, ...]} — internal break points (excludes min/max)."""
    from api.db import get_conn
    conn = get_conn()

    row = conn.execute(
        "SELECT MIN(club_speed), MAX(club_speed) FROM shots WHERE club_type = ? AND club_speed IS NOT NULL AND is_outlier = false",
        [club_type],
    ).fetchone()
    if not row or row[0] is None:
        raise HTTPException(404, f"No speed data for {club_type}")

    min_spd, max_spd = row[0], row[1]
    internal = sorted(float(b) for b in body["boundaries"])
    breaks = [min_spd] + internal + [max_spd]

    for i in range(len(breaks) - 1):
        if breaks[i] >= breaks[i + 1]:
            raise HTTPException(400, "Boundaries must be strictly increasing within the data range")

    k = len(breaks) - 1
    conn.execute("DELETE FROM swing_effort_thresholds WHERE club_type = ?", [club_type])
    for i in range(1, k + 1):
        lo = breaks[i - 1]
        hi = breaks[i] if i < k else None
        rank = k - i + 1
        conn.execute(
            "INSERT INTO swing_effort_thresholds (club_type, bucket_index, lower_bound, upper_bound, label, updated_at) VALUES (?, ?, ?, ?, ?, now())",
            [club_type, i, lo, hi, _make_label(rank, k, lo, hi)],
        )

    shots = conn.execute(
        "SELECT shot_id, club_speed FROM shots WHERE club_type = ? AND club_speed IS NOT NULL",
        [club_type],
    ).fetchall()
    for shot_id, cs in shots:
        conn.execute("UPDATE shots SET swing_effort = ? WHERE shot_id = ?", [_classify(cs, breaks), shot_id])

    return {"ok": True}


# ── Read endpoints ────────────────────────────────────────────────────────────

@router.get("/thresholds")
def get_thresholds(disabled_clubs: Optional[str] = None):
    """Return current thresholds for all club types grouped by club_type."""
    from api.db import get_conn
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT club_type, bucket_index, lower_bound, upper_bound, label, updated_at FROM swing_effort_thresholds ORDER BY club_type, bucket_index"
        ).fetchall()
    except Exception:
        return []

    shot_conditions = ["is_outlier = false", "club_type IS NOT NULL"]
    shot_params: list = []
    if disabled_clubs:
        pairs = [c.strip() for c in disabled_clubs.split(",") if c.strip() and "|" in c]
        if pairs:
            placeholders = ",".join("?" * len(pairs))
            shot_conditions.append(f"(club_type || '|' || club) NOT IN ({placeholders})")
            shot_params.extend(pairs)
    where = " AND ".join(shot_conditions)
    live_counts = {r[0]: r[1] for r in conn.execute(
        f"SELECT club_type, COUNT(*) FROM shots WHERE {where} GROUP BY club_type", shot_params
    ).fetchall()}

    by_club: dict = defaultdict(list)
    updated_at_by_club: dict = {}
    for club_type, bi, lo, hi, label, updated_at in rows:
        by_club[club_type].append({"bucket_index": bi, "lower_bound": lo, "upper_bound": hi, "label": label})
        updated_at_by_club[club_type] = updated_at

    result = []
    for club_type, buckets in by_club.items():
        result.append({
            "club_type": club_type,
            "buckets": buckets,
            "shot_count": live_counts.get(club_type, 0),
            "updated_at": updated_at_by_club[club_type],
        })
    return sorted(result, key=lambda r: -(r["buckets"][-1]["lower_bound"] if r["buckets"] else 0))


@router.get("/histogram/{club_type}")
def speed_histogram(club_type: str, disabled_clubs: Optional[str] = None):
    """Return club_speed histogram data for a club type using 2 mph bins."""
    from api.db import get_conn
    conn = get_conn()

    conditions = ["club_type = ?", "club_speed IS NOT NULL", "is_outlier = false"]
    params: list = [club_type]
    if disabled_clubs:
        pairs = [c.strip() for c in disabled_clubs.split(",") if c.strip() and "|" in c]
        if pairs:
            placeholders = ",".join("?" * len(pairs))
            conditions.append(f"(club_type || '|' || club) NOT IN ({placeholders})")
            params.extend(pairs)
    where = " AND ".join(conditions)

    shots = conn.execute(
        f"SELECT club_speed, carry_distance, apex, side_carry, total_distance FROM shots WHERE {where} ORDER BY club_speed",
        params,
    ).fetchall()
    if not shots:
        return {"bins": [], "thresholds": None}

    speeds = [r[0] for r in shots]
    min_s, max_s = min(speeds), max(speeds)
    BIN_WIDTH = 2
    lo_start = int(min_s // BIN_WIDTH) * BIN_WIDTH

    histogram = []
    lo = lo_start
    while lo <= max_s:
        hi = lo + BIN_WIDTH
        bin_shots = [r for r in shots if lo <= r[0] < hi]
        carries = [r[1] for r in bin_shots if r[1] is not None]
        apexes  = [r[2] for r in bin_shots if r[2] is not None]
        sides   = [r[3] for r in bin_shots if r[3] is not None]
        totals  = [r[4] for r in bin_shots if r[4] is not None]
        histogram.append({
            "lo": lo, "hi": hi, "count": len(bin_shots),
            "carry":          round(sum(carries) / len(carries), 1) if carries else None,
            "apex":           round(sum(apexes)  / len(apexes),  1) if apexes  else None,
            "side_carry":     round(sum(sides)   / len(sides),   1) if sides   else None,
            "total_distance": round(sum(totals)  / len(totals),  1) if totals  else None,
        })
        lo += BIN_WIDTH

    cm = _carry_mult(club_type)
    for bin_ in histogram:
        if bin_["carry"] is not None:
            bin_["carry"] = round(bin_["carry"] * cm, 1)
        if bin_["total_distance"] is not None:
            bin_["total_distance"] = round(bin_["total_distance"] * cm, 1)

    try:
        threshold_rows = conn.execute(
            "SELECT bucket_index, lower_bound, upper_bound, label FROM swing_effort_thresholds WHERE club_type = ? ORDER BY bucket_index",
            [club_type],
        ).fetchall()
        thresholds = [{"bucket_index": r[0], "lower_bound": r[1], "upper_bound": r[2], "label": r[3]} for r in threshold_rows] or None
    except Exception:
        thresholds = None

    return {"bins": histogram, "thresholds": thresholds, "total": len(speeds)}


@router.get("/matrix")
def wedge_matrix(
    club_types: Optional[str] = None,
    all_clubs: bool = False,
    include_outliers: bool = False,
    disabled_clubs: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit_sessions: Optional[int] = None,
):
    """Returns carry stats per club_type × swing_effort bucket."""
    from api.db import get_conn
    conn = get_conn()

    default_wedges = {"lw", "sw", "gw", "pw", "aw", "w"}
    if all_clubs:
        target_types = set()
    elif club_types:
        target_types = set(club_types.split(","))
    else:
        existing = {r[0] for r in conn.execute("SELECT DISTINCT club_type FROM shots WHERE club_type IS NOT NULL").fetchall()}
        target_types = existing & default_wedges

    conditions = ["s.club_type IS NOT NULL", "s.swing_effort IS NOT NULL", "s.carry_distance IS NOT NULL"]
    if not include_outliers:
        conditions.append("s.is_outlier = false")
    if target_types:
        placeholders = ",".join("?" * len(target_types))
        conditions.append(f"s.club_type IN ({placeholders})")

    params = list(target_types)
    if disabled_clubs:
        pairs = [c.strip() for c in disabled_clubs.split(",") if c.strip() and "|" in c]
        if pairs:
            placeholders = ",".join("?" * len(pairs))
            conditions.append(f"(s.club_type || '|' || s.club) NOT IN ({placeholders})")
            params.extend(pairs)
    if date_from:
        conditions.append("sess.session_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("sess.session_date <= ?")
        params.append(date_to)
    if limit_sessions:
        conditions.append(f"s.session_id IN (SELECT session_id FROM sessions ORDER BY session_date DESC LIMIT {limit_sessions})")

    needs_session_join = date_from is not None or date_to is not None
    session_join = "JOIN sessions sess ON sess.session_id = s.session_id" if needs_session_join else ""

    where = " AND ".join(conditions)
    rows = conn.execute(f"""
        SELECT
            s.club_type,
            s.club,
            s.swing_effort,
            MAX(t.label) AS bucket_label,
            COUNT(*) AS n,
            AVG(s.carry_distance)    AS carry_mean,
            STDDEV(s.carry_distance) AS carry_std,
            AVG(s.total_distance)    AS total_mean,
            STDDEV(s.side_carry)     AS side_carry_std,
            AVG(s.apex)              AS apex_mean,
            AVG(s.club_speed)        AS speed_mean,
            AVG(s.ball_speed)        AS ball_speed_mean,
            AVG(s.spin_rate)         AS spin_rate_mean,
            AVG(s.smash_factor)      AS smash_factor_mean,
            AVG(s.attack_angle)      AS attack_angle_mean
        FROM shots s
        {session_join}
        LEFT JOIN swing_effort_thresholds t
            ON t.club_type = s.club_type AND CAST(t.bucket_index AS VARCHAR) = s.swing_effort
        WHERE {where}
        GROUP BY s.club_type, s.club, s.swing_effort
        ORDER BY AVG(s.carry_distance) DESC NULLS LAST
    """, params).fetchall()

    bucket_groups: dict = defaultdict(list)
    first_club_for_type: dict = {}

    for club_type, club, effort, bucket_label, n, carry_mean, carry_std, total_mean, side_carry_std, apex_mean, speed_mean, ball_speed_mean, spin_rate_mean, smash_factor_mean, attack_angle_mean in rows:
        if club_type not in first_club_for_type:
            first_club_for_type[club_type] = club
        bucket_groups[(club_type, effort)].append({
            "n": n, "label": bucket_label,
            "carry_mean": carry_mean, "carry_std": carry_std,
            "total_mean": total_mean, "side_carry_std": side_carry_std,
            "apex_mean": apex_mean, "speed_mean": speed_mean, "ball_speed_mean": ball_speed_mean,
            "spin_rate_mean": spin_rate_mean, "smash_factor_mean": smash_factor_mean,
            "attack_angle_mean": attack_angle_mean,
        })

    def _wavg(bucket_rows: list, key: str):
        pairs = [(r[key], r["n"]) for r in bucket_rows if r[key] is not None]
        if not pairs:
            return None
        total = sum(w for _, w in pairs)
        return sum(v * w for v, w in pairs) / total if total else None

    matrix: dict = {}
    for (club_type, effort), bucket_rows in bucket_groups.items():
        if club_type not in matrix:
            matrix[club_type] = {"club_type": club_type, "club": first_club_for_type[club_type], "buckets": {}}
        total_n = sum(r["n"] for r in bucket_rows)
        label = next((r["label"] for r in bucket_rows if r["label"]), effort)
        cm = _wavg(bucket_rows, "carry_mean")
        matrix[club_type]["buckets"][effort] = {
            "n": total_n,
            "label": label,
            "carry_mean":        round(cm, 1) if cm is not None else None,
            "carry_std":         round(_wavg(bucket_rows, "carry_std"), 1)         if _wavg(bucket_rows, "carry_std") is not None else None,
            "total_mean":        round(_wavg(bucket_rows, "total_mean"), 1)         if _wavg(bucket_rows, "total_mean") is not None else None,
            "side_carry_std":    round(_wavg(bucket_rows, "side_carry_std"), 1)     if _wavg(bucket_rows, "side_carry_std") is not None else None,
            "apex_mean":         round(_wavg(bucket_rows, "apex_mean"), 1)          if _wavg(bucket_rows, "apex_mean") is not None else None,
            "speed_mean":        round(_wavg(bucket_rows, "speed_mean"), 1)         if _wavg(bucket_rows, "speed_mean") is not None else None,
            "ball_speed_mean":   round(_wavg(bucket_rows, "ball_speed_mean"), 1)    if _wavg(bucket_rows, "ball_speed_mean") is not None else None,
            "spin_rate_mean":    round(_wavg(bucket_rows, "spin_rate_mean"), 0)     if _wavg(bucket_rows, "spin_rate_mean") is not None else None,
            "smash_factor_mean": round(_wavg(bucket_rows, "smash_factor_mean"), 2)  if _wavg(bucket_rows, "smash_factor_mean") is not None else None,
            "attack_angle_mean": round(_wavg(bucket_rows, "attack_angle_mean"), 1)  if _wavg(bucket_rows, "attack_angle_mean") is not None else None,
        }

    # Apply speed corrections to matrix bucket values.
    for club_type, club_data in matrix.items():
        cm = _carry_mult(club_type)
        pc = _pct_club(club_type)
        for effort, bucket in club_data["buckets"].items():
            if bucket["carry_mean"] is not None:
                bucket["carry_mean"] = round(bucket["carry_mean"] * cm, 1)
            if bucket["total_mean"] is not None:
                bucket["total_mean"] = round(bucket["total_mean"] * cm, 1)
            if bucket["speed_mean"] is not None:
                bucket["speed_mean"] = round(bucket["speed_mean"] * (1 + pc), 1)

    # Rekey each club's buckets by effort rank (rank 1 = full effort = highest raw bucket_index).
    # This aligns "Full Effort" to key "1" across all clubs regardless of their total bucket count.
    for club_data in matrix.values():
        raw = club_data["buckets"]
        numeric = {k: v for k, v in raw.items() if k != "unknown"}
        if not numeric:
            continue
        max_idx = max(int(k) for k in numeric)
        club_data["buckets"] = {str(max_idx - int(k) + 1): v for k, v in numeric.items()}

    return list(matrix.values())
