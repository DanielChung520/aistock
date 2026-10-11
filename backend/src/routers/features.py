"""Feature-value generation API — trigger and track stock_daily_features jobs."""
from __future__ import annotations

import logging
import uuid
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.db import ensure_collection, get_db
from src.tasks.feature_generate import generate_features_batch
from src.tasks.sensitivity import sensitivity_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/features", tags=["features"])

JOBS_COLLECTION = "feature_jobs"
SENSITIVITY_COLLECTION = "sensitivity_jobs"

SENSITIVITY_TARGETS = {
    "next_return": "隔日漲跌幅",
    "next_5d_return": "5日總漲跌幅",
    "next_direction": "隔日漲跌分類",
    "next_5d_direction": "5日總漲跌分類",
}

# 維度分群：feature 欄位 → 顯示群組（供「生成維度」modal）
DIMENSION_GROUPS = {
    "基礎-價格": ["open", "high", "low", "close", "volume", "o1", "c1"],
    "基礎-技術": ["pct_change", "pct_change_2d", "up_2d", "slope_", "rsi", "kdj_", "macd_", "spread_", "divergence", "alignment_", "three_", "candle_", "near_52w_high", "break_52w_high", "vol_surge", "obv", "vr", "bb_width", "bollinger_", "above_200ma", "breakout_vol_confirm", "pivot_break", "line_of_least", "fly_high_vol", "weekly_slope_30", "institution_accum", "vp_", "day_high", "day_low"],
    "擴充-趨勢": ["ema", "wma", "hma", "kama", "dema", "tema", "vwma", "linearreg", "tsf"],
    "擴充-震盪": ["stochrsi", "willr", "ultosc", "cci", "mfi", "apo", "ppo", "pvo", "roc", "mom", "trix", "adx", "dx", "aroon"],
    "擴充-波動": ["atr", "natr", "stddev", "sar", "midprice", "range3", "max_n", "min_n", "adosc", "cmf", "breakout_high3", "new_high_n", "bb_squeeze"],
    "目標值": ["next_return", "next_5d_return", "next_direction", "next_5d_direction"],
}


def _classify_dimension(name: str) -> str:
    """Assign a feature column name to one of the dimension groups."""
    if name in ("stock_id", "date", "feature_config_hash") or name.startswith("_"):
        return "內部欄位"
    if name.startswith("idx_"):
        return "指數維度"
    for group, prefixes in DIMENSION_GROUPS.items():
        for p in prefixes:
            if name == p or name.startswith(p):
                return group
    return "其他"


class FeatureGenerateRequest(BaseModel):
    stock_ids: list[str] = Field(default_factory=list, description="股票代號清單（universe 非 all 時必填）")
    universe: str = Field(default="", description="'all' = 全市場（≥300 交易日）；空字串 = 用 stock_ids")
    start_date: str = Field(description="生成區間起始日（YYYY-MM-DD）")
    end_date: str = Field(description="生成區間結束日（YYYY-MM-DD）")
    features: dict = Field(default_factory=dict, description="特徵群組設定（key → {enabled, params}）")
    indices: list[str] = Field(default_factory=list, description="啟用指數清單（寫入特徵欄位）")


class SensitivityRequest(BaseModel):
    target: str = Field(description="預測目標（next_return / next_5d_return / next_direction / next_5d_direction）")
    stock_ids: list[str] = Field(default_factory=list, description="分析股票清單")
    start_date: str = Field(description="分析區間起始日")
    end_date: str = Field(description="分析區間結束日")
    model_types: list[str] = Field(default_factory=list, description="要比較的模型（xgboost/lightgbm/randomforest）")
    n_estimators: int = Field(default=100, ge=10, le=500, description="每模型的樹數")


MIN_HISTORY_DAYS = 300  # MA200 / 52w / 250d percentile 的 warmup 下限


def _resolve_universe(db, stock_ids: list[str], universe: str) -> list[str]:
    """Resolve the target stock list; 'all' queries the full market by history."""
    if universe != "all":
        if not stock_ids:
            raise HTTPException(status_code=422, detail="請提供 stock_ids 或 universe='all'")
        return stock_ids
    cursor = db.aql.execute(
        f"""
        FOR d IN stock_daily
        COLLECT sid = d.stock_id WITH COUNT INTO n
        FILTER n >= @min_days
        SORT sid
        RETURN sid
        """,
        bind_vars={"min_days": MIN_HISTORY_DAYS},
    )
    return list(cursor)


@router.post("/generate")
def generate(req: FeatureGenerateRequest) -> dict:
    """Trigger feature generation: create a job and enqueue one task per stock."""
    try:
        start = date.fromisoformat(req.start_date)
        end = date.fromisoformat(req.end_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"日期格式錯誤：{exc}") from exc
    if end < start:
        raise HTTPException(status_code=422, detail="結束日期不能早於起始日期")

    db = get_db()
    stock_ids = _resolve_universe(db, req.stock_ids, req.universe)
    if not stock_ids:
        raise HTTPException(status_code=422, detail="解析後沒有符合條件的股票（universe=all 需 ≥300 交易日）")

    # Run the batch entry synchronously (it only creates the job doc and
    # enqueues per-stock tasks — the heavy compute happens in the workers).
    return generate_features_batch(
        stock_ids=stock_ids,
        start_date=req.start_date,
        end_date=req.end_date,
        features_config=req.features,
        indices=req.indices,
    )


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    """Poll a feature-generation job's progress."""
    db = get_db()
    doc = db.collection(JOBS_COLLECTION).get(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="任務不存在")
    return {
        "job_id": job_id,
        "status": doc.get("status", "unknown"),
        "rows_written": doc.get("rows_written", 0),
        "stocks_total": doc.get("stocks_total"),
        "stocks_done": doc.get("stocks_done"),
        "error": doc.get("error"),
    }


