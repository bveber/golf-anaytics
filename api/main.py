from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import sessions, shots, stats, golf_tracker, swing_effort, settings

app = FastAPI(title="Golf Analytics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(shots.router)
app.include_router(stats.router)
app.include_router(golf_tracker.router)
app.include_router(swing_effort.router)
app.include_router(settings.router)


@app.on_event("startup")
def startup() -> None:
    from api.db import init_db, get_conn
    from api.compute import recompute_adjustments
    init_db()
    conn = get_conn()
    try:
        count = conn.execute(
            "SELECT COUNT(*) FROM shots WHERE ball_speed_adj IS NULL AND ball_speed IS NOT NULL"
        ).fetchone()
        if count and count[0] > 0:
            recompute_adjustments(conn)
    finally:
        conn.close()


@app.get("/health")
def health():
    return {"ok": True}
