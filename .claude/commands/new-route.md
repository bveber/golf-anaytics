---
description: Scaffold a new FastAPI route in api/routes/ following project conventions. Usage: /new-route <route-name> [description of what it does]
---

Scaffold a new FastAPI route for the golf-analytics backend.

Route name and purpose: $ARGUMENTS

Use the python-agent to implement this. The agent must:

1. Read api/routes/stats.py and api/routes/sessions.py to understand the exact conventions (imports, get_conn() usage, SQL style, Pydantic models in api/models.py).
2. Create `api/routes/<route_name>.py` with:
   - `from __future__ import annotations` at top
   - Router defined as `router = APIRouter(prefix="/<route_name>", tags=["<route_name>"])`
   - At least one GET endpoint with a typed Pydantic response model
   - Fresh `get_conn()` per endpoint, never cached globally
   - SQL in triple-quoted strings, `?` placeholders for any params
3. Add the response model to `api/models.py`
4. Register the router in `api/main.py` (import + `app.include_router`)
5. Report back: file created, endpoint path(s), and any assumptions made about the data shape.

Do not add error handling for cases that can't happen. Do not add comments explaining what the code does.
