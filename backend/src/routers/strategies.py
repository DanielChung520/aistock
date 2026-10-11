"""Strategy CRUD API — list / get / create / update / delete screening strategies."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.routers.strategy import PRESET_STRATEGIES, _validate_conditions
from src.services import strategy_store

router = APIRouter(prefix="/strategies", tags=["strategies"])


class StrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    conditions: list[dict] = Field(default_factory=list)


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


@router.delete("/{key}")
def delete_strategy(key: str) -> dict:
    if not strategy_store.delete_strategy(key):
        raise HTTPException(status_code=404, detail=f"strategy not found: {key}")
    return {"id": key, "deleted": True}
