from __future__ import annotations

import duckdb
from pathlib import Path

from db import init_schema

DB_PATH = Path(__file__).parent.parent / "db" / "golf_analytics.duckdb"


def init_db() -> None:
    """One-time startup: ensure schema and all migrations are applied."""
    conn = duckdb.connect(str(DB_PATH))
    try:
        init_schema(conn)
    finally:
        conn.close()


def get_conn() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(DB_PATH))
