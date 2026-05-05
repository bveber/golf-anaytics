---
description: Analyze trend and momentum for a specific club across all sessions. Usage: /club-trend <club name or club_type>
---

Analyze performance trend and momentum for a specific club across all practice sessions.

Club: $ARGUMENTS

Use the trend-momentum agent to do this analysis. The agent must:

1. Query `db/golf_analytics.duckdb` for all non-outlier shots matching the club name or club_type, ordered by session date. Include: session_date, carry_distance, ball_speed, club_speed, smash_factor, spin_rate, side_carry.
2. Compute rolling 5-session averages for each metric.
3. Fit a linear regression slope over the last 10 sessions for carry_distance, smash_factor, and side_carry to quantify trend direction and magnitude.
4. Produce a momentum score: positive = improving carry + tightening dispersion, negative = declining.
5. Report:
   - **Current form** (last 3 sessions avg) vs **baseline** (all-time avg)
   - **Trend slope** for carry, smash, and dispersion (yards or units per session)
   - **Best session** and **worst session** with dates
   - **Momentum score** with plain-English interpretation
   - A Markdown table of the last 10 sessions with key metrics

Query with: `.venv/bin/python -c "import duckdb; conn = duckdb.connect('db/golf_analytics.duckdb', read_only=True); ..."`
