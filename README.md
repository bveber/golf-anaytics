# Golf Analytics

A local-first web application that automatically syncs shot data from [Rapsodo r-cloud](https://rcloud.rapsodo.com), stores it in a structured database, and provides an interactive dashboard for tracking swing performance across clubs and sessions over time.

## What it does

- **Automatic sync** — Playwright headlessly logs into r-cloud, discovers new sessions, and downloads the per-shot CSV export for each one
- **Idempotent ingestion** — re-running sync never duplicates data; shots are keyed by `(session_id, shot_number)`
- **Local DuckDB storage** — all data lives in a single `db/golf_analytics.duckdb` file; no external DB needed
- **FastAPI backend** — analytical queries served via REST; five routers cover sessions, shots, stats, golf tracker, and swing effort
- **React dashboard** — interactive charts and tables for session review, club trends, gapping, wedge matrix, swing effort, and more

## Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Session Browser | Paginated list of all sessions |
| `/session/:id` | Session Summary | Shot-level detail with outlier flagging |
| `/session/:id/clubs` | Session Clubs | Per-club breakdown within a session |
| `/clubs` | Club Dashboard | Trend lines per club across all sessions |
| `/gapping` | Gapping | Distance gaps between clubs |
| `/wedge-matrix` | Wedge Matrix | Short-game distance/spin matrix |
| `/swing-effort` | Swing Effort | Effort vs. distance tradeoff analysis |
| `/rounds` | Rounds | Round history |
| `/compare` | Compare | Side-by-side session or club comparison |
| `/bag` | Bag | Manage your bag configuration |

## Setup

### Prerequisites

- Python 3.11+
- Node.js 22+ (see [Node version note](#node-version-mismatch) if you run into issues)
- A Rapsodo r-cloud account

### Install

```bash
make setup
cp .env.example .env
# Edit .env with your r-cloud credentials
```

### Environment variables (`.env`)

```
RCLOUD_EMAIL=your@email.com
RCLOUD_PASSWORD=your_password
RCLOUD_BASE_URL=https://rcloud.rapsodo.com
RCLOUD_LOGIN_URL=https://rcloud.rapsodo.com/login
DB_PATH=db/golf_analytics.duckdb
BACKUP_DIR=backups
SYNC_TIME=02:00        # time for nightly scheduler
```

## Running

Start the API and frontend in separate terminals:

```bash
make api        # FastAPI on http://localhost:8000
make frontend   # React dev server on http://localhost:5173
```

## Data sync

```bash
make sync              # headless sync (normal use)
make sync-visible      # visible browser (debugging)
make dry-run           # discover sessions without writing to DB
make scheduler         # start nightly cron daemon (runs at SYNC_TIME)

# Force re-sync one specific session
.venv/bin/python sync.py --session-id <id>
```

Sync backs up the database automatically after each run (`backups/db/`).

## Architecture

```
Rapsodo r-cloud  ──►  scraper/  ──►  ingester/  ──►  DuckDB
  (web UI)             auth.py        parse.py       golf_analytics.duckdb
                       sessions.py    deduplicate.py       │
                       export.py      load.py         FastAPI (api/)
                                      impute.py            │
                                                      React (frontend/)
```

### Key files

| Path | Role |
|------|------|
| `sync.py` | Orchestrates the full scrape → ingest pipeline |
| `scraper/auth.py` | Playwright login + cookie caching |
| `scraper/sessions.py` | Discovers sessions not yet in DB |
| `scraper/export.py` | Clicks export button, downloads CSV |
| `ingester/parse.py` | CSV → `ParsedSession` / `Shot` dataclasses |
| `ingester/load.py` | Inserts into DuckDB; triggers computed columns |
| `ingester/impute.py` | Back-fills `club_speed` when sensor doesn't report it |
| `stopping_power.py` | Derives stopping-power metric post-insert |
| `api/main.py` | FastAPI app with CORS for localhost:5173 |
| `api/db.py` | `get_conn()` — fresh DuckDB connection per request |
| `db/schema.sql` | Full schema definition |
| `backup.py` | Copies DuckDB file to `backups/db/` |

## Computed columns

Two derived metrics are calculated automatically after every ingestion batch — **do not call them from the API layer**:

- **`impute_club_speeds()`** — estimates `club_speed` from ball speed when the Rapsodo sensor doesn't report it directly
- **`compute_stopping_power()`** — a spin-based metric that estimates how quickly a ball stops after landing

## Node version mismatch

If you see `npm is known not to run on Node.js vX` or `SyntaxError: Unexpected token '&&='`, your system has two Node installs:

```bash
# Fix by pointing /usr/local/bin/node at the Homebrew version
sudo rm /usr/local/bin/node
sudo ln -s /usr/local/Cellar/node/22.4.0/bin/node /usr/local/bin/node
node --version   # should show v22.4.0
```

## Linting

```bash
cd frontend && npm run lint
cd frontend && npm run build   # type-check + production build
```
