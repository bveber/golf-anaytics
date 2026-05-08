from __future__ import annotations

import pytest

from api.corrections import apply_shot_correction, air_density, CARRY_BOUNDS, PCT_BALL


def test_carry_always_increases():
    """Corrected carry must never be less than raw carry."""
    for club_type in ["d", "fw", "i", "w", "sw", "pw"]:
        for raw_carry in [80.0, 130.0, 175.0, 220.0, 260.0]:
            shot = {
                "club_type": club_type,
                "ball_speed": 120.0,
                "club_speed": 85.0,
                "carry_distance": raw_carry,
                "total_distance": raw_carry + 10.0,
            }
            result = apply_shot_correction(shot)
            adj = result["carry_distance_adj"]
            assert adj is not None
            assert adj >= raw_carry, f"{club_type} @ {raw_carry}: adj {adj} < raw {raw_carry}"


def test_speed_corrects_upward():
    shot = {"club_type": "i", "ball_speed": 120.0, "club_speed": 85.0,
            "carry_distance": 165.0, "total_distance": 175.0}
    r = apply_shot_correction(shot)
    assert r["ball_speed_adj"] > 120.0
    assert r["club_speed_adj"] > 85.0


def test_carry_within_bounds():
    """Carry adj from realistic raw inputs stays within CARRY_BOUNDS."""
    # Use a raw carry near the middle of each club type's range so
    # the "always increase" floor doesn't push us past the upper bound.
    _TYPICAL_RAW: dict[str, float] = {
        "d": 220.0, "fw": 190.0, "h": 170.0, "2h": 165.0, "3h": 160.0,
        "i": 140.0, "w": 100.0, "sw": 90.0, "pw": 110.0, "lw": 75.0, "aw": 105.0,
    }
    for club_type, (lo, hi) in CARRY_BOUNDS.items():
        raw = _TYPICAL_RAW[club_type]
        shot = {"club_type": club_type, "ball_speed": 100.0, "club_speed": 70.0,
                "carry_distance": raw, "total_distance": raw + 10.0}
        r = apply_shot_correction(shot)
        adj = r["carry_distance_adj"]
        assert adj is not None
        assert lo <= adj <= hi, f"{club_type}: adj {adj} outside [{lo}, {hi}]"


def test_altitude_increases_carry():
    shot = {"club_type": "i", "ball_speed": 120.0, "club_speed": 85.0,
            "carry_distance": 165.0, "total_distance": 175.0}
    sea_level = apply_shot_correction(shot, elevation_ft=0, temperature_f=59.0)
    high_alt   = apply_shot_correction(shot, elevation_ft=5000, temperature_f=70.0)
    assert high_alt["carry_distance_adj"] > sea_level["carry_distance_adj"]


def test_missing_ball_speed():
    shot = {"club_type": "i", "ball_speed": None, "club_speed": 85.0,
            "carry_distance": 165.0, "total_distance": 175.0}
    r = apply_shot_correction(shot)
    assert r["ball_speed_adj"] is None
    assert r["smash_factor_adj"] is None


def test_missing_carry():
    shot = {"club_type": "i", "ball_speed": 120.0, "club_speed": 85.0,
            "carry_distance": None, "total_distance": 175.0}
    r = apply_shot_correction(shot)
    assert r["carry_distance_adj"] is None
    assert r["total_distance_adj"] is None


def test_total_distance_preserves_roll():
    """total_distance_adj = carry_distance_adj + original roll."""
    raw_carry, raw_total = 165.0, 180.0
    roll = raw_total - raw_carry  # 15 yards
    shot = {"club_type": "i", "ball_speed": 120.0, "club_speed": 85.0,
            "carry_distance": raw_carry, "total_distance": raw_total}
    r = apply_shot_correction(shot)
    assert r["carry_distance_adj"] is not None
    assert r["total_distance_adj"] is not None
    assert abs((r["total_distance_adj"] - r["carry_distance_adj"]) - roll) < 0.01


def test_carry_correction_small_delta():
    """Speed correction is ~1.7-2%, so carry should change by <8%."""
    for club_type, pb in PCT_BALL.items():
        raw = 160.0
        shot = {"club_type": club_type, "ball_speed": 110.0, "club_speed": 78.0,
                "carry_distance": raw, "total_distance": raw + 12.0}
        r = apply_shot_correction(shot, elevation_ft=0, temperature_f=59.0)
        adj = r["carry_distance_adj"]
        assert adj is not None
        # at sea level, altitude_factor = 1.0 so only speed correction applies
        delta_pct = (adj - raw) / raw
        assert 0 <= delta_pct < 0.08, f"{club_type}: delta={delta_pct*100:.1f}%"
