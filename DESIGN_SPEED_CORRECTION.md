# Speed Correction & Distance Recalculation Design

## Problem

The Rapsodo launch monitor consistently underestimates ball speed and club speed compared to Trackman data. This causes all carry and total distance values to be low. The correction is a **percentage of the measured clubhead speed**, varying by club type group. A percentage model is more physically appropriate than a fixed additive offset: at partial swing efforts the absolute underestimation is smaller, and a percentage scales with speed automatically.

Raw Rapsodo values are never modified in the database. All corrections are applied at API response time, making this fully reversible.

---

## Correction Percentages

Hardcoded in a new module `api/corrections.py`. Percentages are derived by anchoring the observed absolute errors on typical full-swing speeds for each club group, then interpolating for club types without direct Trackman comparisons.

```
corrected_club_speed = raw_club_speed × (1 + PCT_CLUB[club_type])
corrected_ball_speed = raw_ball_speed × (1 + PCT_BALL[club_type])
```

| Club Group | Club Types | Club Speed % | Ball Speed % | Derivation |
|---|---|---|---|---|
| Driver | `d` | +1.4% | +2.0% | +1.5 mph / ~105 mph; +3 mph / ~150 mph |
| Fairway Wood | `fw` | +1.3% | +1.9% | Interpolated between driver and irons |
| Hybrid | `h`, `2h`, `3h` | +1.3% | +1.9% | Same as fairway wood |
| Irons & Wedges | `i`, `w`, `sw`, `pw`, `lw`, `aw` | +1.2% | +1.7% | +1 mph / ~85 mph; +2 mph / ~120 mph |

Any unrecognized `club_type` receives the irons/wedges percentages as a conservative default.

**Scaling behaviour**: at a 60% swing effort where a driver produces ~63 mph of club speed, the club speed correction is ~0.9 mph rather than the ~1.5 mph seen at full speed — consistent with how sensor underestimation typically tracks with absolute speed.

---

## Carry Recalculation — Physics Model

Because Rapsodo's own carry values are derived from its underestimated speeds, we cannot simply scale those numbers. Instead, carry is recomputed from first principles using the corrected inputs.

### Inputs
- Corrected ball speed (mph)
- Launch angle (degrees)
- Spin rate (rpm) — raw Rapsodo value, trusted as-is
- Elevation (ft) — from user settings, default 900 ft
- Temperature (°F) — from user settings, default 70°F

### Model

A numerical trajectory integration (Euler method, dt = 0.01 s) with aerodynamic forces:

**Gravity:** 32.174 ft/s²

**Drag force** opposing velocity:
```
F_drag = 0.5 × ρ × CD × A × v²
```

**Lift force** (Magnus effect) perpendicular to velocity, in the vertical plane:
```
F_lift = 0.5 × ρ × CL × A × v²
CL = 3.19 × SP     where SP = r × ω / v  (spin parameter)
```

**Air density** (computed from user settings on each request):
```
ρ = 0.0765 × (519 / (460 + T_F)) × exp(−h_ft / 25000)
```
where 0.0765 lb/ft³ is standard sea-level density at 59°F, the first factor is a temperature (Rankine) correction, and the second is a barometric altitude correction.

At the defaults (900 ft, 70°F): ρ ≈ 0.0723 lb/ft³ — about 5.5% thinner than sea-level standard, producing roughly +5% carry vs. a sea-level baseline.

**Fixed constants:**
- Drag coefficient CD = 0.23
- Ball mass m = 0.1012 lb
- Ball radius r = 0.0708 ft (1.68 in diameter)
- Cross-sectional area A = π × r² = 0.01575 ft²

The integration runs until the ball returns to launch height (y ≤ 0). Carry = horizontal distance in yards (ft ÷ 3).

### Total Distance

```
total_distance_adj = carry_distance_adj + raw_roll
```

The raw roll value from Rapsodo is carried forward unchanged. Roll depends on turf conditions and bounce angle, which are not affected by the speed underestimation.

### Smash Factor

```
smash_factor_adj = ball_speed_adj / club_speed_adj
```

### When inputs are missing

If `launch_angle` or `spin_rate` is null for a given shot, `carry_distance_adj` is null. `ball_speed_adj` and `club_speed_adj` are still populated whenever the raw speed is non-null.

