# Swing Effort Classification Design

## Problem

Partial swings — common with wedges but possible with any club — pollute aggregate statistics. A 60% gap wedge and a full gap wedge should not be averaged together. Currently the system has no way to distinguish them, making wedge gapping analysis unreliable and making a "wedge matrix by swing effort" impossible.

## Goal

1. Classify every shot into effort buckets based on club head speed.
2. Use those buckets to:
   - Power a **Wedge Matrix** showing carry distance by club × effort bucket.
   - Overlay effort-segmented carries on the **Club Gapping** chart for all clubs.
   - Show effort-specific dispersion ellipses on the **Club Dashboard**.

---

## Core Approach: Jenks Natural Breaks per Club Type

Swing effort is inferred from `club_speed` (mph). Buckets are derived using **Jenks Natural Breaks** — an algorithm that finds the partition that minimises within-class variance — rather than evenly-spaced thresholds. The number of buckets (`k`) is chosen adaptively per club type.

### Key constants (in `api/routes/swing_effort.py`)

| Constant              | Value  | Meaning                                                   |
|-----------------------|--------|-----------------------------------------------------------|
| `MIN_SHOTS`           | 20     | Minimum non-outlier shots required to calibrate a club type |
| `MIN_BUCKETS`         | 2      | Minimum k tried                                           |
| `MAX_BUCKETS`         | 8      | Maximum k tried                                           |
| `GVF_TARGET`          | 0.90   | Goodness-of-Variance Fit threshold — k increases until met |
| `MAX_TOP_BUCKET_WIDTH`| 8.0 mph| Also increase k if the top (full-effort) bucket spans > 8 mph |

### Bucket count selection

For each club type, Jenks breaks are computed starting at `k = MIN_BUCKETS`. `k` is incremented until **both** of the following are satisfied (or `MAX_BUCKETS` is reached):
1. GVF ≥ 0.90 (breaks explain ≥ 90% of total speed variance)
2. The top bucket (highest-speed cluster) spans ≤ 8 mph

The resulting number of buckets varies per club type based on how spread-out the speed data is.

### Bucket labels and rank

Buckets are numbered by **rank**, where **rank 1 = full effort (highest speed)**:

| Rank | Label format                     |
|------|----------------------------------|
| 1    | `Full Effort - E1 (lo-hi mph)`   |
| 2    | `E2 (lo-hi mph)`                 |
| 3    | `E3 (lo-hi mph)`                 |
| …    | …                                |

`lo` is the lower bound (mph), `hi` is the upper bound (mph, omitted for the top bucket which uses `lo+` format).

The `swing_effort` column on `shots` stores the **bucket_index** as a string (e.g., `"3"` for bucket 3, or `"unknown"` for NULL speeds). Bucket index is the raw Jenks bin (1 = lowest speed), so rank is derived as `max_bucket_index − bucket_index + 1`. The `/matrix` endpoint re-keys by rank before returning.

---

## Data Layer

### Column: `shots.swing_effort`

TEXT column. Values are numeric bucket_index strings (`"1"`, `"2"`, `"3"`, …) or `"unknown"`.

- **Bucket index increases with speed**: index 1 = lowest speed cluster, highest index = full effort.
- Shots where `club_speed IS NULL` → `"unknown"`.
- **Derived, not ingested** — computed after calibration; NULL until calibration is run.

### Threshold table: `swing_effort_thresholds`

One row per `(club_type, bucket_index)` pair:

```sql
CREATE TABLE IF NOT EXISTS swing_effort_thresholds (
    club_type    TEXT NOT NULL,
    bucket_index INTEGER NOT NULL,   -- 1 = lowest speed; max = full effort
    lower_bound  DOUBLE NOT NULL,    -- inclusive lower speed bound (mph)
    upper_bound  DOUBLE,             -- exclusive upper bound; NULL for top bucket
    label        TEXT NOT NULL,      -- e.g. "Full Effort - E1 (72-84)" or "E2 (68-71)"
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (club_type, bucket_index)
)
```

> **Schema migration note**: An older schema existed with a single wide row per club type (`anchor_speed`, `full_speed`, `pct75_speed`, etc.). The `_ensure_schema()` helper in `swing_effort.py` auto-detects and drops this old schema, wiping effort labels and requiring recalibration.

---

## Calibration Routine (`POST /swing-effort/calibrate`)

1. Query all non-outlier `club_speed` values for each club type with ≥ 20 shots.
2. Run `_best_breaks(speeds)` — finds the smallest `k` where GVF ≥ 0.90 and the top bucket spans ≤ 8 mph.
3. Delete existing threshold rows for that club type, then insert one row per bucket.
4. Reclassify all shots of that club type: update `swing_effort` to the bucket_index string; set `"unknown"` for NULL speeds.

Optional `?club_type=` param re-runs calibration for a single club only.

Response includes per-club: `shot_count`, `k`, `gvf`, `breaks` (the raw Jenks break points).

### Manual override (`PATCH /swing-effort/thresholds/{club_type}`)

Body: `{ "boundaries": [b1, b2, ...] }` — a list of internal break points (speeds in mph), **excluding** the data min and max which are added automatically.

The endpoint:
1. Fetches `MIN(club_speed)` and `MAX(club_speed)` for the club type.
2. Assembles `breaks = [min_spd] + sorted(boundaries) + [max_spd]`.
3. Validates that breaks are strictly increasing.
4. Writes updated threshold rows and immediately reclassifies all shots.

