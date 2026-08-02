from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user_id
from api.compute import recompute_adjustments
from api.db import get_conn
from api.models import UserSettings

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_or_create_settings(conn, user_id: int) -> tuple[float, float]:
    row = conn.execute(
        "SELECT elevation_ft, temperature_f FROM user_settings WHERE user_id = ?", [user_id]
    ).fetchone()
    if row:
        return row[0], row[1]
    conn.execute("INSERT INTO user_settings (user_id) VALUES (?)", [user_id])
    return 900.0, 70.0


@router.get("", response_model=UserSettings)
def get_settings(user_id: int = Depends(get_current_user_id)) -> UserSettings:
    conn = get_conn()
    elevation_ft, temperature_f = _get_or_create_settings(conn, user_id)
    return UserSettings(elevation_ft=elevation_ft, temperature_f=temperature_f)


@router.patch("", response_model=UserSettings)
def update_settings(body: dict, user_id: int = Depends(get_current_user_id)) -> UserSettings:
    conn = get_conn()
    current_elevation_ft, current_temperature_f = _get_or_create_settings(conn, user_id)

    elevation_ft = body.get("elevation_ft", current_elevation_ft)
    temperature_f = body.get("temperature_f", current_temperature_f)

    if not (0 <= elevation_ft <= 14000):
        raise HTTPException(status_code=422, detail="elevation_ft must be between 0 and 14000")
    if not (-40 <= temperature_f <= 120):
        raise HTTPException(status_code=422, detail="temperature_f must be between -40 and 120")

    conn.execute(
        "UPDATE user_settings SET elevation_ft = ?, temperature_f = ? WHERE user_id = ?",
        [elevation_ft, temperature_f, user_id],
    )
    recompute_adjustments(conn, user_id)
    return UserSettings(elevation_ft=elevation_ft, temperature_f=temperature_f)
