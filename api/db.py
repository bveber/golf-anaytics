import duckdb
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "db" / "golf_analytics.duckdb"


def get_conn() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(DB_PATH))
