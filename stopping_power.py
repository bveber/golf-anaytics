"""
Stopping power estimation: predicts roll-out or spin-back after landing.

Physics model:
  - Landing speed via exponential drag decay (k=0.0015/yd, calibrated for golf balls)
  - Check ratio: backspin peripheral speed vs forward tangential speed at landing
  - Two-regime output: forward roll when spin < forward momentum, spinback when spin dominates
  - Calibrated to medium-soft conditions: 7i ≈ 3 ft rollout, GW ≈ near-zero/slight spinback

Surface profiles represent green conditions. Driver roll is on fairway/rough
(same physics, different firmness baseline — treat as approximate).

Lie type:
  - Flyer detection uses per-club spin z-score vs historical baseline
  - Driver excluded: anomalously low driver spin is gear effect (off-center), not a flyer lie
  - Flyer spin is modeled as 70% of measured spin (grass reduces face contact)
"""

import math
from dataclasses import dataclass
from typing import Literal

BALL_RADIUS_M = 0.02135
G_MS2 = 9.81
MPH_TO_MS = 0.44704

# Drag decay constant per yard of carry
# Calibrated so driver (169 mph) lands at ~67% launch speed over 270 yds
DRAG_K = 0.0015

# Per-club spin baselines (mean, std RPM) from session data
# Driver excluded from flyer detection — low spin is gear effect, not lie type
CLUB_SPIN_BASELINE: dict[str, tuple[float, float]] = {
    "2h": (3412, 621),
    "6i": (5704, 456),
    "7i": (7006, 745),
    "8i": (6685, 297),
    "9i": (8537, 843),
    "pw": (7907, 500),
    "gw": (9520, 1067),
}

FLYER_SPIN_FACTOR = 0.70       # flyer reduces spin transfer by ~30%
FLYER_ZSCORE_THRESHOLD = -1.3  # z < -1.3 → likely flyer (~10th percentile)

# Surface profiles: (tangential_retention, rolling_friction_coeff, spinback_threshold)
# tangential_retention: fraction of tangential landing speed that becomes roll speed
# rolling_friction_coeff: deceleration per unit g during roll phase
# spinback_threshold: check_ratio above which spinback can occur (softer = grabs earlier)
FIRMNESS_PROFILES: dict[str, tuple[float, float, float]] = {
    "soft":   (0.045, 0.042, 0.82),
    "medium": (0.060, 0.035, 1.00),
    "firm":   (0.080, 0.028, 1.22),
    "links":  (0.105, 0.022, 1.50),
}

SPINBACK_FACTOR = 1.8   # empirical: maps excess check_ratio to spinback energy (m²/s²)
MAX_SPINBACK_M = 0.9    # ~3 ft cap; real spinback rarely exceeds this


def roll_from_components(
    v_tangent_ms: float,
    check_ratio: float,
    firmness: Literal["soft", "medium", "firm", "links"],
    lie: Literal["standard", "flyer"] = "standard",
) -> float:
    """
    Compute roll in feet given pre-computed v_tangent and check_ratio.
    Flyer lie reduces effective check_ratio by FLYER_SPIN_FACTOR.
    """
    effective_ratio = check_ratio * (FLYER_SPIN_FACTOR if lie == "flyer" else 1.0)
    retention, mu_roll, spinback_threshold = FIRMNESS_PROFILES[firmness]
    if effective_ratio < spinback_threshold:
        v_roll = v_tangent_ms * retention * max(0.0, 1.0 - effective_ratio)
        roll_m = v_roll ** 2 / (2 * mu_roll * G_MS2)
    else:
        excess = effective_ratio - spinback_threshold
        roll_m = -min(MAX_SPINBACK_M, excess * SPINBACK_FACTOR / (mu_roll * G_MS2))
    return round(roll_m * 3.28084, 1)