# ── 敏感度分析（多目標 × 多模型特徵重要性） ─────────────────────────────────


@router.get("/sensitivity/targets")
def list_sensitivity_targets() -> dict:
    """List the supported prediction targets for sensitivity analysis."""
    return {"targets": [{"key": k, "label": v} for k, v in SENSITIVITY_TARGETS.items()]}


@router.get("/dimensions")
def get_dimensions() -> dict:
    """List the actual feature dimensions from the generated dataset (grouped).

    Reads a sample stock_daily_features doc and classifies its columns into
    dimension groups, so the user can confirm the generated dimensions match
    their indicator settings.
    """
    db = get_db()
    cursor = db.aql.execute(
        f"""
        FOR d IN stock_daily_features LIMIT 1 RETURN KEYS(d)
        """
    )
    rows = list(cursor)
    if not rows or not rows[0]:
        return {"groups": {}, "total": 0, "sample_date": None}
    keys = sorted(k for k in rows[0] if not k.startswith("_"))
    from collections import defaultdict

    groups: dict[str, list[str]] = defaultdict(list)
    for k in keys:
        groups[_classify_dimension(k)].append(k)
    ordered = {g: groups[g] for g in [
        "基礎-價格", "基礎-技術", "擴充-趨勢", "擴充-震盪", "擴充-波動",
        "指數維度", "目標值", "其他",
    ] if groups[g]}
    return {"groups": ordered, "total": len(keys)}


@router.get("/stats")
def get_stats() -> dict:
    """Return the actual generated dataset stats (proves data exists in DB)."""
    db = get_db()
    c1 = db.aql.execute("FOR d IN stock_daily_features COLLECT WITH COUNT INTO n RETURN n")
    total = next(iter(c1), 0)
    c2 = db.aql.execute("FOR d IN stock_daily_features COLLECT sid = d.stock_id WITH COUNT INTO n RETURN n")
    stocks = len(list(c2))
    c3 = db.aql.execute(
        "FOR d IN stock_daily_features COLLECT h = d.feature_config_hash WITH COUNT INTO n RETURN {h, n}"
    )
    hashes = list(c3)
    c4 = db.aql.execute(
        "FOR d IN stock_daily_features COLLECT AGGREGATE mn = MIN(d.date), mx = MAX(d.date) RETURN {mn, mx}"
    )
    drange = next(iter(c4), {})
    return {
        "total_rows": total,
        "distinct_stocks": stocks,
        "config_hashes": hashes,
        "date_range": drange,
    }


@router.post("/sensitivity")
def run_sensitivity(req: SensitivityRequest) -> dict:
    """Trigger a sensitivity analysis job (XGB/LGBM/RF gain importance)."""
    if req.target not in SENSITIVITY_TARGETS:
        raise HTTPException(status_code=422, detail=f"不支援的目標: {req.target}")
    if not req.stock_ids:
        raise HTTPException(status_code=422, detail="請選擇分析股票")
    try:
        date.fromisoformat(req.start_date)
        date.fromisoformat(req.end_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"日期格式錯誤：{exc}") from exc

    ensure_collection(SENSITIVITY_COLLECTION)
    job_id = uuid.uuid4().hex
    db = get_db()
    db.collection(SENSITIVITY_COLLECTION).insert({
        "_key": job_id,
        "job_id": job_id,
        "status": "running",
        "target": req.target,
        "stock_ids": req.stock_ids,
        "model_types": req.model_types,
        "n_estimators": req.n_estimators,
        "result": None,
        "error": None,
        "created_at": _now(),
        "updated_at": _now(),
    })
    sensitivity_task.delay(
        job_id=job_id,
        target=req.target,
        stock_ids=req.stock_ids,
        start_date=req.start_date,
        end_date=req.end_date,
        model_types=req.model_types or None,
        n_estimators=req.n_estimators,
    )
    return {"job_id": job_id, "status": "running", "target": req.target}


@router.get("/sensitivity/list")
def list_sensitivity_jobs(target: str | None = None, limit: int = 10) -> dict:
    """List sensitivity jobs, newest first.

    Optional ``target`` filter returns only jobs that ran against the given
    prediction target so the frontend can pick the most recent run for that
    target + model combo instead of re-running the heavy analysis.
    """
    db = get_db()
    if target:
        c = db.aql.execute(
            """
            FOR j IN sensitivity_jobs
              FILTER j.target == @target AND j.status == "completed"
              SORT j.created_at DESC
              LIMIT @limit
              RETURN j
            """,
            bind_vars={"target": target, "limit": limit},
        )
    else:
        c = db.aql.execute(
            """
            FOR j IN sensitivity_jobs
              FILTER j.status == "completed"
              SORT j.created_at DESC
              LIMIT @limit
              RETURN j
            """,
            bind_vars={"limit": limit},
        )
    return {
        "items": [
            {
                "job_id": j["_key"],
                "target": j.get("target"),
                "model_types": j.get("model_types"),
                "n_estimators": j.get("n_estimators"),
                "stock_count": len(j.get("stock_ids", [])),
                "created_at": j.get("created_at"),
                "finished_at": j.get("finished_at"),
            }
            for j in c
        ]
    }


@router.get("/sensitivity/{job_id}")
def get_sensitivity(job_id: str) -> dict:
    """Poll a sensitivity analysis job; returns result when completed."""
    db = get_db()
    doc = db.collection(SENSITIVITY_COLLECTION).get(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="敏感度分析任務不存在")
    return {
        "job_id": job_id,
        "status": doc.get("status", "unknown"),
        "target": doc.get("target"),
        "error": doc.get("error"),
        "result": doc.get("result"),
    }


def _now() -> int:
    import time

    return int(time.time())
