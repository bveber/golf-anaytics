import duckdb
import os
from pathlib import Path

_conn: duckdb.DuckDBPyConnection | None = None

_ADJ_COLS = [
    "ball_speed_adj",
    "club_speed_adj",
    "carry_distance_adj",
    "total_distance_adj",
    "smash_factor_adj",
]


def get_connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        db_path = os.getenv("DB_PATH", "db/golf_analytics.duckdb")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(db_path)
        init_schema(_conn)
    return _conn


def init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Apply schema.sql then run all migrations. Idempotent - safe to call on every connect."""
    schema_path = Path(__file__).parent / "schema.sql"
    sql = schema_path.read_text()
    for statement in sql.split(";"):
        statement = statement.strip()
        if statement:
            conn.execute(statement)
    _migrate(conn)


def _columns(conn: duckdb.DuckDBPyConnection, table: str) -> set[str]:
    return {
        row[0]
        for row in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ?", [table]
        ).fetchall()
    }


_SHOTS_REBUILD_DDL = """
    CREATE TABLE shots (
        shot_id       TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES sessions(session_id),
        user_id       INTEGER NOT NULL REFERENCES users(user_id),
        shot_number   INTEGER NOT NULL,
        club          TEXT,
        club_type     TEXT,
        target_distance DOUBLE,
        is_outlier    BOOLEAN NOT NULL DEFAULT false,
        outlier_note  TEXT,
        ball_speed        DOUBLE,
        launch_angle      DOUBLE,
        launch_direction  DOUBLE,
        spin_rate         DOUBLE,
        spin_axis         DOUBLE,
        smash_factor      DOUBLE,
        carry_distance    DOUBLE,
        total_distance    DOUBLE,
        side_carry        DOUBLE,
        apex              DOUBLE,
        descent_angle     DOUBLE,
        club_speed        DOUBLE,
        attack_angle      DOUBLE,
        club_path         DOUBLE,
        swing_effort      TEXT,
        club_speed_imputed  BOOLEAN DEFAULT false,
        club_speed_raw      DOUBLE,
        smash_factor_raw    DOUBLE,
        lie_type          TEXT,
        flyer_confidence  DOUBLE,
        check_ratio       DOUBLE,
        roll_soft_standard DOUBLE,
        roll_soft_flyer DOUBLE,
        roll_medium_standard DOUBLE,
        roll_medium_flyer DOUBLE,
        roll_firm_standard DOUBLE,
        roll_firm_flyer DOUBLE,
        roll_links_standard DOUBLE,
        roll_links_flyer DOUBLE,
        flyer_carry_est   DOUBLE,
        ball_speed_adj DOUBLE,
        club_speed_adj DOUBLE,
        carry_distance_adj DOUBLE,
        total_distance_adj DOUBLE,
        smash_factor_adj DOUBLE,
        UNIQUE (session_id, shot_number)
    )
"""

_COMBINE_SESSIONS_REBUILD_DDL = """
    CREATE TABLE combine_sessions (
        combine_id        TEXT PRIMARY KEY,
        session_id        TEXT NOT NULL REFERENCES sessions(session_id),
        user_id           INTEGER NOT NULL REFERENCES users(user_id),
        target_1_distance DOUBLE,
        target_1_club     TEXT,
        target_2_distance DOUBLE,
        target_2_club     TEXT,
        target_3_club     TEXT DEFAULT 'Driver',
        rapsodo_score     DOUBLE
    )
