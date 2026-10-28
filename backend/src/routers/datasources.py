"""資料源 API — 讓後端與 AI 查詢註冊表（`GET /api/datasources`）。規格：.docs/datasources/SCHEMA.md。

唯讀；JSON 只含 env 變數名（無機密），可安全曝露。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from src.datasources import registry

router = APIRouter(prefix="/datasources", tags=["datasources"])


@router.get("")
def list_datasources() -> dict:
    return {"datasets": registry.datasets(), "sources": registry.sources()}


@router.get("/resolve/{dataset_id}")
def resolve_dataset(
    dataset_id: str,
    include_planned: bool = Query(default=False),
) -> dict:
    try:
        order = registry.resolve(dataset_id, include_planned=include_planned)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"dataset": dataset_id, "order": order, "include_planned": include_planned}
