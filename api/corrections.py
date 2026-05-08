from __future__ import annotations

import math
from typing import Optional

# Fractional corrections by club type group
PCT_CLUB: dict[str, float] = {
    "d":  0.014,   # Driver
    "fw": 0.013,   # Fairway wood
    "h":  0.013,   # Hybrid
    "2h": 0.013,
    "3h": 0.013,
    "i":  0.012,   # Irons
    "w":  0.012,   # Wedges
    "sw": 0.012,
    "pw": 0.012,
    "lw": 0.012,
    "aw": 0.012,
}

PCT_BALL: dict[str, float] = {
    "d":  0.020,
    "fw": 0.019,
    "h":  0.019,
    "2h": 0.019,
    "3h": 0.019,
    "i":  0.017,
    "w":  0.017,
    "sw": 0.017,
    "pw": 0.017,
    "lw": 0.017,
    "aw": 0.017,
}

# Approximate carry multiplier for empirical carry correction (1 + 1.7 * PCT_BALL)
CARRY_MULT: dict[str, float] = {
    ct: 1 + 1.7 * pct for ct, pct in PCT_BALL.items()
}

CARRY_BOUNDS: dict[str, tuple[float, float]] = {
    "d":  (100, 380),
    "fw": ( 90, 335),
    "h":  ( 80, 290),
    "2h": ( 80, 280),
    "3h": ( 80, 270),
    "i":  ( 50, 260),
    "w":  ( 20, 175),
    "sw": ( 20, 155),
    "pw": ( 30, 165),
    "lw": ( 15, 130),
    "aw": ( 30, 160),
}
_DEFAULT_CARRY_BOUNDS = (20, 400)

_RHO_STANDARD = 0.0765  # lb/ft³ sea level 59°F

_DEFAULT_PCT_CLUB = 0.012
_DEFAULT_PCT_BALL = 0.017
_DEFAULT_CARRY_MULT = 1 + 1.7 * _DEFAULT_PCT_BALL


def _pct_club(club_type: Optional[str]) -> float:
    return PCT_CLUB.get(club_type or "", _DEFAULT_PCT_CLUB)


def _pct_ball(club_type: Optional[str]) -> float:
    return PCT_BALL.get(club_type or "", _DEFAULT_PCT_BALL)


def _carry_mult(club_type: Optional[str]) -> float:
    return CARRY_MULT.get(club_type or "", _DEFAULT_CARRY_MULT)


def air_density(elevation_ft: float, temperature_f: float) -> float:
    """Air density in lb/ft³ using barometric + temperature correction."""
    return 0.0765 * (519.0 / (460.0 + temperature_f)) * math.exp(-elevation_ft / 25000.0)


def apply_shot_correction(
    shot: object,
    elevation_ft: float = 900.0,
    temperature_f: float = 70.0,
) -> dict:
    """Return a dict of corrected _adj fields to merge onto a Shot response.
    shot can be a Shot model instance or a dict with the required keys.

    Empirical formula:
      ball_speed_adj = ball_speed * (1 + PCT_BALL[club_type])
      club_speed_adj = club_speed * (1 + PCT_CLUB[club_type])
      carry_adj = raw_carry * CARRY_MULT[club_type] * sqrt(rho_standard / rho_user)
      carry_adj = max(carry_adj, raw_carry)  — always increase
      total_distance_adj = carry_distance_adj + original_roll
    """
    if hasattr(shot, "club_type"):
        club_type = shot.club_type
        ball_speed = shot.ball_speed
        club_speed = shot.club_speed
        carry_distance = shot.carry_distance
        total_distance = shot.total_distance
    else:
        club_type = shot.get("club_type")
        ball_speed = shot.get("ball_speed")
        club_speed = shot.get("club_speed")
        carry_distance = shot.get("carry_distance")
        total_distance = shot.get("total_distance")

    pc = _pct_club(club_type)
    pb = _pct_ball(club_type)
    cm = _carry_mult(club_type)

    ball_speed_adj = (ball_speed * (1 + pb)) if ball_speed is not None else None
    club_speed_adj = (club_speed * (1 + pc)) if club_speed is not None else None

    smash_factor_adj: Optional[float] = None
    if ball_speed_adj is not None and club_speed_adj is not None and club_speed_adj > 0:
        smash_factor_adj = ball_speed_adj / club_speed_adj

    carry_distance_adj: Optional[float] = None
    if carry_distance is not None:
        rho_user = air_density(elevation_ft, temperature_f)
        altitude_factor = math.sqrt(_RHO_STANDARD / rho_user)
        raw_adj = carry_distance * cm * altitude_factor
        lo, hi = CARRY_BOUNDS.get(club_type or "", _DEFAULT_CARRY_BOUNDS)
        bounded = max(lo, min(hi, raw_adj))
        # Always increase relative to raw carry — never let correction reduce carry
        carry_distance_adj = round(max(bounded, carry_distance), 1)

    total_distance_adj: Optional[float] = None
    if carry_distance_adj is not None and total_distance is not None and carry_distance is not None:
        roll = total_distance - carry_distance
        total_distance_adj = round(carry_distance_adj + roll, 1)

    return {
        "ball_speed_adj": round(ball_speed_adj, 1) if ball_speed_adj is not None else None,
        "club_speed_adj": round(club_speed_adj, 1) if club_speed_adj is not None else None,
        "carry_distance_adj": carry_distance_adj,
        "total_distance_adj": total_distance_adj,
        "smash_factor_adj": round(smash_factor_adj, 3) if smash_factor_adj is not None else None,
    }
