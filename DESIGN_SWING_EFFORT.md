# Swing Effort Classification Design

## Problem

Partial swings — common with wedges but possible with any club — pollute aggregate statistics. A 60% gap wedge and a full gap wedge should not be averaged together. Currently the system has no way to distinguish them, making wedge gapping analysis unreliable and making a "wedge matrix by swing effort" impossible.

## Goal

1. Classify every shot into one of **5 swing effort buckets** based on club head speed.
2. Use those buckets to:
   - Power a **Wedge Matrix** showing carry distance by club × effort bucket.
   - Overlay effort-segmented carries on the **Club Gapping** chart for all clubs.
   - Show effort-specific dispersion ellipses on the **Club Dashboard**.

---

## Core Approach: Data-Derived Speed Thresholds per Club Type

Swing effort is best inferred from `club_speed` (mph). Thresholds are derived from each player's own data, not hardcoded — a 95 mph driver and a 115 mph driver have completely different speed ranges.

### Bucket Names and Fractions

Buckets are named after the percentage range of the club's speed spectrum they cover. All clubs use the same 5 buckets with evenly-spaced thresholds:

| Bucket  | Speed Range         | Threshold Fraction | Constant          |
|---------|---------------------|--------------------|-------------------|
| 100–80  | top 20% of range    | ≥ 80% of range     | `FULL_FRAC = 0.8` |
| 80–60   | 60–80% of range     | ≥ 60% of range     | `PCT75_FRAC = 0.6`|
| 60–40   | 40–60% of range     | ≥ 40% of range     | `PCT60_FRAC = 0.4`|
| 40–20   | 20–40% of range     | ≥ 20% of range     | `PCT50_FRAC = 0.2`|
| 20–0    | bottom 20% of range | ≥ 0% (= min_speed) | —                 |
| unknown | no club_speed data  | —                  | —                 |

Speed range is `[min_speed, anchor_speed]` where `anchor_speed = MAX(club_speed)` for that club type across non-outlier shots.

So `threshold_100_80 = min_speed + 0.8 × (anchor_speed − min_speed)`, etc.

**Minimum shots:** A club type needs ≥ 20 non-outlier shots to receive thresholds; uncalibrated clubs are marked `unknown`.

**Example** — gap wedge: min = 60 mph, max = 84 mph (range = 24 mph):
- 100–80: ≥ 79.2 mph  (60 + 0.8×24)
- 80–60:  72.4–79.1   (60 + 0.6×24)
- 60–40:  69.6–72.3   (60 + 0.4×24)
- 40–20:  64.8–69.5   (60 + 0.2×24)
- 20–0:   60.0–64.7

---

## Data Layer

### Column: `shots.swing_effort`

TEXT column with values: `100-80`, `80-60`, `60-40`, `40-20`, `20-0`, `unknown`.

**Derived, not ingested** — computed after loading and recomputed when thresholds change via calibration.

Shots where `club_speed` is NULL are marked `unknown`. The `club_speed_imputed` flag is preserved separately.

### Threshold table: `swing_effort_thresholds`

