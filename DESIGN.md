# Golf Analytics App — Design Document

## Overview

A local-first web application that scrapes session data from Rapsodo r-cloud, stores it in a structured database, and provides an interactive dashboard for tracking swing progress, validating training plans, and analyzing performance across clubs over time.

---

## Goals

1. Automatically ingest Rapsodo session data with no manual export steps
2. Provide deep statistical analysis on all available metrics, per shot and per session
3. Track consistency and distance control trends over time, per club
4. Replicate and extend the Rapsodo "Combine" test format for structured performance benchmarking
5. Visualize shot dispersion, metric trends, and club comparisons through an interactive web dashboard

---

## System Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│   Rapsodo r-cloud   │────▶│   Scraper / Ingester  │────▶│   Local Database     │
│   (web UI)          │     │   (Playwright)         │     │   (DuckDB)           │
└─────────────────────┘     └──────────────────────┘     └──────────────────────┘
                                                                      │
                                                          ┌──────────────────────┐
                                                          │   Web Dashboard      │
                                                          │   (FastAPI + React   │
                                                          │    or Streamlit)     │
                                                          └──────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|---------------|
| **Scraper** | Authenticate to r-cloud, discover new sessions, download per-shot data |
| **Ingester** | Parse, validate, deduplicate, and load data into DuckDB |
| **Scheduler** | Nightly cron job to check for new sessions automatically |
| **Database** | DuckDB for local analytical queries; flat-file JSON/CSV backups per session |
| **Dashboard** | Interactive web UI for analysis and visualization |

---

## Data Ingestion

### Scraping Strategy

- **Tool**: Playwright (Python) — headless Chromium, automates the r-cloud web UI
- **Authentication**: Store credentials in a local `.env` file (never committed); session cookies cached to avoid repeated logins
- **Session Discovery**: Navigate the session list, compare session IDs against the database to identify new sessions only
- **Per-Session Data**: For each new session, click the built-in export button on the r-cloud UI to download the CSV file; parse the exported CSV rather than scraping the data table
- **Rate Limiting**: Polite delays between sessions to avoid triggering bot detection

### Deduplication

- Each session assigned a stable unique ID from r-cloud (used as primary key)
- Each shot assigned a composite key: `(session_id, shot_number)`
- Ingestion is idempotent — re-running never duplicates data

### Sync Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Manual** | CLI command or dashboard button | Scrapes immediately, shows progress |
| **Nightly** | Cron job (e.g., 2 AM) | Checks for new sessions silently, logs results |

### Backups

- After each ingestion run, raw per-session data is written to `/backups/sessions/<session_id>.json`
- DuckDB database file is copied to `/backups/db/golf_analytics_<date>.duckdb`
- Backup retention: keep last 30 daily DB snapshots; keep all session JSON files indefinitely

---

## Data Model

### `sessions` table

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | TEXT PK | Rapsodo's unique session identifier |
| `session_date` | TIMESTAMP | Date/time of the session |
| `session_type` | TEXT | Practice type (e.g., Free Practice, Combine, Target Practice) |
| `notes` | TEXT | User-added notes |
| `scraped_at` | TIMESTAMP | When this session was ingested |

### `shots` table

| Column | Type | Description |
|--------|------|-------------|
| `shot_id` | TEXT PK | Composite: `session_id:shot_number` |
| `session_id` | TEXT FK | Links to `sessions` |
| `shot_number` | INTEGER | Shot sequence within session |
| `club` | TEXT | Club used |
| `is_outlier` | BOOLEAN | Flagged by user as bad reading / exceptional |
| `outlier_note` | TEXT | Reason for outlier flag |
| *(all Rapsodo metric columns)* | FLOAT | Ball speed, launch angle, spin rate, carry, total distance, smash factor, club path, face angle, attack angle, dynamic loft, spin axis, side carry, side total, etc. |

### `combine_sessions` table

| Column | Type | Description |
|--------|------|-------------|
| `combine_id` | TEXT PK | |
| `session_id` | TEXT FK | |
| `target_1_distance` | FLOAT | User-defined target 1 (yards) |
| `target_1_club` | TEXT | Club assigned to target 1 |
| `target_2_distance` | FLOAT | User-defined target 2 (yards) |
| `target_2_club` | TEXT | Club assigned to target 2 |
| `target_3_club` | TEXT | Always Driver (or override) |
| `rapsodo_score` | FLOAT | Score as reported by Rapsodo app |

---

## Statistical Analysis

All metrics are analyzed with the following statistics, filterable by club, date range, and session type:

### Per-Metric Statistics (per club, per time window)

| Statistic | Purpose |
|-----------|---------|
| Mean | Central tendency / average performance |
| Median | Robust central tendency (less sensitive to outliers) |
| Std Dev (σ) | Consistency measure — lower is better |
| CV (σ/mean) | Normalized consistency — enables cross-metric and cross-club comparison |
| Min / Max | Range of outcomes |
| 10th / 90th percentile | Typical range excluding extremes |
| Trend (linear regression slope) | Is this metric improving, degrading, or flat over time? |

### Consistency Score

A composite consistency score per club per session:

- Computed as the average of normalized CVs across key metrics (carry distance, ball speed, lateral dispersion)
- Displayed as a 0–100 index where higher = more consistent
- Tracked over time as a headline KPI

### Dispersion Metrics

- **Lateral dispersion**: Std dev and 80th-percentile circle radius of side carry
- **Distance dispersion**: Std dev of carry distance within a club/session
- **Dispersion ellipse**: 2D visualization of shot cluster (lateral vs. carry)