---

## API

### `GET /swing-effort/thresholds`

Returns all calibrated club types, each with their bucket list and shot count. Ordered by the highest bucket's `lower_bound` descending (roughly by club speed, so driver appears first).

Response shape:
```json
[
  {
    "club_type": "gw",
    "shot_count": 87,
    "updated_at": "2026-05-01T...",
    "buckets": [
      { "bucket_index": 1, "lower_bound": 60.0, "upper_bound": 65.4, "label": "E3 (60-65 mph)" },
      { "bucket_index": 2, "lower_bound": 65.4, "upper_bound": 72.1, "label": "E2 (65-72 mph)" },
      { "bucket_index": 3, "lower_bound": 72.1, "upper_bound": null,  "label": "Full Effort - E1 (72+ mph)" }
    ]
  }
]
```

Accepts optional `disabled_clubs` query param (comma-separated `club_type|club` pairs) to exclude specific clubs from shot counts.

### `GET /swing-effort/histogram/{club_type}`

Returns 2 mph-binned `club_speed` distribution for a club type. Each bin includes average `carry`, `apex`, `side_carry`, and `total_distance` for shots in that bin.

Also returns the current threshold rows for overlay rendering.

Response shape:
```json
{
  "total": 87,
  "bins": [
    { "lo": 60, "hi": 62, "count": 5, "carry": 91.2, "apex": 18.1, "side_carry": 1.4, "total_distance": 93.0 }
  ],
  "thresholds": [
    { "bucket_index": 1, "lower_bound": 60.0, "upper_bound": 65.4, "label": "E3 (60-65 mph)" }
  ]
}
```

### `GET /swing-effort/matrix`

Returns per-club × per-bucket carry stats. Buckets are re-keyed by **rank** (rank `"1"` = full effort) before returning.

Default: wedge types only (`lw`, `sw`, `gw`, `pw`, `aw`, `w`). Params:
- `all_clubs=true` — include irons, driver, etc.
- `include_outliers=true` — include outlier shots
- `club_types=sw,gw,pw` — explicit club type filter
- `disabled_clubs=` — comma-separated `club_type|club` exclusions
- `date_from=`, `date_to=` — ISO date range filter
- `limit_sessions=N` — restrict to the N most recent sessions

Response shape (buckets keyed by rank string, rank 1 = full effort):
```json
[
  {
    "club_type": "gw",
    "club": "Titleist Vokey 50°",
    "buckets": {
      "1": { "n": 34, "label": "Full Effort - E1 (72+ mph)", "carry_mean": 112.4, "carry_std": 3.9,
             "total_mean": 114.0, "side_carry_std": 5.2, "apex_mean": 22.1,
             "speed_mean": 75.3, "spin_rate_mean": 9200, "smash_factor_mean": 1.41, "attack_angle_mean": -4.2 },
      "2": { "n": 22, "carry_mean": 103.1, ... }
    }
  }
]
```

### Existing endpoints (updated)

`/stats/clubs` accepts an optional `effort` query param:
- `effort=full` — only the top bucket (highest `bucket_index`) for each club type
- `effort=1,2` — specific bucket rank strings (comma-separated)
- omitted — no filter (default)

---

## Frontend Pages

### Swing Effort (`/swing-effort`)

- Threshold management table: one row per calibrated club type showing bucket labels and speed ranges, shot count, and action buttons.
- Edit row: inline inputs to manually set internal break points; saves via PATCH and reclassifies shots immediately.
- Calibrate button (per-club and global) to re-run the Jenks calibration routine.
- Speed histogram: binned club_speed distribution for a selected club with vertical reference lines at each `lower_bound`. Bar colors map to effort rank — full effort is blue, decreasing effort shifts toward red.

### Wedge Matrix (`/wedge-matrix`)

- Rows: wedge club types sorted by carry distance descending.
- Columns: effort ranks (rank 1 = Full Effort through rank N = lowest effort). Columns with < 5 shots are hidden.
- Cells: carry mean ± std, shot count `n`, mean club speed.
- Color scale: darker = longer carry.
- Toggle: "All clubs" to include irons, driver, etc.

### Club Gapping (`/gapping`)

- Stacked horizontal bars per club broken down by effort rank.
- Clubs without enough effort data render as a single bar (overall avg carry).
- Tooltip shows overall avg carry plus per-bucket carries.
- Table adds one column per bucket rank showing carry/total/std/side/apex/speed/spin/smash/attack angle with shot count.
- Shot Simulator uses all effort ranks when ranking club+effort combinations by proximity to a target distance.

---

## Open Questions / Future Work

1. **Per-club vs per-club-type thresholds** — If the user has two gap wedges with meaningfully different characteristics, per-club thresholds may be needed.
2. **Smash factor as secondary signal** — Partial swings often have lower smash factor. Could use `smash_factor` to disambiguate edge cases near bucket boundaries.
3. **Attack angle signal** — Chips/pitches have very different attack angles; could filter those out of the effort model entirely as a distinct swing type.
4. **UI for manual shot override** — Allow tagging individual shots with a different effort bucket if the algorithm miscategorizes.
5. **Schema.sql out of sync** — `db/schema.sql` still defines the old wide `swing_effort_thresholds` schema. The runtime migration in `_ensure_schema()` handles existing DBs, but `schema.sql` should be updated to match the current narrow schema.
