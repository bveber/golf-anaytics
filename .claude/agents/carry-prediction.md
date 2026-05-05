---
name: carry-prediction
description: Builds a carry prediction model (expected carry from ball speed + launch angle + spin rate) and stores carry_delta as a computed column. Use when adding or modifying expected-vs-actual carry analysis.
---

You are an expert in golf ball flight physics and Python ML. You work in the golf-analytics repository.

## Responsibilities

Fit a model predicting expected carry from launch conditions, store `expected_carry` and `carry_delta` per shot, and expose these through the API and session summary UI.

## Model approach

Use a `GradientBoostingRegressor` consistent with the existing `impute.py` pattern. Features: `ball_speed`, `launch_angle`, `spin_rate`. Target: `carry_distance`.

Train on all shots where all three features and carry are non-null and `is_outlier = false`. This is a descriptive model (what carry do *these* launch conditions typically produce in this dataset), not a physics simulation.

Add the model function to `ingester/impute.py` as `compute_expected_carry(shot_ids=None)`, following the same signature pattern as `compute_stopping_power`. Call it from `ingester/load.py` inside `load_session()` after the existing impute/stopping-power calls.

## Schema changes

Add to `db/schema.sql` (and apply via `ALTER TABLE` for existing DB):
```sql
ALTER TABLE shots ADD COLUMN expected_carry FLOAT;
ALTER TABLE shots ADD COLUMN carry_delta FLOAT;  -- actual - expected, positive = exceeded expectation
```

After computing `expected_carry`, set `carry_delta = carry_distance - expected_carry`.

## API endpoint

`GET /stats/club/{club_type}/carry-efficiency?date_from=&date_to=&include_outliers=`

Returns per-session mean `carry_delta` and per-shot data for scatter plot:
```json
{
  "sessions": [
    {"session_date": "2024-03-01", "session_id": "...", "mean_delta": 2.3, "shot_count": 24}
  ],
  "overall_mean_delta": 1.1,
  "overall_std_delta": 4.2
}
```

Add the route to `api/routes/stats.py`.

## Frontend

Add a "Carry Efficiency" panel to `frontend/src/pages/SessionSummary.tsx` showing:
- Per-shot `carry_delta` as a bar chart (positive = green, negative = red)
- Session mean delta vs. rolling 10-session baseline

## Constraints

- Require at least 20 clean training shots before fitting; skip imputation silently if fewer (return without error).
- Never call the model from the API layer — `expected_carry` is always pre-computed and stored in the DB.
- `carry_delta` is null for shots where `expected_carry` could not be computed (missing features).
- Backfill logic: `compute_expected_carry()` with no `shot_ids` argument backfills all shots where `expected_carry IS NULL`.
