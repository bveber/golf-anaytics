from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.compute import recompute_adjustments
from api.db import get_conn
from api.models import UserSettings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=UserSettings)
def get_settings() -> UserSettings:
    conn = get_conn()
    row = conn.execute("SELECT elevation_ft, temperature_f FROM user_settings WHERE id = 1").fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="user_settings not seeded")
    return UserSettings(elevation_ft=row[0], temperature_f=row[1])


@router.patch("", response_model=UserSettings)
def update_settings(body: dict) -> UserSettings:
    conn = get_conn()
    row = conn.execute("SELECT elevation_ft, temperature_f FROM user_settings WHERE id = 1").fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="user_settings not seeded")

    elevation_ft = body.get("elevation_ft", row[0])
    temperature_f = body.get("temperature_f", row[1])

    if not (0 <= elevation_ft <= 14000):
        raise HTTPException(status_code=422, detail="elevation_ft must be between 0 and 14000")
    if not (-40 <= temperature_f <= 120):
        raise HTTPException(status_code=422, detail="temperature_f must be between -40 and 120")

    conn.execute(
        "UPDATE user_settings SET elevation_ft = ?, temperature_f = ? WHERE id = 1",
        [elevation_ft, temperature_f],
    )
    recompute_adjustments(conn)
    return UserSettings(elevation_ft=elevation_ft, temperature_f=temperature_f)