def flyer_carry_est(carry_yards: float, check_ratio: float) -> float:
    """
    Estimated carry from a flyer lie given a standard-lie shot.
    Spin drag contribution scales with check_ratio, so high-spin clubs
    (large check_ratio) gain the most carry from spin reduction.
    Capped at +20% to avoid extrapolating beyond observed flyer behaviour.
    """
    factor = 1.0 + min(0.20, check_ratio * 0.15)
    return round(carry_yards * factor, 1)


@dataclass
class StoppingPowerResult:
    roll_feet: float            # positive = rollout, negative = spinback
    lie_type: Literal["standard", "flyer"]
    flyer_confidence: float     # 0–1
    landing_speed_mph: float
    check_ratio: float          # spin dominance ratio; >1 means spinback regime


def estimate_lie_type(
    spin_rate: float,
    club: str,
) -> tuple[Literal["standard", "flyer"], float]:
    """
    Returns (lie_type, flyer_confidence).
    Driver always returns ("standard", 0.0) — low driver spin is a mis-hit, not a flyer.
    """
    if club.lower() == "d":
        return "standard", 0.0

    baseline = CLUB_SPIN_BASELINE.get(club.lower())
    if baseline is None or spin_rate <= 0:
        return "standard", 0.0

    mean, std = baseline
    z = (spin_rate - mean) / std

    if z <= FLYER_ZSCORE_THRESHOLD:
        # Confidence scales with how far below threshold
        confidence = min(0.95, 0.50 + 0.35 * (abs(z) - abs(FLYER_ZSCORE_THRESHOLD)))
        return "flyer", round(confidence, 2)

    return "standard", 0.0


def _landing_speed_mph(ball_speed_mph: float, carry_yards: float) -> float:
    return ball_speed_mph * math.exp(-DRAG_K * carry_yards)


def estimate_roll(
    spin_rate: float,
    descent_angle: float,
    ball_speed: float,
    carry: float,
    club: str = "7i",
    firmness: Literal["soft", "medium", "firm", "links"] = "medium",
    lie_override: Literal["standard", "flyer", "auto"] = "auto",
) -> StoppingPowerResult:
    """
    Estimate roll distance in feet after landing.

    Parameters
    ----------
    spin_rate     : RPM (backspin positive)
    descent_angle : degrees, positive = descending
    ball_speed    : mph at launch
    carry         : yards
    club          : club code, e.g. "7i", "d", "gw"
    firmness      : surface preset — calibrated for green conditions
    lie_override  : "auto" uses spin-based detection; or force "standard"/"flyer"
    """
    retention, mu_roll, spinback_threshold = FIRMNESS_PROFILES[firmness]

    # Lie type
    if lie_override == "auto":
        lie_type, flyer_conf = estimate_lie_type(spin_rate, club)
    else:
        lie_type = lie_override
        flyer_conf = 1.0 if lie_override == "flyer" else 0.0

    effective_spin = spin_rate * (FLYER_SPIN_FACTOR if lie_type == "flyer" else 1.0)

    # Landing velocity components
    v_land_mph = _landing_speed_mph(ball_speed, carry)
    v_land_ms = v_land_mph * MPH_TO_MS
    theta = math.radians(descent_angle)
    v_tangent = v_land_ms * math.cos(theta)   # forward along surface

    # Spin peripheral speed at ball surface (backspin opposes forward motion)
    omega = effective_spin * (2 * math.pi / 60)
    v_spin = omega * BALL_RADIUS_M

    check_ratio = v_spin / max(v_tangent, 0.1)

    if check_ratio < spinback_threshold:
        # Forward roll regime: spin reduces but doesn't stop forward motion
        v_roll = v_tangent * retention * max(0.0, 1.0 - check_ratio)
        roll_m = v_roll ** 2 / (2 * mu_roll * G_MS2)
    else:
        # Spinback regime: spin dominates on this surface
        excess = check_ratio - spinback_threshold
        roll_m = -min(MAX_SPINBACK_M, excess * SPINBACK_FACTOR / (mu_roll * G_MS2))

    return StoppingPowerResult(
        roll_feet=round(roll_m * 3.28084, 1),
        lie_type=lie_type,
        flyer_confidence=flyer_conf,
        landing_speed_mph=round(v_land_mph, 1),
        check_ratio=round(check_ratio, 3),
    )


