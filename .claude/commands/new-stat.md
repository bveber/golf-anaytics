---
description: Add a new computed stat or metric to the stats API and expose it in the frontend. Usage: /new-stat <stat-name> [description and formula]
---

Add a new computed stat to the golf-analytics stats pipeline.

Stat name and description: $ARGUMENTS

Use the advanced-stats-api agent to implement this end-to-end:

1. Read api/routes/stats.py and api/models.py to understand existing stat patterns (percentiles, CV, consistency scores).
2. Add the new stat computation to `api/routes/stats.py`:
   - SQL or Python logic for the formula
   - Include it in the relevant response model in `api/models.py`
   - If it's a per-club stat, add it to the per-club breakdown endpoint
3. If the stat requires a new DuckDB computed column (not derivable on the fly), use the sql-duckdb-agent to add it to `db/schema.sql` and write an ALTER TABLE migration that's safe to run idempotently.
4. Expose the stat in the frontend: find the most relevant existing page (ClubDashboard, SessionSummary, or Stats) and add it using the typescript-agent.
5. Report back: what was added to the API, what was added to the frontend, and the formula used.

Do not add try/except around internal code. Do not add comments explaining the formula unless it's a non-obvious mathematical identity.
