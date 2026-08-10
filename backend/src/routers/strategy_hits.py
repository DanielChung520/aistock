"""Strategy-hits API — screener result history + read/unread for notifications."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.services import hit_persistence

router = APIRouter(prefix="/strategy-hits", tags=["strategy-hits"])


class ScreenHit(BaseModel):
    stock_id: str
    name: str = ""
    score: float = 0.0
    price: Optional[float] = None
    passed_count: int = 0
    total_conditions: int = 0
    condition_results: list[dict] = Field(default_factory=list)
    date: str = ""
    passed: bool = True


class WriteHitsRequest(BaseModel):
    scan_id: str = Field(min_length=1)
    scope: str = "all"
    source: str = "manual"
    conditions: list[dict] = Field(default_factory=list)
    hits: list[ScreenHit] = Field(default_factory=list)


@router.post("")
def write_hits(req: WriteHitsRequest) -> dict:
    """Batch-persist a scan's results (internal, called by the strategy drawer)."""
    if req.source not in ("manual", "ai"):
        raise HTTPException(status_code=422, detail="source must be 'manual' or 'ai'")
    written = hit_persistence.write_hits(
        scan_id=req.scan_id,
        scope=req.scope,
        source=req.source,
        conditions=req.conditions,
        hits=[h.model_dump() for h in req.hits],
    )
    return {"scan_id": req.scan_id, "written": written}


@router.get("")
def list_hits(
    limit: int = Query(default=50, ge=1, le=200),
    unread_first: bool = Query(default=True),
    before: Optional[float] = Query(default=None, description="cursor: only hits with created_at < before"),
) -> dict:
    items = hit_persistence.list_hits(
        limit=limit, unread_first=unread_first, before=before
    )
    return {"total": len(items), "results": items}


@router.get("/unread-count")
def unread_count() -> dict:
    return {"unread": hit_persistence.unread_count()}


@router.put("/read-all")
def read_all() -> dict:
    return {"marked": hit_persistence.read_all()}


@router.put("/{key}/read")
def mark_read(key: str) -> dict:
    ok = hit_persistence.mark_read(key)
    if not ok:
        raise HTTPException(status_code=404, detail=f"strategy hit not found: {key}")
    return {"key": key, "read": True}
