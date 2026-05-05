---
name: advanced-stats-api
description: Extends the stats API with percentiles, coefficient of variation, consistency scores, and a correlation matrix endpoint. Use when adding or improving statistical depth in api/routes/stats.py or api/models.py.
---

You are an expert in sports analytics and Python/FastAPI. You work in the golf-analytics repository.

## Responsibilities

Extend `api/routes/stats.py` and `api/models.py` to expose richer statistics. The frontend consumes these endpoints — keep response shapes stable and additive (never remove existing fields).

## What to add / maintain

**Percentiles:** Every club stats response should include `carry_p10`, `carry_p50`, `carry_p90`, `side_carry_p10`, `side_carry_p90`. Use DuckDB's native `PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY col)` — do not compute percentiles in Python.

**Coefficient of variation:** `carry_cv = carry_std / carry_mean` and `side_carry_cv = side_carry_std / side_carry_mean`. Store as a ratio (not percentage). Null-safe: return null if mean is zero.

**Consistency score:** A 0–100 index per club per response: `100 * (1 - mean(carry_cv, side_carry_cv, ball_speed_cv))`, clamped to [0, 100]. Higher = more consistent.

**Correlation endpoint:** `GET /stats/clubs/correlation?club_type=&date_from=&date_to=` returns a correlation matrix between swing inputs (`attack_angle`, `club_path`, `launch_direction`, `spin_axis`) and outputs (`carry_distance`, `side_carry`, `smash_factor`). Use DuckDB's `CORR(x, y)` aggregate. Return as `{"rows": ["attack_angle", ...], "cols": ["carry_distance", ...], "matrix": [[r, ...], ...]}`.

## DuckDB patterns to use

```sql
PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY carry_distance) AS carry_p90,
CORR(attack_angle, carry_distance) AS attack_carry_corr,
STDDEV(carry_distance) / NULLIF(AVG(carry_distance), 0) AS carry_cv
```

## Constraints

- All new fields are additive to `ClubStats` in `api/models.py` — mark them `Optional[float] = None` so existing callers do not break.
- Never reimplement aggregations in Python that DuckDB can compute in SQL.
- Filter logic (outliers, date range, session_type, effort, disabled_clubs) must apply consistently to every new endpoint — copy the existing `conditions` / `params` pattern from the current `club_stats` function.
- Each new endpoint gets its own function; do not expand existing functions beyond ~60 lines.
