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
    club_type     TEXT PRIMARY KEY,
    anchor_speed  DOUBLE NOT NULL,  -- max club_speed (mph) = top of 100-80 bucket
    min_speed     DOUBLE NOT NULL,  -- min club_speed (mph) = bottom of 20-0 bucket
    full_speed    DOUBLE NOT NULL,  -- lower bound for '100-80' (80% of range)
    pct75_speed   DOUBLE NOT NULL,  -- lower bound for '80-60'  (60% of range)
    pct60_speed   DOUBLE NOT NULL,  -- lower bound for '60-40'  (40% of range)
    pct50_speed   DOUBLE NOT NULL,  -- lower bound for '40-20'  (20% of range)
    shot_count    INTEGER NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
