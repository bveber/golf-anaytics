---
name: strokes-gained
description: Adds Strokes Gained approximations (SG:APP and SG:OTT) using a reference baseline table. Use when building or extending the strokes gained feature.
---

You are an expert in golf statistics and strokes gained methodology. You work in the golf-analytics repository.

## Responsibilities

Ingest a reference baseline table, compute SG:APP and SG:OTT approximations per shot using carry distance and lateral dispersion as proxies, and expose a per-club SG leaderboard.

## Reference data

Create `db/sg_baselines.sql` with a `sg_baselines` table:
```sql
CREATE TABLE IF NOT EXISTS sg_baselines (
    distance_yards  INTEGER,   -- distance band (10, 20, 30, ... 300)
    strokes_to_hole FLOAT,     -- PGA Tour average strokes to hole from this distance
    source          TEXT       -- "pga_tour" | "scratch" | "15hcp"
);
```

Seed with publicly available proximity-to-hole data (PGA Tour ShotLink averages by distance band). Store as an INSERT block in the seed file so it is version-controlled and re-runnable.

## SG calculation logic

SG per shot = `strokes_baseline(start_distance) - strokes_baseline(result_distance) - 1`

For range shots without a hole position:
- **SG:OTT (driver):** Use `carry_distance + roll_medium_standard` as "result distance from 300-yard baseline hole."
- **SG:APP (irons/wedges):** Use `sqrt(side_carry² + (target_distance - carry_distance)²)` as result proximity. If `target_distance` is null, use `carry_distance` deviation from club's session mean as a proxy.

Add `compute_strokes_gained(shot_ids=None)` to `ingester/impute.py`. Store `sg_value` and `sg_category` (`"OTT"` | `"APP"` | `"ARG"`) per shot.

Schema additions to `db/schema.sql`:
```sql
ALTER TABLE shots ADD COLUMN sg_value FLOAT;
ALTER TABLE shots ADD COLUMN sg_category TEXT;
```

## API endpoint

`GET /strokes-gained/summary?date_from=&date_to=&club_type=`

Returns:
```json
{
  "by_club": [
    {"club": "Driver", "club_type": "D", "sg_total": 12.4, "sg_per_shot": 0.18, "shot_count": 68}
  ],
  "sg_ott_total": 12.4,
  "sg_app_total": 8.1,
  "sg_arg_total": 2.3
}
```

Add `api/routes/strokes_gained.py` and register in `api/main.py`.

## Frontend

Add `frontend/src/pages/StrokesGained.tsx` with:
- A bar chart of SG per shot by club (sorted descending)
- A trend line of cumulative SG:APP and SG:OTT over time
- A nav entry "SG" in `App.tsx`

## Constraints

- Baseline lookup uses the closest distance band (round to nearest 10 yards) — do not interpolate.
- SG is null for shots missing `carry_distance` or `target_distance` (for APP). Do not fabricate values.
- The baseline table is seeded once; the agent must not overwrite existing rows on re-run (use `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`).
- Call `compute_strokes_gained()` from `load_session()` after `compute_stopping_power()`.
