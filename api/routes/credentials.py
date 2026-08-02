from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user_id
from api.secrets import delete_rcloud_credentials, get_rcloud_credentials, put_rcloud_credentials

router = APIRouter(prefix="/settings/rcloud-credentials", tags=["credentials"])


@router.get("/status")
def credentials_status(user_id: int = Depends(get_current_user_id)):
    creds = get_rcloud_credentials(user_id)
    return {"configured": creds is not None}


@router.put("")
def set_credentials(body: dict, user_id: int = Depends(get_current_user_id)):
    email = body.get("email")
    password = body.get("password")
    if not email or not password:
        raise HTTPException(400, "email and password are required")
    put_rcloud_credentials(user_id, email, password)
    return {"ok": True}


@router.delete("")
def remove_credentials(user_id: int = Depends(get_current_user_id)):
    delete_rcloud_credentials(user_id)
    return {"ok": True}
