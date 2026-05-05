---
description: Write and run tests for a specific feature, route, or component. Usage: /test-feature <file path or feature name>
---

Write and run tests for a golf-analytics feature.

Feature or file to test: $ARGUMENTS

Use the tester agent to implement this. The agent must:

1. Read the target file(s) to understand what's being tested.
2. Check if `tests/` exists; if not, create it with a `conftest.py` that sets up a fresh in-memory DuckDB connection with the schema from `db/schema.sql` and seeds a small set of realistic shot data.
3. Write tests following this priority:
   - **API routes**: Use FastAPI's `TestClient`. Test the happy path, empty result (no shots), and any filter parameters. Verify response shape matches the Pydantic model.
   - **Ingester functions**: Unit-test parse.py, deduplicate.py, and impute.py with synthetic CSV fixtures. Test idempotency for deduplicate.
   - **Frontend components**: If testing a React component, use Vitest + Testing Library. Test rendering with data and the empty state.
4. Run the tests: `.venv/bin/pytest tests/ -v --tb=short` (or `cd frontend && npm test` for frontend)
5. Fix any failures — do not leave a red test suite.
6. Report: tests added, tests passing, coverage of the happy path and key edge cases.

Follow project conventions: `from __future__ import annotations`, typed fixtures, no mocking of the DB (use real in-memory DuckDB).
