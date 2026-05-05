from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import sessions, shots, stats, golf_tracker, swing_effort

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


@app.get("/health")
def health():
    return {"ok": True}