---

## API Changes

### New module: `api/corrections.py`

```python
PCT_CLUB:   dict[str, float]   # club_type → fractional club speed correction (e.g. 0.014)
PCT_BALL:   dict[str, float]   # club_type → fractional ball speed correction (e.g. 0.020)
CARRY_MULT: dict[str, float]   # club_type → carry multiplier for stats aggregation

def air_density(elevation_ft: float, temperature_f: float) -> float
def apply_shot_correction(shot: Shot, elevation_ft: float, temperature_f: float) -> CorrectedShot
def estimate_carry(
    ball_speed_mph: float,
    launch_angle_deg: float,
    spin_rate_rpm: float,
    elevation_ft: float = 900.0,
    temperature_f: float = 70.0,
) -> float | None
```

`CARRY_MULT` is used by the stats endpoint as a multiplicative approximation (see below). It is derived from the ball speed percentage using a ~1.7 power-law relationship between ball speed and carry:

```
CARRY_MULT = 1 + 1.7 × PCT_BALL
```

Approximate values:
- Driver: 1.034  (1 + 1.7 × 0.020)
- Fairway/hybrid: 1.032  (1 + 1.7 × 0.019)
- Irons/wedges: 1.029  (1 + 1.7 × 0.017)

`CARRY_MULT` captures only the speed-correction contribution to the carry difference. It is calibrated at the default air density (900 ft, 70°F) and does not update when the user changes elevation or temperature. The per-shot physics in the shots endpoint is always computed with the live air density, so the stats endpoint approximation may drift by 1–3 yards if settings deviate substantially from defaults.

### Modified `api/models.py`

Add a `CorrectedShot` model extending `Shot` with five new optional fields:

```python
class CorrectedShot(Shot):
    ball_speed_adj:      Optional[float]   # corrected ball speed (mph)
    club_speed_adj:      Optional[float]   # corrected club speed (mph)
    carry_distance_adj:  Optional[float]   # physics-estimated carry (yds)
    total_distance_adj:  Optional[float]   # carry_adj + raw roll (yds)
    smash_factor_adj:    Optional[float]   # ball_speed_adj / club_speed_adj
```

Raw fields (`ball_speed`, `club_speed`, `carry_distance`, `total_distance`, `smash_factor`) are always returned unchanged — the frontend decides which set to display.

### Schema updates (`db/schema.sql`)

`db/schema.sql` currently defines the **old wide** `swing_effort_thresholds` schema (one row per club type with `anchor_speed`, `full_speed`, `pct75_speed`, etc.). The live DB is already on the new narrow schema (one row per `club_type, bucket_index`) via a runtime migration in `_ensure_schema()`, but `schema.sql` is out of sync. Since `schema.sql` is being edited for `user_settings`, both should be fixed in the same commit:

1. Replace the old `swing_effort_thresholds` definition with the current narrow schema:

```sql
CREATE TABLE IF NOT EXISTS swing_effort_thresholds (
    club_type    TEXT NOT NULL,
    bucket_index INTEGER NOT NULL,
    lower_bound  DOUBLE NOT NULL,
    upper_bound  DOUBLE,
    label        TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (club_type, bucket_index)
);
```

2. Add the `user_settings` table below it (see next section).