```sql
CREATE TABLE swing_effort_thresholds (
    club_type     TEXT PRIMARY KEY,
    anchor_speed  DOUBLE NOT NULL,  -- MAX club_speed (mph) = top of 100-80 bucket
    min_speed     DOUBLE NOT NULL,  -- MIN club_speed (mph) = bottom of 20-0 bucket
    full_speed    DOUBLE NOT NULL,  -- lower bound for '100-80' (80% of range)
    pct75_speed   DOUBLE NOT NULL,  -- lower bound for '80-60'  (60% of range)
    pct60_speed   DOUBLE NOT NULL,  -- lower bound for '60-40'  (40% of range)
    pct50_speed   DOUBLE NOT NULL,  -- lower bound for '40-20'  (20% of range)
    shot_count    INTEGER NOT NULL, -- shots used to calibrate
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The column names `pct75_speed`, `pct60_speed`, `pct50_speed` are internal naming — they correspond to the 80%, 60%, 40% fraction thresholds respectively (i.e., the lower bound of the `80-60`, `60-40`, and `40-20` buckets).

---

## Calibration Routine (`POST /swing-effort/calibrate`)

1. For each `club_type` with ≥ 20 non-outlier shots, compute MAX (anchor) and MIN of `club_speed`.
2. Derive 4 threshold speeds using the evenly-spaced fractions (0.8, 0.6, 0.4, 0.2 of the speed range).
3. Write/update rows in `swing_effort_thresholds`.
4. Reclassify all shots of that club type in `shots.swing_effort`.

Optional `?club_type=` param re-runs calibration for a single club only.

Re-run after ingesting significant new data or when thresholds are manually adjusted.

### Manual override (`PATCH /swing-effort/thresholds/{club_type}`)

Body: `{ "full_speed": float, "pct75_speed": float, "pct60_speed": float, "pct50_speed": float }`

Writes updated thresholds and immediately reclassifies all shots for that club type. Useful for fine-tuning after inspecting the speed histogram.

---

## API

### `/swing-effort/thresholds` (GET)

Returns all rows from `swing_effort_thresholds`, ordered by `anchor_speed` descending.

### `/swing-effort/histogram/{club_type}` (GET)

Returns binned `club_speed` distribution for a club type plus threshold boundaries — used to render the calibration histogram with bucket overlays. Threshold keys: `anchor`, `min`, `full`, `pct75`, `pct60`, `pct50`.

### `/swing-effort/matrix` (GET)

Returns per-club × per-effort-bucket carry stats. Default: wedge types only. Params:
- `all_clubs=true` — include irons, driver, etc.
- `include_outliers=true` — include outlier shots
- `club_types=sw,gw,pw` — explicit club type filter

Response shape:
```json
[
  {
    "club_type": "gw",
    "club": "Titleist Vokey 50°",
    "buckets": {
      "100-80": { "n": 34, "carry_mean": 112, "carry_std": 4.1, "speed_mean": 82 },
      "80-60":  { "n": 22, "carry_mean": 103, "carry_std": 3.5, "speed_mean": 76 },
      "60-40":  { "n": 18, "carry_mean":  93, "carry_std": 3.8, "speed_mean": 71 },
      "40-20":  { "n": 11, "carry_mean":  82, "carry_std": 4.9, "speed_mean": 65 },
      "20-0":   { "n":  6, "carry_mean":  68, "carry_std": 6.1, "speed_mean": 61 }
    }
  }
]
```

### Existing endpoints (updated)

`/stats/clubs` and `/shots/club/{club_type}` accept an optional `effort` query param:
- `effort=100-80` — only top-effort swings
- `effort=all` — no filter (default)
- `effort=100-80,80-60` — comma-separated multi-select

---

## Frontend Pages

### Swing Effort (`/swing-effort`)

- Threshold management table: one row per calibrated club type. Columns show **speed ranges** for each of the 5 buckets (e.g., "72.4–79.1 mph" for the 80–60 bucket), shot count, and action buttons.
- Edit row: inline inputs to manually override the 4 threshold speeds; saves via PATCH and reclassifies shots immediately.
- Calibrate button (per-club and global) to re-run the calibration routine.
- Speed histogram: binned club_speed distribution for a selected club with 4 vertical reference lines (at 80%, 60%, 40%, 20% of range). Bar colors match bucket colors: blue (100–80), cyan (80–60), yellow (60–40), orange (40–20), red (20–0).

### Wedge Matrix (`/wedge-matrix`)

- Rows: wedge club types (lw, sw, gw, pw, aw, w) sorted by carry distance descending.
- Columns: 100–80 / 80–60 / 60–40 / 40–20 / 20–0 (columns with < 5 shots are hidden).
- Cells: carry mean ± std, shot count `n`, mean club speed.
- Color scale: darker = longer carry, to visually communicate the distance ladder.
- Toggle: "All clubs" to include irons, driver, etc.

### Club Gapping (`/gapping`)

- One horizontal bar per club, stacked by effort level (20–0 at base, 100–80 at tip):
  - **Red** — 20–0 effort carry (base segment)
  - **Orange** — delta from 20–0 to 40–20
  - **Yellow** — delta from 40–20 to 60–40
  - **Cyan** — delta from 60–40 to 80–60
  - **Blue** — delta from 80–60 to 100–80 (tip)
- Clubs without effort data (< 3 shots per bucket) render as a single **green** bar (overall avg carry).
- Tooltip shows overall Avg Carry plus individual effort carries when present.
- Table adds one column per bucket (100–80 through 20–0), each showing carry/total/std/side/apex/speed/spin/smash with shot count. Columns with no data show `—`.
- Shot Simulator uses all 5 effort options when ranking club+effort combinations by proximity to a target distance.

---

## Open Questions / Future Work

1. **Per-club vs per-club-type thresholds** — If the user has two gap wedges with meaningfully different characteristics, per-club thresholds may be needed.
2. **Smash factor as secondary signal** — Partial swings often have lower smash factor. Could use `smash_factor` to disambiguate edge cases near bucket boundaries.
3. **Attack angle signal** — Chips/pitches have very different attack angles; could filter those out of the effort model entirely as a distinct swing type.
4. **UI for manual shot override** — Allow tagging individual shots with a different effort bucket if the algorithm miscategorizes.
