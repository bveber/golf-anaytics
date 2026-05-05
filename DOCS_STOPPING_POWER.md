# Stopping Power: Rollout and Flyer Lie Calculations

This document explains how rollout, spinback, and flyer lie estimates are computed
for every shot in the database. All logic lives in `stopping_power.py`.

---

## Overview

The launch monitor records spin rate, descent angle, and ball speed for every shot,
but the total distance it reports reflects a standardised flat surface — not real
greens. This model uses those measured inputs to estimate how a shot actually
behaves after landing: how far it rolls out, whether it checks and spins back, and
how much farther it would carry and roll if hit from a flyer lie.

Three values are stored per shot:

| Column | Description |
|---|---|
| `roll_medium_standard` | Estimated roll on a medium green, standard lie (ft) |
| `roll_medium_flyer` | Estimated roll on a medium green, flyer lie (ft) |
| `flyer_carry_est` | Estimated carry if the shot were hit from a flyer lie (yds) |

Eight additional roll columns cover soft / firm / links surfaces for both lie types.
Positive roll = runs forward. Negative roll = spins back.

---

## Step 1 — Landing Speed

Ball speed decays during flight due to aerodynamic drag. Landing speed is estimated
with an exponential decay model:

```
v_land = ball_speed × exp(−0.0015 × carry_yards)
```

The decay constant (0.0015 per yard) is calibrated so a driver at 169 mph over
270 yards lands at roughly 67% of launch speed (~113 mph), consistent with
published TrackMan data.

---

## Step 2 — Check Ratio

At landing the ball's velocity is split into two components:

```
v_tangent = v_land × cos(descent_angle)   # forward along the surface
v_normal  = v_land × sin(descent_angle)   # into the ground
```

Backspin creates a peripheral speed at the ball's surface that opposes forward
motion:

```
v_spin = (spin_rate × 2π / 60) × ball_radius      # ball_radius = 0.02135 m
```

The **check ratio** is the key dimensionless quantity that determines behaviour:

```
check_ratio = v_spin / v_tangent
```

| check_ratio | Meaning |
|---|---|
| < 0.5 | Spin barely counters forward momentum — significant rollout |
| 0.5 – 1.0 | Spin checks the ball — minimal roll |
| ≥ threshold | Spin dominates — spinback possible |

Typical values from session data:

| Club | Avg spin (RPM) | Avg check_ratio | Avg roll, medium (ft) |
|---|---|---|---|
| d | 2 450 | 0.14 | +11.7 |
| 2h | 3 470 | 0.21 | +8.6 |
| 6i | 6 260 | 0.47 | +3.4 |
| 7i | 6 940 | 0.54 | +2.6 |
| 8i | 7 300 | 0.60 | +2.1 |
| 9i | 8 370 | 0.73 | +1.3 |
| pw | 8 420 | 0.75 | +1.2 |
| gw | 9 360 | 0.88 | +0.7 |
| sw | 9 660 | 1.00 | +0.4 |
| lw | 9 060 | 1.06 | +0.1 |

---

## Step 3 — Roll Calculation

Roll is computed in two regimes depending on whether check_ratio clears the
surface's spinback threshold.

### Forward roll regime (check_ratio < spinback_threshold)

The fraction of tangential landing speed that survives the bounce is controlled by
the surface's **retention** factor, which accounts for energy lost in the high-speed
impact. Retention is very small (4–11%) because most kinetic energy is absorbed by
the turf.

```
v_roll = v_tangent × retention × (1 − check_ratio)
roll_m = v_roll² / (2 × mu_roll × g)
```

### Spinback regime (check_ratio ≥ spinback_threshold)

When spin dominates — either because spin is genuinely high or the surface grabs
more aggressively — the ball checks on first contact and can retract:

```
excess  = check_ratio − spinback_threshold
roll_m  = −min(0.9 m, excess × 1.8 / (mu_roll × g))
```

Spinback is capped at 0.9 m (~3 ft), consistent with observed real-world behaviour.

### Surface profiles

The spinback threshold is lower on soft greens because the turf grabs the ball
more on first contact. Firm surfaces require a much higher check_ratio before the
ball can spin back.

| Surface | Retention | Rolling friction (μ) | Spinback threshold |
|---|---|---|---|
| soft | 0.045 | 0.042 | 0.82 |
| medium | 0.060 | 0.035 | 1.00 |
| firm | 0.080 | 0.028 | 1.22 |
| links | 0.105 | 0.022 | 1.50 |

