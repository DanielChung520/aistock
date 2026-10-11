from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.db import get_db
from src.scheduler import (
    ensure_schedule_collection,
    execute_job,
    seed_default_jobs,
    sync_job,
)

router = APIRouter(prefix="/schedule", tags=["schedule"])


class ScheduleJobCreate(BaseModel):
    key: str
    enabled: bool = True
    cron: str = ""
    params: dict = {}


class ScheduleJobUpdate(BaseModel):
    enabled: bool | None = None
    cron: str | None = None
    params: dict | None = None


@router.get("/jobs")
def list_jobs():
    ensure_schedule_collection()
    seed_default_jobs()
    db = get_db()
    cursor = db.aql.execute("FOR j IN schedule_jobs SORT j._key ASC RETURN j")
    return list(cursor)


@router.get("/jobs/{key}")
def get_job(key: str):
    ensure_schedule_collection()
    db = get_db()
    col = db.collection("schedule_jobs")
    if not col.has(key):
        raise HTTPException(status_code=404, detail="job not found")
    return col.get(key)


@router.put("/jobs/{key}")
def update_job(key: str, body: ScheduleJobUpdate):
    ensure_schedule_collection()
    db = get_db()
    col = db.collection("schedule_jobs")
    if not col.has(key):
        raise HTTPException(status_code=404, detail="job not found")

    update = {"updated_at": datetime.now(timezone.utc).timestamp()}
    if body.enabled is not None:
        update["enabled"] = body.enabled
    if body.cron is not None:
        update["cron"] = body.cron
    if body.params is not None:
        update["params"] = body.params

    col.update({"_key": key, **update})
    sync_job(key)
    return col.get(key)


@router.post("/jobs/{key}/run")
def trigger_job(key: str):
    ensure_schedule_collection()
    db = get_db()
    col = db.collection("schedule_jobs")
    if not col.has(key):
        raise HTTPException(status_code=404, detail="job not found")

    job = col.get(key)
    job_type = job.get("type")

    try:
        result = execute_job(job)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if job_type == "history_cleanup":
        return {"triggered": True, "deleted_minute_records": result}
    return {"triggered": True, "job": key, "type": job_type}
