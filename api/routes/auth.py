from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from api.auth import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    create_session_cookie_value,
    get_current_user_id,
    verify_google_id_token,
)
from api.db import get_conn

router = APIRouter(prefix="/auth", tags=["auth"])


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
