"""Strategy CRUD API — list / get / create / update / delete screening strategies."""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.db import get_db
from src.routers.strategy import PRESET_STRATEGIES, _validate_conditions
from src.scheduler import ensure_schedule_collection, sync_job
from src.services import strategy_store

router = APIRouter(prefix="/strategies", tags=["strategies"])

SCHEDULE_COLLECTION = "schedule_jobs"


def _schedule_key(strategy_id: str) -> str:
    return f"strategy_{strategy_id}"


class StrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    conditions: list[dict] = Field(default_factory=list)


class ScheduleIn(BaseModel):
    enabled: bool = True
    cron: str = ""


class StrategyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    conditions: list[dict] | None = None


@router.get("")
def list_strategies() -> dict:
    strategy_store.ensure_seeded(PRESET_STRATEGIES)
    items = strategy_store.list_strategies()
    return {"total": len(items), "strategies": items}


@router.get("/{key}")
def get_strategy(key: str) -> dict:
    item = strategy_store.get_strategy(key)
    if item is None:
        raise HTTPException(status_code=404, detail=f"strategy not found: {key}")
    return item


@router.post("")
def create_strategy(req: StrategyIn) -> dict:
    conditions = _validate_conditions(req.conditions)
    if not conditions:
        raise HTTPException(status_code=422, detail="無有效條件")
    return strategy_store.create_strategy(req.name, req.description, conditions)


@router.put("/{key}")
def update_strategy(key: str, req: StrategyUpdate) -> dict:
    conditions = _validate_conditions(req.conditions) if req.conditions is not None else None
    if conditions is not None and not conditions:
        raise HTTPException(status_code=422, detail="無有效條件")
    item = strategy_store.update_strategy(
        key, name=req.name, description=req.description, conditions=conditions
    )
    if item is None:
        raise HTTPException(status_code=404, detail=f"strategy not found: {key}")
    return item


@router.get("/{key}/schedule")
def get_schedule(key: str) -> dict:
    ensure_schedule_collection()
    job = get_db().collection(SCHEDULE_COLLECTION).get(_schedule_key(key))
    if job is None:
        return {
            "strategy_id": key,
            "enabled": False,
            "cron": "",
            "last_run": None,
            "last_status": None,
        }
    return {
        "strategy_id": key,
        "enabled": bool(job.get("enabled")),
        "cron": job.get("cron", ""),
        "last_run": job.get("last_run"),
        "last_status": job.get("last_status"),
    }


@router.put("/{key}/schedule")
def set_schedule(key: str, req: ScheduleIn) -> dict:
    strategy = strategy_store.get_strategy(key)
    if strategy is None:
        raise HTTPException(status_code=404, detail=f"strategy not found: {key}")
    ensure_schedule_collection()
    col = get_db().collection(SCHEDULE_COLLECTION)
    job_key = _schedule_key(key)
    now = datetime.now(UTC).timestamp()
    if col.has(job_key):
        col.update({"_key": job_key, "enabled": req.enabled, "cron": req.cron, "updated_at": now})
    else:
        col.insert({
            "_key": job_key,
            "type": "strategy_screen",
            "name": f"策略排程：{strategy.get('name', key)}",
            "description": "自動執行選股策略並寫入執行記錄",
            "enabled": req.enabled,
            "cron": req.cron,
            "params": {"strategy_id": key, "scope": "all"},
            "last_run": None,
            "last_status": None,
            "created_at": now,
            "updated_at": now,
        })
    sync_job(job_key)
    return get_schedule(key)


@router.delete("/{key}/schedule")
def clear_schedule(key: str) -> dict:
    ensure_schedule_collection()
    col = get_db().collection(SCHEDULE_COLLECTION)
    job_key = _schedule_key(key)
    removed = col.has(job_key)
    if removed:
        col.delete(job_key)
        sync_job(job_key)
    return {"strategy_id": key, "removed": removed}


@router.delete("/{key}")
def delete_strategy(key: str) -> dict:
    if not strategy_store.delete_strategy(key):
        raise HTTPException(status_code=404, detail=f"strategy not found: {key}")
    ensure_schedule_collection()
    col = get_db().collection(SCHEDULE_COLLECTION)
    job_key = _schedule_key(key)
    if col.has(job_key):
        col.delete(job_key)
        sync_job(job_key)
    return {"id": key, "deleted": True}
