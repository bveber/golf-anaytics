"""
Imputes club_speed for shots where smash_factor > 1.5 (bad sensor readings).

Uses IterativeImputer with GradientBoostingRegressor — the best-performing
config identified by analysis_imputation.py across a grid of models, scalers,
and feature subsets (5-fold CV on 506 clean shots, MAE 2.24 mph).

Trains on the full history of clean shots each call so accuracy improves
as more data accumulates.
"""

from __future__ import annotations

import copy

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer

from db import get_connection

FEATURES = [
    "ball_speed",
    "spin_axis",
    "launch_angle",
    "attack_angle",
    "launch_direction",
    "descent_angle",
]
_FEATURE_NOT_NULL = " AND ".join(f"{f} IS NOT NULL" for f in FEATURES)

_ESTIMATOR = GradientBoostingRegressor(n_estimators=50, random_state=42)


def _build_imputer() -> IterativeImputer:
    return IterativeImputer(
        estimator=copy.deepcopy(_ESTIMATOR),
        max_iter=5,
        initial_strategy="median",
        random_state=42,
    )


def impute_club_speeds() -> int:
    """
    Impute club_speed (and recompute smash_factor) for all shots with
    smash_factor > 1.5.  Trains on the full history of clean shots each call.
    Returns the number of shots updated.
    """
    conn = get_connection()

    train_rows = conn.execute(
        f"""
        SELECT club_speed, {', '.join(FEATURES)}
        FROM shots
        WHERE smash_factor <= 1.5
          AND club_speed_imputed = false
          AND club_speed IS NOT NULL
          AND {_FEATURE_NOT_NULL}
        """
    ).fetchall()

    if len(train_rows) < 5:
        return 0

    # IterativeImputer operates on the full matrix (features + target together).
    # Target is placed last; during prediction we mask it with NaN.
    X_train = np.array([[r[i + 1] for i in range(len(FEATURES))] + [r[0]] for r in train_rows])

    imp = _build_imputer()
    imp.fit(X_train)

    bad_rows = conn.execute(
        f"""
        SELECT shot_id, ball_speed, club_speed, smash_factor, {', '.join(FEATURES)}
        FROM shots
        WHERE smash_factor > 1.5
          AND ball_speed IS NOT NULL
          AND {_FEATURE_NOT_NULL}
        """
    ).fetchall()

    if not bad_rows:
        return 0

    shot_ids    = [r[0] for r in bad_rows]
    ball_speeds = [r[1] for r in bad_rows]
    orig_speeds = [r[2] for r in bad_rows]
    orig_sfs    = [r[3] for r in bad_rows]

    # Build masked matrix: features present, club_speed (last col) = NaN
    X_bad = np.array([[r[i + 4] for i in range(len(FEATURES))] + [np.nan] for r in bad_rows])
    imputed_speeds = imp.transform(X_bad)[:, -1]

    updates = [
        (
            float(imp_spd),
            float(bs) / float(imp_spd) if imp_spd > 0 else None,
            orig_spd,
            orig_sf,
            sid,
        )
        for sid, bs, orig_spd, orig_sf, imp_spd in zip(
            shot_ids, ball_speeds, orig_speeds, orig_sfs, imputed_speeds
        )
    ]
    conn.executemany(
        """
        UPDATE shots
        SET club_speed         = ?,
            smash_factor       = ?,
            club_speed_raw     = ?,
            smash_factor_raw   = ?,
            club_speed_imputed = true
        WHERE shot_id = ?
        """,
        updates,
    )

    return len(updates)


