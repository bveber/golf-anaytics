---
description: Audit data quality in the DuckDB database and flag anomalies. Usage: /data-health [optional: club or session filter]
---

Run a data quality audit on the golf-analytics DuckDB database.

Filter (optional): $ARGUMENTS

Open `db/golf_analytics.duckdb` read-only and run each of these checks, then produce a health report:

**Coverage checks:**
- Sessions with zero shots
- Shots missing club_type or club name
- Shots where club_speed IS NULL and club_speed_imputed IS FALSE (sensor gap, not imputed)
- Sessions older than 30 days not yet having stopping_power computed

**Outlier checks (use the session-health agent patterns):**
- Shots where smash_factor > 1.55 or smash_factor < 0.90 (impossible values)
- Shots where carry_distance > 400 or carry_distance < 0
- Shots where spin_rate > 12000 or spin_rate < 500
- Shots where ball_speed > 220

**Consistency checks:**
- Clubs that appear with wildly different club_type values across sessions (name normalization drift)
- Sessions where shot_numbers have gaps (missing shots in sequence)

If a filter was given (e.g. a club name or session ID), scope the queries to that filter.

Format the report as:
## Data Health Report — <today's date>
### Summary: N issues found across M checks
Then one section per failing check with count of affected rows and example shot_ids.

Use `.venv/bin/python -c "import duckdb; ..."` for each query or batch them in a single Python script.
