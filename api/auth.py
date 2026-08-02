from __future__ import annotations

import os

from fastapi import HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

SESSION_COOKIE_NAME = "session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days

_google_request = google_requests.Request()


def _serializer() -> URLSafeTimedSerializer:
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        raise RuntimeError("SESSION_SECRET env var must be set")
    return URLSafeTimedSerializer(secret, salt="golf-analytics-session")


def verify_google_id_token(token: str) -> dict:
    """Verify a Google Identity Services ID token. Raises ValueError if invalid."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise RuntimeError("GOOGLE_CLIENT_ID env var must be set")
    return google_id_token.verify_oauth2_token(token, _google_request, client_id)


def create_session_cookie_value(user_id: int) -> str:
    return _serializer().dumps({"user_id": user_id})


def decode_session_cookie_value(value: str) -> int:
    """Returns the user_id encoded in the cookie. Raises BadSignature/SignatureExpired if invalid."""
    data = _serializer().loads(value, max_age=SESSION_MAX_AGE_SECONDS)
    return data["user_id"]


def get_current_user_id(request: Request) -> int:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return decode_session_cookie_value(token)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Session expired or invalid")
