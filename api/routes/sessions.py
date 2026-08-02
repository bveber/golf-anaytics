from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from api.auth import get_current_user_id
from api.db import get_conn
from api.models import Session

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("/", response_model=list[Session])
def list_sessions(session_type: Optional[str] = None, user_id: int = Depends(get_current_user_id)):
    conn = get_conn()
    conditions = ["s.user_id = ?"]
    params: list = [user_id]
    if session_type:
        conditions.append("s.session_type = ?")
        params.append(session_type)
    where = "WHERE " + " AND ".join(conditions)
    rows = conn.execute(
        f"""
        SELECT s.session_id, s.session_date, s.session_type, s.notes, s.scraped_at,
               COUNT(sh.shot_id) AS shot_count
        FROM sessions s
        LEFT JOIN shots sh ON sh.session_id = s.session_id
        {where}
        GROUP BY s.session_id, s.session_date, s.session_type, s.notes, s.scraped_at
        ORDER BY s.session_date DESC
        """,
        params,
    ).fetchall()
    cols = ["session_id", "session_date", "session_type", "notes", "scraped_at", "shot_count"]

    return [Session(**dict(zip(cols, r))) for r in rows]


@router.get("/{session_id}", response_model=Session)
def get_session(session_id: str, user_id: int = Depends(get_current_user_id)):
    conn = get_conn()
    row = conn.execute(
        """
        SELECT s.session_id, s.session_date, s.session_type, s.notes, s.scraped_at,
               COUNT(sh.shot_id) AS shot_count
        FROM sessions s
        LEFT JOIN shots sh ON sh.session_id = s.session_id
        WHERE s.session_id = ? AND s.user_id = ?
        GROUP BY s.session_id, s.session_date, s.session_type, s.notes, s.scraped_at
        """,
        [session_id, user_id],
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    cols = ["session_id", "session_date", "session_type", "notes", "scraped_at", "shot_count"]
    return Session(**dict(zip(cols, row)))
