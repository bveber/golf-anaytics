---
description: Run the full pre-ship checklist: format, lint, type-check, and tests. Reports a pass/fail summary.
---

Run the complete pre-ship quality checklist for the golf-analytics project.

Arguments (optional — scope to a specific area): $ARGUMENTS

Run these checks in order, continuing even if one fails, then report a consolidated pass/fail summary:

**Backend checks:**
1. `make api &` — start the API, wait 3 seconds, then kill it (smoke test that it starts)
2. `.venv/bin/ruff check api/ ingester/ scraper/ sync.py backup.py stopping_power.py`
3. `.venv/bin/ruff format --check api/ ingester/ scraper/ sync.py backup.py stopping_power.py`
4. `.venv/bin/pytest tests/ -q --tb=short` (if tests/ dir exists)

**Frontend checks:**
5. `cd frontend && npm run lint`
6. `cd frontend && npm run build` (type-check + production build)

After all checks, output a table:
| Check | Status | Details |
|-------|--------|---------|
| API starts | PASS/FAIL | ... |
| ruff lint | PASS/FAIL | N issues |
| ruff format | PASS/FAIL | N files need formatting |
| pytest | PASS/FAIL | N passed, N failed |
| eslint | PASS/FAIL | N issues |
| tsc build | PASS/FAIL | N errors |

If any check fails, list the specific errors and suggest fixes. Use the formatter agent to auto-fix ruff/prettier issues if the user approves.
