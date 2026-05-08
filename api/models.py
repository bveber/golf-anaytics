from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class Session(BaseModel):
    session_id: str
    session_date: Optional[datetime]
    session_type: Optional[str]
    notes: Optional[str]
    scraped_at: datetime
    shot_count: Optional[int] = None


class Shot(BaseModel):
    shot_id: str
    session_id: str
    session_date: Optional[str] = None
    shot_number: int
    club: Optional[str]
    club_type: Optional[str]
    target_distance: Optional[float]
    is_outlier: bool
    outlier_note: Optional[str]
    ball_speed: Optional[float]
    launch_angle: Optional[float]
    launch_direction: Optional[float]
    spin_rate: Optional[float]
    spin_axis: Optional[float]
    smash_factor: Optional[float]
    carry_distance: Optional[float]
    total_distance: Optional[float]
    side_carry: Optional[float]
    apex: Optional[float]
    descent_angle: Optional[float]
    club_speed: Optional[float]
    attack_angle: Optional[float]
    club_path: Optional[float]
    swing_effort: Optional[str]
    roll_medium_standard: Optional[float] = None
    roll_medium_flyer: Optional[float] = None
    flyer_carry_est: Optional[float] = None


class CorrectedShot(Shot):
    ball_speed_adj:     Optional[float] = None
    club_speed_adj:     Optional[float] = None
    carry_distance_adj: Optional[float] = None
    total_distance_adj: Optional[float] = None
    smash_factor_adj:   Optional[float] = None


class OutlierUpdate(BaseModel):
    is_outlier: bool
    outlier_note: Optional[str] = None


class UserSettings(BaseModel):
    elevation_ft:  float
    temperature_f: float


class ClubStats(BaseModel):
    club: str
    club_type: Optional[str]
    shot_count: int
    carry_mean: Optional[float]
    carry_std: Optional[float]
    total_mean: Optional[float]
    total_std: Optional[float]
    ball_speed_mean: Optional[float]
    spin_rate_mean: Optional[float]
    smash_factor_mean: Optional[float]
    side_carry_mean: Optional[float]
    side_carry_std: Optional[float]
    launch_angle_mean: Optional[float]
    club_speed_mean: Optional[float]
    spin_axis_mean: Optional[float]
    club_path_mean: Optional[float]
    attack_angle_mean: Optional[float]
    launch_direction_mean: Optional[float]
    apex_mean: Optional[float]
    carry_mean_adj:      Optional[float] = None
    total_mean_adj:      Optional[float] = None
    ball_speed_mean_adj: Optional[float] = None
    club_speed_mean_adj: Optional[float] = None
