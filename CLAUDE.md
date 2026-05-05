# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
```bash
make setup          # Create .venv, install Python deps, install Playwright Chromium
cp .env.example .env  # Fill in RCLOUD_EMAIL, RCLOUD_PASSWORD, RCLOUD_BASE_URL, RCLOUD_LOGIN_URL
```

### Running services
```bash
make api            # FastAPI backend on port 8000 (auto-reload)
make frontend       # React dev server on port 5173
```

### Data sync
```bash
make sync           # Headless sync (normal use)
make sync-visible   # Visible browser (debugging scraper)
make dry-run        # Discover sessions without writing to DB
.venv/bin/python sync.py --session-id <id>  # Force re-sync a specific session
```

### Frontend linting
```bash
cd frontend && npm run lint
cd frontend && npm run build   # Type-check + production build
```

### Troubleshooting: Node version mismatch
If you see `npm is known not to run on Node.js vX` or a `SyntaxError: Unexpected token '&&='` from npm, the system has two Node installations that are mismatched:
- `/usr/local/bin/node` — old v14 binary installed as root (the one `node` resolves to)
- `/usr/local/Cellar/node/22.4.0/bin/node` — Homebrew v22 (what npm uses)

Fix by replacing the stale binary with a symlink to the Homebrew version:
```bash
sudo rm /usr/local/bin/node
sudo ln -s /usr/local/Cellar/node/22.4.0/bin/node /usr/local/bin/node
node --version   # should show v22.4.0
```
Or let Homebrew manage it: `brew link --overwrite node`

## Architecture

### Data pipeline
`sync.py` orchestrates the entire ingestion flow:
1. **`scraper/auth.py`** — Playwright login + cookie caching
2. **`scraper/sessions.py`** — Discovers sessions not yet in DB
3. **`scraper/export.py`** — Clicks the r-cloud export button to download CSV per session
4. **`ingester/parse.py`** — CSV → `ParsedSession` / `Shot` dataclasses
5. **`ingester/deduplicate.py`** — Filters shots already in DB (idempotent)
6. **`ingester/load.py`** — Inserts into DuckDB; triggers `impute_club_speeds()` and `compute_stopping_power()` after each batch
7. **`backup.py`** — Copies the DuckDB file to `backups/db/`

### Database
Single DuckDB file at `db/golf_analytics.duckdb`. **Every new connection is a fresh `duckdb.connect()` call** — see `api/db.py` and `db.py` (root-level). The API uses `api/db.py`; the ingester uses `db.py`. Schema defined in `db/schema.sql`.

Key tables: `sessions`, `shots` (all Rapsodo metrics as floats), `combine_sessions`. `shot_id` is a composite `session_id:shot_number` string. Ingestion is idempotent.

### API
FastAPI app in `api/main.py` with five routers: `sessions`, `shots`, `stats`, `golf_tracker`, `swing_effort`. All routes import `get_conn()` from `api/db.py`. CORS is locked to `localhost:5173`.

### Frontend
React 19 + TypeScript SPA using Vite. Pages live in `frontend/src/pages/`. Global bag/club state is managed via `BagContext` (React context). Charts use Recharts. Styling is Tailwind CSS only — no CSS files.

Route map (from `App.tsx`):
- `/` → `SessionBrowser` — paginated session list
- `/session/:id` → `SessionSummary` — shot-level detail with outlier flagging
- `/session/:id/clubs` → `SessionClubs`
- `/clubs` → `ClubDashboard` — trend lines per club
- `/gapping` → `Gapping`
- `/wedge-matrix` → `WedgeMatrix`
- `/swing-effort` → `SwingEffort`
- `/rounds`, `/rounds/:id` → `Rounds` / `RoundDetail`
- `/compare` → `Compare`
- `/bag` → `Bag`

### Computed columns
`ingester/impute.py` back-fills `club_speed` when the sensor doesn't report it. `compute_stopping_power()` derives a stopping-power metric post-insert. These run automatically inside `load_session()` after every batch — do not call them from the API layer.

## Code conventions

- **Python**: `from __future__ import annotations` at the top of every module. Type hints on all function signatures. Pydantic/dataclasses for data boundaries; plain dicts only for internal intermediates.
- **TypeScript**: Strict mode is on. Prefer explicit return types on exported functions. Fetch calls to the API go directly in page components or small co-located hooks — no global API client layer exists yet.
- **No duplication**: SQL query logic belongs in route files, not duplicated across routes. Shared DB utilities go in `api/db.py`. Shared ingestion logic goes in `ingester/`.
- **DuckDB connections**: Open a connection, use it, let it go out of scope. Do not cache connections globally in the API — DuckDB handles concurrency fine with per-request connections.
