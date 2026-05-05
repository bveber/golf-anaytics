---
name: session-health
description: Detects statistically anomalous sessions and shots using z-scores against rolling baselines. Adds a health badge to sessions in SessionBrowser. Use when building or modifying anomaly detection.
---

You are an expert in statistical quality control. You work in the golf-analytics repository.

## Responsibilities

After each sync, compute z-scores for session-level metrics against each club's rolling 30-session baseline. Flag sessions and individual shots that are statistically anomalous. Surface a health badge in the session list.

## Schema additions

```sql
ALTER TABLE sessions ADD COLUMN health_score FLOAT;       -- 0-100, higher = healthier
ALTER TABLE sessions ADD COLUMN health_flags  TEXT;        -- JSON array of flag strings
ALTER TABLE shots    ADD COLUMN z_carry       FLOAT;
ALTER TABLE shots    ADD COLUMN z_spin        FLOAT;
ALTER TABLE shots    ADD COLUMN z_ball_speed  FLOAT;
```

## Detection logic

Add `compute_session_health(session_id: str)` to a new `ingester/health.py` module.

**Per-club z-score:** For each club in the session, compute the session mean for `carry_distance`, `spin_rate`, `ball_speed`. Compare against the rolling 30-session baseline (excluding the current session):

```python
z = (session_mean - baseline_mean) / max(baseline_std, 1e-6)
```

**Health flags (strings stored as JSON in `health_flags`):**
- `"carry_anomaly:{club}"` — |z_carry| > 2.5 for any club with ≥ 5 shots
- `"spin_anomaly:{club}"` — |z_spin| > 2.5
- `"speed_anomaly:{club}"` — |z_ball_speed| > 2.5
- `"low_shot_count"` — session has < 10 shots total
- `"single_club_session"` — only one distinct club hit

**Health score:** `100 - 20 * len(health_flags)`, clamped to [0, 100].

**Per-shot z-scores:** Compute z-scores for each shot against the session's own mean. Store in `z_carry`, `z_spin`, `z_ball_speed`.

Call `compute_session_health(session.session_id)` from `ingester/load.py` at the end of `load_session()`, after all other impute/compute calls.

## API

Add `health_score` and `health_flags` to the sessions list response in `api/routes/sessions.py`. Parse `health_flags` from JSON string to list before returning.

## Frontend

In `frontend/src/pages/SessionBrowser.tsx`, add a colored health badge next to each session row:
- Green dot: `health_score >= 80`
- Yellow dot: `health_score >= 50`
- Red dot: `health_score < 50`
- Tooltip on hover listing the specific flags

## Constraints

- Require ≥ 10 prior sessions per club to compute a meaningful baseline; skip z-score if fewer (leave null, do not flag).
- `compute_session_health` is idempotent — re-running overwrites stored values.
- Health flags are informational only — they never automatically set `is_outlier = true`. The user retains control over outlier flagging.
- `ingester/health.py` must not import from `api/` — ingester-layer code only.
