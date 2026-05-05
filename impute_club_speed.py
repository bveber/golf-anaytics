"""
Impute club_speed for shots where smash_factor > 1.5 (bad sensor readings).
Uses KNN regression trained on clean shots, then recomputes smash_factor.
"""

from __future__ import annotations

import duckdb
import numpy as np
from sklearn.neighbors import KNeighborsRegressor
from sklearn.preprocessing import StandardScaler

FEATURES = ["carry_distance", "ball_speed", "launch_angle", "launch_direction", "spin_rate", "spin_axis"]
DB_PATH = "db/golf_analytics.duckdb"


def main() -> None:
    conn = duckdb.connect(DB_PATH)

    # Training data: clean shots with all features present
    train_sql = f"""
        SELECT shot_id, club_speed, {', '.join(FEATURES)}
        FROM shots
        WHERE smash_factor <= 1.5
          AND club_speed IS NOT NULL
          AND {' AND '.join(f'{f} IS NOT NULL' for f in FEATURES)}
    """
    train_rows = conn.execute(train_sql).fetchall()
    col_names = ["shot_id", "club_speed"] + FEATURES
    train_data = [dict(zip(col_names, r)) for r in train_rows]

    X_train = np.array([[r[f] for f in FEATURES] for r in train_data])
    y_train = np.array([r["club_speed"] for r in train_data])

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)

    knn = KNeighborsRegressor(n_neighbors=5, weights="distance")
    knn.fit(X_train_scaled, y_train)

    # Shots to impute: smash_factor > 1.5, all features present
    bad_sql = f"""
        SELECT shot_id, ball_speed, club_speed as orig_club_speed, smash_factor,
               {', '.join(FEATURES)}
        FROM shots
        WHERE smash_factor > 1.5
          AND ball_speed IS NOT NULL
          AND {' AND '.join(f'{f} IS NOT NULL' for f in FEATURES)}
    """
    bad_rows = conn.execute(bad_sql).fetchall()
    bad_cols = ["shot_id", "ball_speed", "orig_club_speed", "smash_factor"] + FEATURES
    bad_data = [dict(zip(bad_cols, r)) for r in bad_rows]

    if not bad_data:
        print("No shots with smash_factor > 1.5 found.")
        return

    X_bad = np.array([[r[f] for f in FEATURES] for r in bad_data])
    X_bad_scaled = scaler.transform(X_bad)
    imputed_speeds = knn.predict(X_bad_scaled)

    print(f"Imputing club_speed for {len(bad_data)} shots:\n")
    print(f"{'shot_id':<25} {'orig_speed':>10} {'imputed_speed':>13} {'orig_sf':>8} {'new_sf':>8}")
    print("-" * 70)

    updates = []
    for row, imp_speed in zip(bad_data, imputed_speeds):
        new_sf = row["ball_speed"] / imp_speed if imp_speed > 0 else None
        updates.append((imp_speed, new_sf, row["shot_id"]))
        print(
            f"{row['shot_id']:<25} {row['orig_club_speed']:>10.1f} {imp_speed:>13.1f} "
            f"{row['smash_factor']:>8.3f} {new_sf:>8.3f}"
        )

    # Apply updates
    conn.executemany(
        "UPDATE shots SET club_speed = ?, smash_factor = ? WHERE shot_id = ?",
        updates,
    )
    conn.commit()
    print(f"\nUpdated {len(updates)} shots in {DB_PATH}.")


if __name__ == "__main__":
    main()
