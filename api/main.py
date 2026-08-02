from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from api.routes import sessions, shots, stats, golf_tracker, swing_effort, settings, auth, credentials, sync

app = FastAPI(title="Golf Analytics API")

_default_origins = "http://localhost:5173"
allow_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(shots.router)
app.include_router(stats.router)
app.include_router(golf_tracker.router)
app.include_router(swing_effort.router)
app.include_router(settings.router)
app.include_router(credentials.router)
app.include_router(sync.router)


@app.on_event("startup")
def startup() -> None:
    from api.db import init_db, get_conn
    from api.compute import recompute_adjustments
    import api.sync_queue as sync_queue

    init_db()
    conn = get_conn()
    try:
        user_ids = [r[0] for r in conn.execute("SELECT user_id FROM users").fetchall()]
        for user_id in user_ids:
            count = conn.execute(
                "SELECT COUNT(*) FROM shots WHERE user_id = ? AND ball_speed_adj IS NULL AND ball_speed IS NOT NULL",
                [user_id],
            ).fetchone()
            if count and count[0] > 0:
                recompute_adjustments(conn, user_id)
    finally:
        conn.close()

    sync_queue.start()


@app.get("/health")
def health():
    return {"ok": True}
