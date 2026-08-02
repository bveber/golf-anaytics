from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user_id
from api.sync_queue import enqueue_sync, get_job, list_jobs_for_user

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("")
def trigger_sync(user_id: int = Depends(get_current_user_id)):
    job_id = enqueue_sync(user_id, trigger="manual")
    return {"job_id": job_id, "status": "queued"}


@router.get("/jobs")
def list_recent_jobs(user_id: int = Depends(get_current_user_id)):
    return list_jobs_for_user(user_id)


@router.get("/jobs/{job_id}")
def get_job_status(job_id: int, user_id: int = Depends(get_current_user_id)):
    job = get_job(job_id)
    if not job or job["user_id"] != user_id:
        raise HTTPException(404, "Job not found")
    return job
