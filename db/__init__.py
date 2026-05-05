import duckdb
import os
from pathlib import Path

_conn: duckdb.DuckDBPyConnection | None = None


def get_connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        db_path = os.getenv("DB_PATH", "db/golf_analytics.duckdb")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(db_path)
        _init_schema(_conn)
    return _conn


def _init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    schema_path = Path(__file__).parent / "schema.sql"
    sql = schema_path.read_text()
    for statement in sql.split(";"):
        statement = statement.strip()
        if statement:
            conn.execute(statement)
    _migrate(conn)


def _migrate(conn: duckdb.DuckDBPyConnection) -> None:
    existing = {
        row[0]
        for row in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'shots'"
        ).fetchall()
    }
    if "swing_effort" not in existing:
        conn.execute("ALTER TABLE shots ADD COLUMN swing_effort TEXT")
    if "club_speed_imputed" not in existing:
        conn.execute("ALTER TABLE shots ADD COLUMN club_speed_imputed BOOLEAN DEFAULT false")
        conn.execute("ALTER TABLE shots ADD COLUMN club_speed_raw DOUBLE")
        conn.execute("ALTER TABLE shots ADD COLUMN smash_factor_raw DOUBLE")
    if "lie_type" not in existing:
        conn.execute("ALTER TABLE shots ADD COLUMN lie_type TEXT")
        conn.execute("ALTER TABLE shots ADD COLUMN flyer_confidence DOUBLE")
        conn.execute("ALTER TABLE shots ADD COLUMN check_ratio DOUBLE")
    if "roll_medium_standard" not in existing:
        for firmness in ("soft", "medium", "firm", "links"):
            for lie in ("standard", "flyer"):
                conn.execute(f"ALTER TABLE shots ADD COLUMN roll_{firmness}_{lie} DOUBLE")
        conn.execute("ALTER TABLE shots ADD COLUMN flyer_carry_est DOUBLE")