---

## Combine Protocol

### Structure

- **Targets**: 3 targets per combine session
  - Target 1: User-defined distance + club
  - Target 2: User-defined distance + club
  - Target 3: Driver (configurable to allow 2i or other tee shot clubs)
- **Shots**: 2 shots per target, cycling through all 3 targets → 24 shots total (adjustable)
- **Score**: Imported from Rapsodo app (lateral + distance dispersion based)

### Combine Tracking

- Each combine session stored with its configuration (targets, clubs, shot count)
- Score history tracked over time with trend visualization
- Per-target breakdown: how did each club/distance combo perform?
- Combine vs. Free Practice comparison: does performance under stress correlate with open practice?

---

## Web Dashboard

### Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend API | **FastAPI** (Python) | Fast, async, automatic OpenAPI docs |
| Frontend | **React + Recharts** | Interactive charts, filterable views |
| Database driver | **DuckDB Python client** | Analytical queries over local file |
| Charts | **Recharts** (React) | Trend lines, scatter plots, bar charts |

*Alternative*: Use **Streamlit** for faster initial development if full React is overkill early on. Can migrate to FastAPI+React as complexity grows.

### Pages / Views

#### 1. Session Summary
- Triggered after a new sync; shows the latest session
- Key metrics vs. personal baseline (last 30 days) per club
- Outlier flagging UI: click any shot to mark as outlier and add a note
- Session-level notes field

#### 2. Club Dashboard
- Select one or more clubs
- Trend lines for all metrics over time (date range filter + rolling window selector)
- Consistency score trend
- Dispersion chart (2D scatter: lateral vs. carry, color-coded by session)

#### 3. Club Comparison
- Side-by-side metric comparison across clubs
- Radar chart: key metrics normalized to personal baselines
- Useful for understanding relative strengths (e.g., irons vs. wedges consistency)

#### 4. Combine Tracker
- Combine score history with trend line
- Per-target performance breakdown over time
- Combine vs. free practice performance correlation

#### 5. Session Browser
- Table of all sessions with type, date, club, shot count
- Click to drill into any session
- Filter by club, session type, date range

---

## Outlier Management

- Any shot can be flagged as an outlier from the Session Summary view
- Outliers excluded from all statistical calculations by default
- Toggle to include outliers (shown in a different color on charts)
- Outlier reasons: `bad_reading`, `exceptional_shot`, `equipment_issue`, `other`

---

## Project Structure

```
golf-analytics/
├── scraper/
│   ├── auth.py             # Login, session cookie management
│   ├── sessions.py         # Session list discovery
│   ├── shots.py            # Per-session shot data scraping
│   └── scheduler.py        # Nightly cron job
├── ingester/
│   ├── parse.py            # Raw data → structured records
│   ├── deduplicate.py      # Check against DB before insert
│   └── load.py             # Write to DuckDB
├── db/
│   ├── schema.sql          # Table definitions
│   └── golf_analytics.duckdb
├── api/
│   ├── main.py             # FastAPI app
│   ├── routes/
│   │   ├── sessions.py
│   │   ├── shots.py
│   │   ├── stats.py
│   │   └── combine.py
│   └── models.py           # Pydantic schemas
├── frontend/               # React app (or Streamlit app.py)
├── backups/
│   ├── sessions/           # Raw JSON per session
│   └── db/                 # Daily DuckDB snapshots
├── .env.example            # Credentials template (never commit .env)
├── requirements.txt
└── DESIGN.md
```

---

## Implementation Phases

### Phase 1 — Data Foundation
- [ ] Playwright scraper: authenticate, list sessions, scrape per-shot data
- [ ] DuckDB schema and ingester with deduplication
- [ ] CLI: `python sync.py` for manual sync
- [ ] Backup system (raw JSON + DB snapshots)
- [ ] Nightly scheduler

### Phase 2 — Core Dashboard
- [ ] FastAPI backend with session and shot endpoints
- [ ] Session Summary view with outlier flagging
- [ ] Club Dashboard: trend lines + dispersion charts
- [ ] Date range and rolling window filters

### Phase 3 — Advanced Analysis
- [ ] Club Comparison view (radar chart)
- [ ] Combine Tracker with score history
- [ ] Consistency score index
- [ ] Session Browser with full filtering

### Phase 4 — Polish
- [ ] Combine configuration UI (set targets, clubs, shot count)
- [ ] Training plan tagging (tag sessions as part of a named training block)
- [ ] Export: PDF summary report per session or time window

---

## Open Questions

~~1. **Rapsodo scraping mechanics**: Does r-cloud render session data client-side (JS) or server-side? This affects Playwright wait strategy.~~
**Answered**: r-cloud has a built-in export button on the web UI. Ingestion strategy should use this export rather than scraping the data table directly. Playwright is still needed to automate the login + export button click flow, but we are not scraping a JS-rendered table.

~~2. **Session types**: What session types exist beyond Free Practice and Combine?~~
**Answered**: Session types are: Practice, Combine, Courses, Range, Target Range, Closest to Pin, Speed.

~~3. **Combine club flexibility**: Confirm whether the Driver-only target 3 can be overridden in the Rapsodo app.~~
**Answered (partial)**: Unconfirmed — assume Driver for now. Revisit when combine data is available.

~~4. **Metric availability**: Are all metrics available for all session types, or do some metrics only appear in certain modes?~~
**Answered (partial)**: All 12 core metrics are expected to be available for all session types. Some session types may have additional session-level metadata or analysis, but this cannot be confirmed until data is collected. Treat all 12 metrics as universally present for now.