if __name__ == "__main__":
    import pandas as pd
    from pathlib import Path

    dfs = [pd.read_csv(f) for f in Path("backups/sessions").glob("*.csv")]
    df = pd.concat(dfs, ignore_index=True)
    df.columns = df.columns.str.strip().str.replace(" ", "_").str.lower()
    df = df.rename(columns={
        "club_type": "club", "spin_rate": "spin", "descent_angle": "descent",
        "ball_speed": "bs", "carry_distance": "carry",
    })
    df = df.dropna(subset=["spin", "descent", "bs", "carry"])
    df = df[df["spin"] > 0]

    rows = []
    for _, row in df.iterrows():
        r = estimate_roll(
            spin_rate=row["spin"], descent_angle=row["descent"],
            ball_speed=row["bs"], carry=row["carry"],
            club=str(row["club"]), firmness="medium",
        )
        rows.append({
            "club": row["club"], "spin": row["spin"],
            "descent": row["descent"], "carry": row["carry"],
            "lie": r.lie_type, "flyer_conf": r.flyer_confidence,
            "check_ratio": r.check_ratio, "roll_ft": r.roll_feet,
        })

    out = pd.DataFrame(rows)

    print("=== Roll estimates by club — medium firmness (green conditions) ===")
    summary = out.groupby("club").agg(
        n=("roll_ft", "count"),
        roll_mean=("roll_ft", "mean"),
        roll_std=("roll_ft", "std"),
        roll_min=("roll_ft", "min"),
        roll_max=("roll_ft", "max"),
        spinbacks=("roll_ft", lambda x: (x < 0).sum()),
        flyers=("lie", lambda x: (x == "flyer").sum()),
    ).round(1)
    print(summary.to_string())

    print("\n=== Firmness comparison — per club, standard lie, median shot ===")
    for club in ["d", "7i", "9i", "gw"]:
        sub = out[out["club"] == club]
        if sub.empty:
            continue
        med = df[df["club"] == club].median(numeric_only=True)
        print(f"\n  {club} (spin={med['spin']:.0f}, descent={med['descent']:.1f}°, carry={med['carry']:.0f}yds):")
        for fm in ["soft", "medium", "firm", "links"]:
            r = estimate_roll(
                spin_rate=med["spin"], descent_angle=med["descent"],
                ball_speed=med["bs"], carry=med["carry"],
                club=club, firmness=fm, lie_override="standard",
            )
            print(f"    {fm:>8s}: {r.roll_feet:+5.1f} ft  (check_ratio={r.check_ratio:.3f})")

    print("\n=== Flyer vs standard lie comparison — 7i and 9i ===")
    for club in ["7i", "9i"]:
        med = df[df["club"] == club].median(numeric_only=True)
        std_r = estimate_roll(med["spin"], med["descent"], med["bs"], med["carry"], club=club, lie_override="standard")
        fly_r = estimate_roll(med["spin"], med["descent"], med["bs"], med["carry"], club=club, lie_override="flyer")
        print(f"  {club}: standard={std_r.roll_feet:+.1f} ft  flyer={fly_r.roll_feet:+.1f} ft  "
              f"(flyer spin={med['spin']*FLYER_SPIN_FACTOR:.0f} vs {med['spin']:.0f} RPM)")

    print("\n=== Flagged flyer lies (confidence ≥ 0.5) ===")
    flyers = out[out["flyer_conf"] >= 0.5].sort_values("flyer_conf", ascending=False)
    print(flyers[["club", "spin", "descent", "carry", "check_ratio", "flyer_conf", "roll_ft"]].to_string(index=False))
