"""TX 資料 API — 查詢、觸發回填、查看狀態。

端點（prefix `/api/tx-data`）：
- `GET  /status`          → collection 狀態（總筆數、依粒度/連續月分組）
- `POST /backfill`        → 啟動歷史回填 Celery task
- `POST /daily`           → 觸發每日增量更新
- `GET  /bars`            → 查詢 K 線資料（支援日期、合約、粒度篩選）

設計：參考 `backend/src/routers/tx_rl.py` 風格。
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.data.tx_fetcher import list_available_sources
from src.db import get_db
from src.tasks.tx_data_backfill import TX_BARS_COLLECTION, tx_data_backfill_task
from src.tasks.tx_data_daily import tx_data_daily_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tx-data", tags=["tx-data"])


# ── Request/Response models ──────────────────────────────────────────────

class BackfillRequest(BaseModel):
    source: str = Field(default="quantpass", description="quantpass | finmind | all")
    years: list[int] | None = Field(default=None, description="quantpass 年度清單，None=預設 2006~2024")
    start: str | None = Field(default=None, description="finmind 起始日 YYYY-MM-DD")
    end: str | None = Field(default=None, description="finmind 結束日 YYYY-MM-DD")


class DailyRequest(BaseModel):
    lookback_days: int = Field(default=7, ge=1, le=30)
    contracts: list[str] | None = Field(default=None, description="預設 ['TXFR1', 'TXFR2']")
    bar_minutes: list[int] | None = Field(default=None, description="預設 [1, 15]")


# ── Status ───────────────────────────────────────────────────────────────

@router.get("/status")
def get_status() -> dict[str, Any]:
    """回報 tx_futures_bars collection 狀態。"""
    db = get_db()
    if not db.has_collection(TX_BARS_COLLECTION):
        return {
            "exists": False,
            "collection": TX_BARS_COLLECTION,
            "available_sources": list_available_sources(),
            "note": "collection 尚未建立，呼叫 POST /backfill 或 POST /daily 後會自動建立",
        }

    col = db.collection(TX_BARS_COLLECTION)
    total = col.count()

    breakdown_cursor = db.aql.execute(
        f"""
        FOR d IN {TX_BARS_COLLECTION}
          COLLECT bm = d.bar_minutes, cont = d.continuous
          AGGREGATE cnt = COUNT(d), first_date = MIN(d.date), last_date = MAX(d.date)
          SORT bm ASC, cont ASC
          RETURN {{ bar_minutes: bm, continuous: cont, count: cnt, first_date: first_date, last_date: last_date }}
        """
    )
    breakdown = list(breakdown_cursor)

    return {
        "exists": True,
        "collection": TX_BARS_COLLECTION,
        "total": total,
        "breakdown": breakdown,
        "available_sources": list_available_sources(),
    }


# ── Backfill ─────────────────────────────────────────────────────────────

@router.post("/backfill")
def start_backfill(req: BackfillRequest) -> dict[str, Any]:
    """啟動歷史回填（丟到 Celery 背景執行）。"""
    config: dict[str, Any] = {"source": req.source}
    if req.years is not None:
        config["years"] = req.years
    if req.start is not None:
        config["start"] = req.start
    if req.end is not None:
        config["end"] = req.end

    async_result = tx_data_backfill_task.delay(config)
    return {
        "task_id": async_result.id,
        "status": "dispatched",
        "config": config,
        "note": "用 task_id 在 Celery flower 或 backend log 查看進度",
    }


# ── Daily ────────────────────────────────────────────────────────────────

@router.post("/daily")
def start_daily(req: DailyRequest) -> dict[str, Any]:
    """觸發每日增量更新。"""
    config: dict[str, Any] = {"lookback_days": req.lookback_days}
    if req.contracts is not None:
        config["contracts"] = req.contracts
    if req.bar_minutes is not None:
        config["bar_minutes"] = req.bar_minutes

    async_result = tx_data_daily_task.delay(config)
    return {
        "task_id": async_result.id,
        "status": "dispatched",
        "config": config,
    }


# ── Query bars ───────────────────────────────────────────────────────────

@router.get("/bars")
def query_bars(
    start: str = Query(..., description="起始日 YYYY-MM-DD"),
    end: str = Query(..., description="結束日 YYYY-MM-DD"),
    contract: str | None = Query(None, description="例如 TXFR1 / TXF202509"),
    continuous: str | None = Query(None, description="R1 / R2 / MAIN"),
    bar_minutes: int = Query(15, description="1 / 5 / 15 / 30 / 60 / 1440 (日)"),
    session: str | None = Query(None, description="day / night（可選）"),
    limit: int = Query(5000, ge=1, le=50000),
) -> dict[str, Any]:
    """查詢 K 線資料。

    範例：
      GET /api/tx-data/bars?start=2024-01-01&end=2024-01-31&continuous=R1&bar_minutes=15
    """
    db = get_db()
    if not db.has_collection(TX_BARS_COLLECTION):
        raise HTTPException(status_code=404, detail=f"collection {TX_BARS_COLLECTION} 不存在")

    # 動態組 AQL
    filters = ["d.date >= @start", "d.date <= @end", "d.bar_minutes == @bm"]
    bind_vars: dict[str, Any] = {
        "start": start,
        "end": end,
        "bm": bar_minutes,
        "limit": limit,
    }
    if contract:
        filters.append("d.contract == @contract")
        bind_vars["contract"] = contract
    if continuous:
        filters.append("d.continuous == @continuous")
        bind_vars["continuous"] = continuous
    if session:
        filters.append("d.session == @session")
        bind_vars["session"] = session

    aql = f"""
    FOR d IN {TX_BARS_COLLECTION}
      FILTER {' AND '.join(filters)}
      SORT d.date ASC, d.time ASC
      LIMIT @limit
      RETURN {{
        date: d.date,
        time: d.time,
        session: d.session,
        contract: d.contract,
        continuous: d.continuous,
        bar_minutes: d.bar_minutes,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
        source: d.source,
      }}
    """
    try:
        cursor = db.aql.execute(aql, bind_vars=bind_vars)
        rows = list(cursor)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AQL 失敗: {exc}") from exc

    return {
        "count": len(rows),
        "limit": limit,
        "filters": {
            "start": start,
            "end": end,
            "contract": contract,
            "continuous": continuous,
            "bar_minutes": bar_minutes,
            "session": session,
        },
        "data": rows,
    }