def reimpute_all_flagged() -> int:
    """
    Re-run imputation on shots already marked club_speed_imputed=true using
    the current model and feature set.  Call this after changing the model or
    features to bring previously imputed values in line with the new config.
    Returns the number of shots updated.
    """
    conn = get_connection()

    train_rows = conn.execute(
        f"""
        SELECT club_speed, {', '.join(FEATURES)}
        FROM shots
        WHERE smash_factor <= 1.5
          AND club_speed_imputed = false
          AND club_speed IS NOT NULL
          AND {_FEATURE_NOT_NULL}
        """
    ).fetchall()

    if len(train_rows) < 5:
        return 0

    X_train = np.array([[r[i + 1] for i in range(len(FEATURES))] + [r[0]] for r in train_rows])
    imp = _build_imputer()
    imp.fit(X_train)

    flagged_rows = conn.execute(
        f"""
        SELECT shot_id, ball_speed, {', '.join(FEATURES)}
        FROM shots
        WHERE club_speed_imputed = true
          AND ball_speed IS NOT NULL
          AND {_FEATURE_NOT_NULL}
        """
    ).fetchall()

    if not flagged_rows:
        return 0

    shot_ids    = [r[0] for r in flagged_rows]
    ball_speeds = [r[1] for r in flagged_rows]
    X_flagged = np.array([[r[i + 2] for i in range(len(FEATURES))] + [np.nan] for r in flagged_rows])
    imputed_speeds = imp.transform(X_flagged)[:, -1]

    updates = [
        (float(imp_spd), float(bs) / float(imp_spd) if imp_spd > 0 else None, sid)
        for sid, bs, imp_spd in zip(shot_ids, ball_speeds, imputed_speeds)
    ]
    conn.executemany(
        "UPDATE shots SET club_speed = ?, smash_factor = ? WHERE shot_id = ?",
        updates,
    )

    return len(updates)


_FIRMNESS_LIST = ("soft", "medium", "firm", "links")
_LIE_LIST = ("standard", "flyer")

_ROLL_COLS = [f"roll_{f}_{l}" for f in _FIRMNESS_LIST for l in _LIE_LIST]
_SP_UPDATE_SQL = """
    UPDATE shots SET
        lie_type = ?, flyer_confidence = ?, check_ratio = ?,
        roll_soft_standard = ?, roll_medium_standard = ?,
        roll_firm_standard = ?, roll_links_standard = ?,
        roll_soft_flyer    = ?, roll_medium_flyer    = ?,
        roll_firm_flyer    = ?, roll_links_flyer     = ?,
        flyer_carry_est    = ?
    WHERE shot_id = ?
"""


def compute_stopping_power(shot_ids: list[str] | None = None) -> int:
    """
    Compute and store all stopping power derived columns:
      lie_type, flyer_confidence, check_ratio,
      roll_{soft|medium|firm|links}_{standard|flyer},
      flyer_carry_est.

    When shot_ids is provided, recomputes those shots unconditionally (used
    during ingest). Otherwise backfills all shots missing roll_medium_standard.
    Returns the number of shots updated.
    """
    from stopping_power import (
        estimate_lie_type, _landing_speed_mph, roll_from_components,
        flyer_carry_est as calc_flyer_carry, BALL_RADIUS_M,
    )
    import math

    conn = get_connection()

    if shot_ids is not None:
        placeholders = ", ".join("?" * len(shot_ids))
        rows = conn.execute(
            f"""
            SELECT shot_id, club_type, spin_rate, ball_speed, carry_distance, descent_angle
            FROM shots
            WHERE shot_id IN ({placeholders})
              AND spin_rate IS NOT NULL AND ball_speed IS NOT NULL
              AND carry_distance IS NOT NULL AND descent_angle IS NOT NULL
            """,
            shot_ids,
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT shot_id, club_type, spin_rate, ball_speed, carry_distance, descent_angle
            FROM shots
            WHERE roll_medium_standard IS NULL
              AND spin_rate IS NOT NULL AND ball_speed IS NOT NULL
              AND carry_distance IS NOT NULL AND descent_angle IS NOT NULL
            """
        ).fetchall()

    if not rows:
        return 0

    updates = []
    for shot_id, club_type, spin_rate, ball_speed, carry, descent_angle in rows:
        lie_type, flyer_conf = estimate_lie_type(spin_rate, club_type or "")

        v_land_ms = _landing_speed_mph(ball_speed, carry) * 0.44704
        theta = math.radians(descent_angle)
        v_tangent = v_land_ms * math.cos(theta)
        omega = spin_rate * (2 * math.pi / 60)
        v_spin = omega * BALL_RADIUS_M
        check_ratio = v_spin / max(v_tangent, 0.1)

        rolls = [
            roll_from_components(v_tangent, check_ratio, f, l)
            for f in _FIRMNESS_LIST
            for l in _LIE_LIST
        ]
        carry_est = None if (club_type or "").lower() == "d" else calc_flyer_carry(carry, check_ratio)

        updates.append((lie_type, flyer_conf, check_ratio, *rolls, carry_est, shot_id))

    conn.executemany(_SP_UPDATE_SQL, updates)
    return len(updates)
