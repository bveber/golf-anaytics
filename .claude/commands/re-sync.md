---
description: Force re-sync a specific session from Rapsodo and report what changed. Usage: /re-sync <session-id>
---

Force re-sync a specific session from Rapsodo and report what changed in the database.

Session ID: $ARGUMENTS

Steps:
1. Capture a before-snapshot of this session's shots: run a db-query to get all shot_ids and key metrics for the session.
2. Run the re-sync: `.venv/bin/python sync.py --session-id $ARGUMENTS`
3. After sync completes, capture an after-snapshot of the same session's shots.
4. Diff the two snapshots: report any shots added, removed, or changed (metric values that shifted by more than rounding error).
5. If the sync fails, show the last 30 lines of output and diagnose the likely cause (auth expiry, scraper change, network issue).

If no session ID was provided (empty $ARGUMENTS), run `make dry-run` instead and show discovered sessions not yet in DB.