### New table: `user_settings` (in `db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS user_settings (
    id           INTEGER PRIMARY KEY DEFAULT 1,
    elevation_ft DOUBLE  NOT NULL DEFAULT 900.0,
    temperature_f DOUBLE NOT NULL DEFAULT 70.0
);
INSERT OR IGNORE INTO user_settings (id) VALUES (1);
```

A single-row table (id = 1 always). The `INSERT OR IGNORE` seed ensures the row exists with defaults after a fresh schema load.

### New router: `api/routes/settings.py`

```
GET  /settings        → { elevation_ft, temperature_f }
PATCH /settings       → body: { elevation_ft?, temperature_f? } → updated settings
```

The PATCH validates that elevation is in [0, 14000] ft and temperature is in [−40, 120]°F.

### Modified `api/routes/shots.py`

Both `/shots/session/{session_id}` and `/shots/club/{club_type}` change their response type from `list[Shot]` to `list[CorrectedShot]`. After fetching the shot rows, the route reads `elevation_ft` and `temperature_f` from `user_settings` (one extra DB query per request), then passes those values to `apply_shot_correction()` for each shot. No changes to the shot SQL queries themselves.

### Modified `api/routes/swing_effort.py`

`GET /swing-effort/matrix` and `GET /swing-effort/histogram/{club_type}` aggregate from raw DB values. A post-processing step applies corrections to the returned aggregates:

- `carry_mean`, `total_mean` → multiply by `CARRY_MULT[club_type]`
- `speed_mean` (club speed per bucket) → multiply by `(1 + PCT_CLUB[club_type])`
- `smash_factor_mean` — left as raw; the ratio `PCT_BALL / PCT_CLUB` differs by at most ~0.3% across club types, a negligible change
- Speed bin *boundaries* in the histogram response remain in raw Rapsodo space — they must stay consistent with the `swing_effort_thresholds` table which was calibrated in raw speed space

### Modified `api/routes/stats.py`

`ClubStats` aggregation continues to operate on raw DB values (no SQL changes). After the query returns, a post-processing step adds four corrected mean fields to each `ClubStats` object:

```python
carry_mean_adj      = carry_mean      * CARRY_MULT[club_type]   # multiplicative approx
total_mean_adj      = total_mean      * CARRY_MULT[club_type]
ball_speed_mean_adj = ball_speed_mean * (1 + PCT_BALL[club_type])
club_speed_mean_adj = club_speed_mean * (1 + PCT_CLUB[club_type])
```

The carry multiplier is an approximation (power-law, not per-shot physics) because the stats endpoint aggregates across many shots and does not iterate them individually. At typical mid-iron distances (~150 yds) the multiplier gives ~+4–5 yards, which is within ~1–2 yards of the shot-level physics result. If higher accuracy is needed in the future, the stats query can be refactored to iterate shots.

`ClubStats` model gains four new optional fields: `carry_mean_adj`, `total_mean_adj`, `ball_speed_mean_adj`, `club_speed_mean_adj`.

---

## Frontend Changes

The frontend receives `CorrectedShot` objects (which are a superset of `Shot`) from the API. All existing code continues to work — the `_adj` fields are simply new optional additions.

### Default display convention

Pages display `_adj` fields by default. Column headers and stat cards that show corrected values are marked with `~` (tilde, meaning "approximate"). A page-level footnote reads:

> `~` Values include an approximate Rapsodo calibration adjustment (~1.2–1.4% club speed, ~1.7–2.0% ball speed, ~3–5% carry). Toggle "Raw" to see Rapsodo-reported values.

A **"Raw / Adjusted" toggle** (small, top-right of each affected page) switches all displays on that page between raw and corrected fields. Toggle state is local per page (no global context needed).

A **Settings modal** (gear icon in the nav bar) lets the user update elevation and temperature. On open it fetches `GET /settings`; on save it calls `PATCH /settings`. The two fields are:
- **Elevation** — number input, unit label "ft", range 0–14,000
- **Temperature** — number input, unit label "°F", range −40–120

After a successful save the page reloads its shot/stats data so carry estimates reflect the new air density. The current elevation and temperature values are shown in the footnote alongside the calibration note, e.g.:

> `~` Values include an approximate Rapsodo calibration adjustment and are computed at 900 ft, 70°F. Toggle "Raw" to see Rapsodo-reported values.

### Pages affected

| Page | Fields switched to `_adj` | Notes |
|---|---|---|
| **SessionSummary** | `carry_distance`, `total_distance`, `ball_speed`, `club_speed` | Shot table columns |
| **SessionClubs** | Same four + stat summary cards | Scatter plot y-axis if carry |
| **ClubDashboard** | StatCards, trend charts, shot table, dispersion scatter | `club_speed` trend line uses `_adj` points |
| **Gapping** | Carry column, speed columns | Scatter plot axes |
| **Bag** | `ball_speed_mean`, `club_speed_mean` | Summary table |
| **SwingEffort** | `total_distance` | Tooltip and chart axis; histogram carry/total means via `/swing-effort/histogram` |
| **WedgeMatrix** | `carry_mean`, `total_mean`, `speed_mean` | Via `/swing-effort/matrix`; per-bucket corrected means |
| **Compare** | `total_distance` | Scatter y-axis |

### Fields that are NOT corrected (displayed raw, no marker)

These are trusted as-is from Rapsodo:
- `spin_rate`, `spin_axis`
- `launch_angle`, `launch_direction`
- `side_carry` (lateral dispersion)
- `apex`, `descent_angle`
- `attack_angle`, `club_path`
- `swing_effort` bucket (see note below)

---

## Swing Effort Buckets — Note

The `swing_effort` column on each shot stores a **bucket_index** string (e.g., `"3"`) — not a label. Labels like `"Full Effort - E1 (72+ mph)"` and `"E2 (65-72 mph)"` are stored in the `swing_effort_thresholds` table and joined at query time. The thresholds use one row per `(club_type, bucket_index)` with `lower_bound` and `upper_bound` in raw Rapsodo club speed (mph).

Because the thresholds were calibrated from the same underestimated raw club speeds, the relative bucket assignments remain internally consistent — a shot that is "Full Effort" before correction is still "Full Effort" after, because both the shot's speed and the threshold boundary are in the same raw speed space.

Implication: if the `swing_effort` calibration is ever re-run using corrected speeds, the threshold boundaries and all historical bucket assignments would need to be recomputed together. That is a follow-up task, not part of this change.

**`/swing-effort/histogram` and `/swing-effort/matrix` endpoints**: these return per-bucket aggregates including `carry_mean`, `total_mean`, and `speed_mean`. The carry and total means should receive the same multiplicative correction applied to `ClubStats` (using `CARRY_MULT` and `PCT_CLUB` respectively). Speed bin *boundaries* on the histogram remain in raw Rapsodo space — consistent with the thresholds used for calibration display.

---

## What Is Not Changed

- **Existing DB tables** — `shots`, `sessions`, `swing_effort_thresholds` untouched; no column migrations
- **Ingestion pipeline** — `sync.py`, `ingester/`, `scraper/` untouched
- **`stopping_power.py`** — depends on raw carry; not in scope
- **`impute.py`** — club speed imputation uses raw sensor values; corrections layer on top after imputation

---

## Implementation Order

1. `db/schema.sql` — replace old wide `swing_effort_thresholds` definition with current narrow schema; add `user_settings` table + seed row
2. `api/corrections.py` — percentages table + `air_density()` + `estimate_carry()` + `apply_shot_correction()`
3. `api/models.py` — add `CorrectedShot`, `UserSettings`, and corrected fields to `ClubStats`
4. `api/routes/settings.py` — `GET /settings` and `PATCH /settings`
5. `api/main.py` — register the settings router
6. `api/routes/shots.py` — fetch settings then apply correction after DB fetch
7. `api/routes/stats.py` — post-process `ClubStats` with corrected means
8. `api/routes/swing_effort.py` — post-process matrix and histogram carry/total/speed means with corrections
9. Frontend: add `_adj` fields to `Shot` TypeScript type; add `UserSettings` type
10. Frontend: implement `useSettings` hook (`GET /settings` on mount, `PATCH` on save)
11. Frontend: add Settings modal with elevation + temperature inputs, wired to gear icon in nav
12. Frontend: implement Raw/Adjusted toggle as a small shared hook or per-page state
13. Frontend: update each page to use `_adj` fields by default with `~` marker (including WedgeMatrix)
14. Frontend: add per-page footnote showing current elevation/temperature and calibration note

---

## Open Questions / Future Work

- **Carry delta accuracy in stats**: the multiplicative approximation could be replaced with shot-level physics once sub-yard accuracy is needed in aggregated stats.
- **User-editable speed offsets**: expose `PCT_CLUB` / `PCT_BALL` via the settings endpoint once more Trackman data is available for recalibration.
- **Session-level conditions**: elevation and temperature are currently global settings. A future extension could allow per-session overrides (e.g., a tournament at altitude vs. home range).
- **Stopping power**: `compute_stopping_power()` uses raw carry. Rerun with corrected carry in a follow-up if stopping-power comparisons are used for club selection.
