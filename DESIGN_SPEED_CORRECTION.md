# Speed Correction & Distance Recalculation Design

## Problem

The Rapsodo launch monitor consistently underestimates ball speed and club speed compared to Trackman data. This causes all carry and total distance values to be low. The correction is additive (constant offset per club type group), not a percentage, because the underestimation is roughly consistent across the speed range within each group.

Raw Rapsodo values are never modified in the database. All corrections are applied at API response time, making this fully reversible.

---

## Correction Offsets

Hardcoded in a new module `api/corrections.py`. Values are midpoints of the observed ranges, interpolated for club types without direct Trackman comparisons.

| Club Group | Club Types | Club Speed Delta | Ball Speed Delta |
|---|---|---|---|
| Driver | `d` | +1.5 mph | +3.0 mph |
| Fairway Wood | `fw` | +1.25 mph | +2.5 mph |
| Hybrid | `h`, `2h`, `3h` | +1.25 mph | +2.5 mph |
| Irons & Wedges | `i`, `w`, `sw`, `pw`, `lw`, `aw` | +1.0 mph | +2.0 mph |

Any unrecognized `club_type` receives the irons/wedges correction as a conservative default.

Rationale for midpoints:
- **Driver**: observed 1–2 mph club speed error, 2–4 mph ball speed error → +1.5 / +3.0
- **Fairway woods / hybrids**: no direct data; interpolated halfway between driver and irons
- **Irons & wedges**: directly observed +1.0 / +2.0

---

## Carry Recalculation — Physics Model

Because Rapsodo's own carry values are derived from its underestimated speeds, we cannot simply scale those numbers. Instead, carry is recomputed from first principles using the corrected inputs.

### Inputs
- Corrected ball speed (mph)
- Launch angle (degrees)
- Spin rate (rpm) — raw Rapsodo value, trusted as-is

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

**Constants:**
- Air density ρ = 0.0765 lb/ft³ (sea level, ~70°F)
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
CLUB_SPEED_DELTA: dict[str, float]   # club_type → mph offset
BALL_SPEED_DELTA: dict[str, float]   # club_type → mph offset
CARRY_DELTA_EST:  dict[str, float]   # club_type → approximate carry yards offset (for stats aggregation)

def apply_shot_correction(shot: Shot) -> CorrectedShot
def estimate_carry(ball_speed_mph, launch_angle_deg, spin_rate_rpm) -> float | None
```

`CARRY_DELTA_EST` is used by the stats endpoint as a linear approximation (see below). Approximate values:
- Driver: ~7.5 yds (3.0 mph ball speed × ~2.5 yds/mph)
- Fairway/hybrid: ~6.0 yds
- Irons/wedges: ~5.0 yds

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

### Modified `api/routes/shots.py`

Both `/shots/session/{session_id}` and `/shots/club/{club_type}` change their response type from `list[Shot]` to `list[CorrectedShot]`. After fetching rows from DB, each `Shot` is passed through `apply_shot_correction()` before serialization. No SQL changes.

### Modified `api/routes/stats.py`

`ClubStats` aggregation continues to operate on raw DB values (no SQL changes). After the query returns, a post-processing step adds four corrected mean fields to each `ClubStats` object:

```python
carry_mean_adj      = carry_mean  + CARRY_DELTA_EST[club_type]   # linear approx
total_mean_adj      = total_mean  + CARRY_DELTA_EST[club_type]
ball_speed_mean_adj = ball_speed_mean + BALL_SPEED_DELTA[club_type]
club_speed_mean_adj = club_speed_mean + CLUB_SPEED_DELTA[club_type]
```

The carry delta is an approximation (linear, not physics-modeled) because the stats endpoint aggregates across many shots and does not iterate them individually. The approximation is within ~1–2 yards of the shot-level physics result for typical mid-iron conditions. If higher accuracy is needed in the future, the stats query can be refactored to iterate shots.

`ClubStats` model gains four new optional fields: `carry_mean_adj`, `total_mean_adj`, `ball_speed_mean_adj`, `club_speed_mean_adj`.

---

## Frontend Changes

The frontend receives `CorrectedShot` objects (which are a superset of `Shot`) from the API. All existing code continues to work — the `_adj` fields are simply new optional additions.

### Default display convention

Pages display `_adj` fields by default. Column headers and stat cards that show corrected values are marked with `~` (tilde, meaning "approximate"). A page-level footnote reads:

> `~` Values include an approximate Rapsodo calibration adjustment (+1–3 mph speeds, +5–8 yds carry). Toggle "Raw" to see Rapsodo-reported values.

A **"Raw / Adjusted" toggle** (small, top-right of each affected page) switches all displays on that page between raw and corrected fields. Toggle state is local per page (no global context needed).

### Pages affected

| Page | Fields switched to `_adj` | Notes |
|---|---|---|
| **SessionSummary** | `carry_distance`, `total_distance`, `ball_speed`, `club_speed` | Shot table columns |
| **SessionClubs** | Same four + stat summary cards | Scatter plot y-axis if carry |
| **ClubDashboard** | StatCards, trend charts, shot table, dispersion scatter | `club_speed` trend line uses `_adj` points |
| **Gapping** | Carry column, speed columns | Scatter plot axes |
| **Bag** | `ball_speed_mean`, `club_speed_mean` | Summary table |
| **SwingEffort** | `total_distance` | Tooltip and chart axis |
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

The `swing_effort` label (`100-80`, `80-60`, etc.) is assigned by comparing raw `club_speed` against thresholds in the `swing_effort_thresholds` table. Those thresholds were derived from the same underestimated Rapsodo data, so the relative bucket assignments remain internally consistent — every shot that was "100-80" before is still "100-80" after.

Implication: if you recalibrate the `swing_effort_thresholds` table using corrected speeds in the future, the historical bucket labels on existing shots would need to be recomputed. This is a follow-up task, not part of this change.

---

## What Is Not Changed

- **Database schema** — no new columns, no migration needed
- **Ingestion pipeline** — `sync.py`, `ingester/`, `scraper/` untouched
- **`stopping_power.py`** — depends on raw carry; could be updated in a follow-up to use `_adj` carry values
- **`impute.py`** — club speed imputation uses raw sensor values; corrections are layered on top after imputation

---

## Implementation Order

1. `api/corrections.py` — offsets table + `estimate_carry()` + `apply_shot_correction()`
2. `api/models.py` — add `CorrectedShot` and corrected fields to `ClubStats`
3. `api/routes/shots.py` — apply correction after DB fetch
4. `api/routes/stats.py` — post-process `ClubStats` with corrected means
5. Frontend: add `_adj` fields to `Shot` TypeScript type
6. Frontend: implement Raw/Adjusted toggle as a small shared hook or per-page state
7. Frontend: update each page to use `_adj` fields by default with `~` marker
8. Frontend: add per-page footnote explaining the adjustment

---

## Open Questions / Future Work

- **Altitude correction**: the physics model uses sea-level air density. If sessions are recorded at elevation, carry estimates will be slightly low. Could add a session-level altitude input.
- **Temperature correction**: air density varies with temperature, affecting carry by ~1–2% per 10°F. Low priority.
- **Carry delta accuracy**: the linear approximation in the stats endpoint could be replaced with shot-level physics once there is a need for sub-yard accuracy in aggregated stats.
- **User-editable offsets**: expose the correction table via a settings API endpoint and UI page once the values are better calibrated with more Trackman data.
- **Stopping power**: `compute_stopping_power()` uses raw carry. Rerun with corrected carry in a follow-up if stopping-power comparisons are used for club selection.
