from __future__ import annotations

import duckdb
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "db" / "golf_analytics.duckdb"

_ADJ_COLS = [
    "ball_speed_adj",
    "club_speed_adj",
    "carry_distance_adj",
    "total_distance_adj",
    "smash_factor_adj",
]


def init_db() -> None:
    """One-time startup: ensure user_settings and _adj columns exist."""
    conn = duckdb.connect(str(DB_PATH))
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                id            INTEGER PRIMARY KEY DEFAULT 1,
                elevation_ft  DOUBLE NOT NULL DEFAULT 900.0,
                temperature_f DOUBLE NOT NULL DEFAULT 70.0
            )
        """)
        conn.execute("INSERT OR IGNORE INTO user_settings (id) VALUES (1)")
        for col in _ADJ_COLS:
            try:
                conn.execute(f"ALTER TABLE shots ADD COLUMN IF NOT EXISTS {col} DOUBLE")
            except Exception:
                pass
    finally:
        conn.close()


def get_conn() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(DB_PATH))
