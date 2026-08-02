from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from api.auth import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    create_session_cookie_value,
    get_current_user_id,
    verify_google_id_token,
)
from api.db import get_conn

router = APIRouter(prefix="/auth", tags=["auth"])

# Every table carrying a user_id, in no particular order - used to reassign
# a placeholder user's data to a real account on first login.
_USER_SCOPED_TABLES = [
    "sessions", "shots", "combine_sessions", "swing_effort_thresholds", "user_settings",
    "gt_courses", "gt_tee_sets", "gt_holes", "gt_rounds", "gt_hole_stats",
    "gt_shots", "gt_putts", "gt_penalties",
]


def _set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=create_session_cookie_value(user_id),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )


@router.post("/google")
def login_with_google(body: dict, response: Response):
    id_token = body.get("id_token")
    if not id_token:
        raise HTTPException(400, "id_token is required")

    try:
        payload = verify_google_id_token(id_token)
    except ValueError:
        raise HTTPException(401, "Invalid Google ID token")

    google_sub = payload["sub"]
    email = payload.get("email", "")
    display_name = payload.get("name")

    conn = get_conn()
    row = conn.execute("SELECT user_id FROM users WHERE google_sub = ?", [google_sub]).fetchone()
    if row:
        user_id = row[0]
        conn.execute(
            "UPDATE users SET email = ?, display_name = ? WHERE user_id = ?",
            [email, display_name, user_id],
        )
    else:
        new_row = conn.execute(
            "INSERT INTO users (google_sub, email, display_name) VALUES (?, ?, ?) RETURNING user_id",
            [google_sub, email, display_name],
        ).fetchone()
        user_id = new_row[0]

        # Claim the single migration placeholder's data (the pre-multi-tenant user's
        # sessions/shots/etc.) if it hasn't already been claimed by someone else.
        # We reassign every row's user_id rather than mutating the placeholder's
        # `users` row itself/deleting it - DuckDB has had bugs (through at least
        # 1.5.5) around UPDATE/DELETE touching PK/UNIQUE-indexed columns on a
        # table that's the target of other tables' foreign keys. The orphaned
        # placeholder row is harmless and intentionally left in place.
        placeholder = conn.execute(
            "SELECT user_id FROM users WHERE google_sub = 'MIGRATION_PLACEHOLDER'"
        ).fetchone()
        if placeholder:
            placeholder_user_id = placeholder[0]
            for table in _USER_SCOPED_TABLES:
                conn.execute(
                    f"UPDATE {table} SET user_id = ? WHERE user_id = ?",
                    [user_id, placeholder_user_id],
                )

    _set_session_cookie(response, user_id)
    return {"email": email, "display_name": display_name}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user_id: int = Depends(get_current_user_id)):
    conn = get_conn()
    row = conn.execute(
        "SELECT email, display_name FROM users WHERE user_id = ?", [user_id]
    ).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    return {"email": row[0], "display_name": row[1]}