**Calibration anchors** used to set these constants against real-world behaviour:
- 7i, medium: ~3 ft rollout
- GW, medium: near-zero roll with occasional spinback on soft greens
- LW, soft: spins back

Firmness sensitivity for a median 7i shot:

| Surface | Roll estimate |
|---|---|
| soft | +1.4 ft |
| medium | +2.6 ft |
| firm | +3.0 ft |
| links | +5.5 ft |

---

## Flyer Lie Detection

A flyer lie occurs when grass gets between the clubface and the ball at impact,
reducing friction and suppressing spin transfer by roughly 30%. The result is a
shot that flies farther than expected and rolls out significantly more after landing.

Driver is excluded from flyer detection — anomalously low driver spin is caused by
gear effect from off-centre contact, not by grass interference.

### Detection method

For each club, a spin baseline (mean and standard deviation) is computed from all
clean historical shots. A shot is flagged as a likely flyer when its spin rate
falls more than 1.3 standard deviations below that baseline (approximately the
10th percentile):

```
z = (spin_rate − club_mean) / club_std

if z ≤ −1.3:  lie_type = "flyer"
              confidence = min(0.95, 0.50 + 0.35 × (|z| − 1.3))
```

Confidence scales linearly beyond the threshold: z = −1.3 → 50%, z = −2.3 → 85%,
capped at 95%.

Per-club spin baselines (derived from session data):

| Club | Mean spin (RPM) | Std dev (RPM) | Flyer threshold (RPM) |
|---|---|---|---|
| 2h | 3 412 | 621 | < 2 604 |
| 6i | 5 704 | 456 | < 5 111 |
| 7i | 7 006 | 745 | < 6 037 |
| 8i | 6 685 | 297 | < 6 299 |
| 9i | 8 537 | 843 | < 7 440 |
| pw | 7 907 | 500 | < 7 257 |
| gw | 9 520 | 1 067 | < 8 133 |

These baselines update automatically as more sessions are ingested.

---

## Flyer Roll Estimate

When a shot is modelled as a flyer lie, effective spin is reduced to 70% of the
measured value before computing the check ratio:

```
effective_spin = spin_rate × 0.70
```

This reduced spin is plugged into the same roll formula, producing a lower check
ratio and therefore more forward roll. The `roll_medium_flyer` column shows the
result; `roll_medium_standard` uses the original measured spin.

---

## Flyer Carry Estimate

A flyer also carries farther than a clean-contact shot because reduced spin means
less aerodynamic drag from the Magnus effect. Carry gain scales with check_ratio:
clubs with higher spin (larger check_ratio) lose more spin energy to the Magnus
force, so they benefit more when that spin is suppressed.

```
flyer_carry_est = carry_distance × (1 + min(0.20, check_ratio × 0.15))
```

The gain is capped at 20% to avoid over-extrapolating. Typical carry gains:

| Club | Avg check_ratio | Avg carry gain |
|---|---|---|
| d | 0.14 | — (excluded) |
| 6i | 0.47 | +12.6 yds |
| 7i | 0.54 | +13.9 yds |
| 9i | 0.73 | +16.5 yds |
| gw | 0.88 | +14.6 yds |

Driver is excluded because tee shots are not subject to flyer lie conditions.

---

## Limitations

**Green conditions are approximated.** The four surface profiles (soft / medium /
firm / links) are parameterised estimates. The medium profile is calibrated to
typical parkland conditions based on observed shot behaviour; individual green
firmness on any given day will vary.

**The model is physics-forward, not data-fitted.** There are no real-world roll
measurements to train against — the launch monitor reports roll on a standardised
surface. The roll estimates represent physically-grounded predictions, not
regressions on observed outcomes.

**Driver roll is approximate.** Driver shots land on fairway or rough, not on a
green. The firmness profiles are calibrated for green conditions. Driver roll
estimates use the same physics but should be treated as directional rather than
precise.

**Flyer detection is probabilistic.** The z-score method flags likely flyers based
on spin being below the per-club baseline. It does not distinguish between a true
flyer lie, a thin strike, or a genuinely low-spin swing. Shots flagged with lower
confidence (< 0.70) should be interpreted cautiously.

**Baselines are personal.** Spin baselines are derived from your own session data.
As more sessions accumulate the baselines stabilise and detection improves.
Early sessions with small sample sizes (e.g. 8i, pw) have wider uncertainty.
