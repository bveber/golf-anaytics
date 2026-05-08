CREATE TABLE IF NOT EXISTS sessions (
    session_id    TEXT PRIMARY KEY,
    session_date  TIMESTAMPTZ,
    session_type  TEXT,   -- practice, combines, range, target, closesttopin, speed
    notes         TEXT,
    scraped_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shots (
    shot_id       TEXT PRIMARY KEY,  -- '{session_id}:{shot_number}'
    session_id    TEXT NOT NULL REFERENCES sessions(session_id),
    shot_number   INTEGER NOT NULL,
    club          TEXT,        -- "{Brand} {Model}" e.g. "TaylorMade SIM 2 MAX"
    club_type     TEXT,        -- abbreviated type from CSV: d, sw, i, w, etc.
    target_distance DOUBLE,    -- yards (only set for Target Range sessions)
    is_outlier    BOOLEAN NOT NULL DEFAULT false,
    outlier_note  TEXT,
    -- Ball flight metrics
    ball_speed        DOUBLE,   -- mph
    launch_angle      DOUBLE,   -- degrees
    launch_direction  DOUBLE,   -- degrees (positive = right)
    spin_rate         DOUBLE,   -- rpm
    spin_axis         DOUBLE,   -- degrees (positive = clockwise / slice)
    smash_factor      DOUBLE,
    carry_distance    DOUBLE,   -- yards
    total_distance    DOUBLE,   -- yards
    side_carry        DOUBLE,   -- yards (positive = right)
    apex              DOUBLE,   -- yards (peak height)
    descent_angle     DOUBLE,   -- degrees
    -- Club delivery metrics
    club_speed        DOUBLE,   -- mph (imputed if club_speed_imputed = true)
    attack_angle      DOUBLE,   -- degrees (negative = descending)
    club_path         DOUBLE,   -- degrees (positive = in-to-out)
    swing_effort      TEXT,     -- 100-80, 80-60, 60-40, 40-20, 20-0, unknown
    club_speed_imputed  BOOLEAN DEFAULT false,
    club_speed_raw      DOUBLE,  -- original sensor value before imputation
    smash_factor_raw    DOUBLE,  -- original smash factor before imputation
    UNIQUE (session_id, shot_number)
);

CREATE TABLE IF NOT EXISTS swing_effort_thresholds (
    club_type    TEXT NOT NULL,
    bucket_index INTEGER NOT NULL,
    lower_bound  DOUBLE NOT NULL,
    upper_bound  DOUBLE,
    label        TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (club_type, bucket_index)
);

CREATE TABLE IF NOT EXISTS user_settings (
    id            INTEGER PRIMARY KEY DEFAULT 1,
    elevation_ft  DOUBLE NOT NULL DEFAULT 900.0,
    temperature_f DOUBLE NOT NULL DEFAULT 70.0
);
INSERT OR IGNORE INTO user_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS combine_sessions (
    combine_id        TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES sessions(session_id),
    target_1_distance DOUBLE,
    target_1_club     TEXT,
    target_2_distance DOUBLE,
    target_2_club     TEXT,
    target_3_club     TEXT DEFAULT 'Driver',
    rapsodo_score     DOUBLE
);
