"""Strategy execution records API — create / list / get runs."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.services import strategy_run_store

router = APIRouter(prefix="/strategy-runs", tags=["strategy-runs"])


class RunIn(BaseModel):
    strategy_id: str | None = None
    strategy_name: str = ""
    conditions: list[dict] = Field(default_factory=list)
    scope: str = "all"
    source: str = "manual"
    hits: list[dict] = Field(default_factory=list)


@router.post("")
def create_run(req: RunIn) -> dict:
    if req.source not in ("manual", "ai"):
        raise HTTPException(status_code=422, detail="source must be 'manual' or 'ai'")
    return strategy_run_store.create_run(
        strategy_id=req.strategy_id,
        strategy_name=req.strategy_name,
        conditions=req.conditions,
        scope=req.scope,
        source=req.source,
        hits=req.hits,
    )


@router.get("")
def list_runs(limit: int = Query(default=50, ge=1, le=500)) -> dict:
    items = strategy_run_store.list_runs(limit=limit)
    return {"total": len(items), "runs": items}


@router.get("/{key}")
def get_run(key: str) -> dict:
    run = strategy_run_store.get_run(key)
    if run is None:
        raise HTTPException(status_code=404, detail=f"run not found: {key}")
    return run
