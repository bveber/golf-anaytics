---
name: trend-momentum
description: Adds rolling window aggregations, regression slopes, and a momentum score to the trend API. Use when building or improving per-club trend analysis or the report card view.
---

You are an expert in time-series analysis and FastAPI. You work in the golf-analytics repository.

## Responsibilities

Extend `api/routes/stats.py` with rolling window statistics and regression slopes computed server-side using DuckDB window functions. Build a report card endpoint that summarizes direction-of-travel per club.

## Rolling window endpoint

Extend `GET /stats/club/{club_type}/trend` to accept a `rolling_n` query param (default: 5, options: 5, 10, 20). For each session data point, include rolling mean and rolling std computed over the prior N sessions:

```sql
AVG(mean_val) OVER (
    ORDER BY session_date
    ROWS BETWEEN ? PRECEDING AND CURRENT ROW
) AS rolling_mean,
STDDEV(mean_val) OVER (
    ORDER BY session_date
    ROWS BETWEEN ? PRECEDING AND CURRENT ROW
) AS rolling_std
```

Add `rolling_mean` and `rolling_std` to the response dict alongside the existing `mean`, `std`, `shot_count`.

## Regression slope

`GET /stats/club/{club_type}/slope?metric=carry_distance&date_from=&date_to=&min_sessions=5`

Returns the linear regression slope (yards per day) and R² for the requested metric over the date range, using DuckDB's `REGR_SLOPE` and `REGR_R2`:

```sql
SELECT
    REGR_SLOPE(mean_val, epoch(session_date)) AS slope_per_sec,
    REGR_R2(mean_val, epoch(session_date))    AS r2,
    COUNT(*) AS session_count
FROM (subquery of session means)
```

Convert `slope_per_sec` to `slope_per_week = slope_per_sec * 604800`. Return null slope/r2 if fewer than `min_sessions` sessions exist.

## Report card endpoint

`GET /stats/report-card?date_from=&date_to=`

For every club with ≥ 5 sessions in the window, return:
```json
{
  "club": "7i",
  "club_type": "7i",
  "carry_slope_per_week": 0.4,
  "carry_r2": 0.61,
  "consistency_trend": "improving",   // "improving" | "degrading" | "flat"
  "momentum_score": 72,
  "shot_count": 89
}
```

`consistency_trend` is derived from the slope of the rolling CV over time (is variance shrinking or growing?). `momentum_score` is `50 + 50 * tanh(carry_slope_per_week / 1.5)` — maps a slope of 0 to score 50, positive slopes above ~1.5 yd/week to ~90+, negative to ~10-.

Add a new `ReportCard.tsx` page under `frontend/src/pages/` and a nav entry in `App.tsx` / `Nav`.

## Constraints

- Regression is always computed server-side with DuckDB — never send all session data to the frontend for JS regression.
- `rolling_n` window uses sessions ordered by `session_date`, not calendar days, so sparse practice periods do not inflate variance.
- The report card endpoint is read-only and stateless; it never writes to the DB.
- All new response fields are `Optional` — gracefully return null for clubs with insufficient data rather than 4xx.