"""


def _migrate_multi_tenant(conn: duckdb.DuckDBPyConnection) -> None:
    """One-time migration of a pre-multi-tenant DB: bootstrap a default user and
    backfill user_id onto every table. Safe/idempotent to call on every connect.

    `sessions` is FK-referenced by `shots`/`combine_sessions`, and DuckDB refuses to
    ALTER a table that has dependents - so those two are backed up, dropped (freeing
    `sessions` to be altered), then rebuilt from the backup with user_id added.
    """
    if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        conn.execute(
            "INSERT INTO users (google_sub, email, display_name) VALUES (?, ?, ?)",
            ["MIGRATION_PLACEHOLDER", "unclaimed@placeholder.local", "Default User"],
        )

    for table in ("shots", "combine_sessions"):
        if "user_id" not in _columns(conn, table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER")
            conn.execute(f"UPDATE {table} SET user_id = 1 WHERE user_id IS NULL")

    if "user_id" not in _columns(conn, "sessions"):
        conn.execute("CREATE TABLE shots_migration_backup AS SELECT * FROM shots")
        conn.execute("CREATE TABLE combine_sessions_migration_backup AS SELECT * FROM combine_sessions")
        conn.execute("DROP TABLE shots")
        conn.execute("DROP TABLE combine_sessions")

        conn.execute("ALTER TABLE sessions ADD COLUMN user_id INTEGER")
        conn.execute("UPDATE sessions SET user_id = 1 WHERE user_id IS NULL")

        conn.execute(_SHOTS_REBUILD_DDL)
        shot_cols = ", ".join(sorted(_columns(conn, "shots_migration_backup")))
        conn.execute(f"INSERT INTO shots ({shot_cols}) SELECT {shot_cols} FROM shots_migration_backup")
        conn.execute("DROP TABLE shots_migration_backup")

        conn.execute(_COMBINE_SESSIONS_REBUILD_DDL)
        cs_cols = ", ".join(sorted(_columns(conn, "combine_sessions_migration_backup")))
        conn.execute(f"INSERT INTO combine_sessions ({cs_cols}) SELECT {cs_cols} FROM combine_sessions_migration_backup")
        conn.execute("DROP TABLE combine_sessions_migration_backup")

    if "user_id" not in _columns(conn, "swing_effort_thresholds"):
        conn.execute("ALTER TABLE swing_effort_thresholds RENAME TO swing_effort_thresholds_old")
        conn.execute("""
            CREATE TABLE swing_effort_thresholds (
                user_id      INTEGER NOT NULL REFERENCES users(user_id),
                club_type    TEXT NOT NULL,
                bucket_index INTEGER NOT NULL,
                lower_bound  DOUBLE NOT NULL,
                upper_bound  DOUBLE,
                label        TEXT NOT NULL,
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (user_id, club_type, bucket_index)
            )
        """)
        conn.execute("""
            INSERT INTO swing_effort_thresholds
                (user_id, club_type, bucket_index, lower_bound, upper_bound, label, updated_at)
            SELECT 1, club_type, bucket_index, lower_bound, upper_bound, label, updated_at
            FROM swing_effort_thresholds_old
        """)
        conn.execute("DROP TABLE swing_effort_thresholds_old")

    if "user_id" not in _columns(conn, "user_settings"):
        conn.execute("ALTER TABLE user_settings RENAME TO user_settings_old")
        conn.execute("""
            CREATE TABLE user_settings (
                user_id       INTEGER PRIMARY KEY REFERENCES users(user_id),
                elevation_ft  DOUBLE NOT NULL DEFAULT 900.0,
                temperature_f DOUBLE NOT NULL DEFAULT 70.0
            )
        """)
        conn.execute("""
            INSERT INTO user_settings (user_id, elevation_ft, temperature_f)
            SELECT 1, elevation_ft, temperature_f FROM user_settings_old LIMIT 1
        """)
        conn.execute("DROP TABLE user_settings_old")
        conn.execute("INSERT INTO user_settings (user_id) VALUES (1) ON CONFLICT DO NOTHING")

    _migrate_golf_tracker(conn)


_GT_TABLES_DDL = {
    "gt_courses": """
        CREATE TABLE gt_courses (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            name VARCHAR, city VARCHAR, state VARCHAR, hole_count INTEGER,
            PRIMARY KEY (user_id, id)
        )
    """,
    "gt_tee_sets": """
        CREATE TABLE gt_tee_sets (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            course_id INTEGER, name VARCHAR, rating DOUBLE, slope INTEGER,
            PRIMARY KEY (user_id, id)
        )
    """,
    "gt_holes": """
        CREATE TABLE gt_holes (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            course_id INTEGER, hole_number INTEGER, par INTEGER,
            handicap_index INTEGER,
            tee_lat DOUBLE, tee_lng DOUBLE, green_lat DOUBLE, green_lng DOUBLE,
            PRIMARY KEY (user_id, id)
        )
    """,
    "gt_rounds": """
        CREATE TABLE gt_rounds (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            course_id INTEGER, tee_set_id INTEGER,
            date VARCHAR, is_finalized BOOLEAN, is_practice BOOLEAN,
            notes VARCHAR, start_hole INTEGER, total_holes INTEGER,
            PRIMARY KEY (user_id, id)
        )
    """,
    "gt_hole_stats": """
        CREATE TABLE gt_hole_stats (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            round_id INTEGER, hole_id INTEGER,
            score INTEGER, score_manual BOOLEAN, is_scored BOOLEAN,
            putts INTEGER, chips INTEGER, sand_shots INTEGER,
            gir BOOLEAN, near_gir BOOLEAN, gir_override BOOLEAN,
            approach_mishit BOOLEAN, recovery_chip BOOLEAN,
            adjusted_yardage INTEGER, chip_distance INTEGER, chip_lie VARCHAR,
            tee_club_id INTEGER, tee_shot_distance INTEGER, tee_outcome VARCHAR,
            tee_mishit BOOLEAN, tee_in_trouble BOOLEAN,
            tee_lat DOUBLE, tee_lng DOUBLE,
            tee_dispersion_left INTEGER, tee_dispersion_right INTEGER,
            tee_dispersion_long INTEGER, tee_dispersion_short INTEGER,
            sg_approach DOUBLE, sg_around_green DOUBLE,
            sg_off_tee DOUBLE, sg_off_tee_expected DOUBLE,
            sg_putting DOUBLE, strokes_gained DOUBLE, difficulty_adjustment DOUBLE,
            PRIMARY KEY (user_id, id)
        )
    """,
    "gt_shots": """
        CREATE TABLE gt_shots (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            hole_stat_id INTEGER, shot_number INTEGER, club_id INTEGER,
            distance_to_pin INTEGER, distance_traveled INTEGER,
            lie VARCHAR, outcome VARCHAR,
            is_mishit BOOLEAN, is_recovery BOOLEAN,
            strokes_gained DOUBLE, penalty_attribution DOUBLE,
            start_lat DOUBLE, start_lng DOUBLE,
            target_lat DOUBLE, target_lng DOUBLE,
            dispersion_left INTEGER, dispersion_right INTEGER,
            dispersion_long INTEGER, dispersion_short INTEGER,
            PRIMARY KEY (user_id, id)
        )
    """,
    "gt_putts": """
        CREATE TABLE gt_putts (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            hole_stat_id INTEGER, putt_number INTEGER,
            distance DOUBLE, made BOOLEAN, strokes_gained DOUBLE,
            break_direction VARCHAR, direction_miss VARCHAR,
            pace_miss VARCHAR, slope_direction VARCHAR,
            PRIMARY KEY (user_id, id)
        )
    """,
    "gt_penalties": """
        CREATE TABLE gt_penalties (
            user_id INTEGER NOT NULL, id INTEGER NOT NULL,
            hole_stat_id INTEGER, shot_number INTEGER, strokes INTEGER, type VARCHAR,
            PRIMARY KEY (user_id, id)
        )
    """,
}


def _migrate_golf_tracker(conn: duckdb.DuckDBPyConnection) -> None:
    """Backfill user_id onto pre-existing golf-tracker tables (created by
    api/routes/golf_tracker.py before it was multi-tenant). Tables that don't
    exist yet are left alone - the route creates them fresh with the new schema."""
    existing_tables = {
        r[0]
        for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'gt_%'"
        ).fetchall()
    }
    for table, create_sql in _GT_TABLES_DDL.items():
        if table not in existing_tables or "user_id" in _columns(conn, table):
            continue
        conn.execute(f"ALTER TABLE {table} RENAME TO {table}_old")
        conn.execute(create_sql)
        old_cols = ", ".join(sorted(_columns(conn, f"{table}_old")))
        conn.execute(f"INSERT INTO {table} ({old_cols}, user_id) SELECT {old_cols}, 1 FROM {table}_old")
        conn.execute(f"DROP TABLE {table}_old")


def _migrate(conn: duckdb.DuckDBPyConnection) -> None:
    _migrate_multi_tenant(conn)
    existing = _columns(conn, "shots")
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
    for col in _ADJ_COLS:
        if col not in existing:
            conn.execute(f"ALTER TABLE shots ADD COLUMN {col} DOUBLE")
