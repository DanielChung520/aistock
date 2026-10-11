"""TX-RL API — manage training jobs and compare results (SPEC TX-0010 §10.1)."""
from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path

import pandas as pd
from arango import ArangoClient
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.celery_app import celery_app

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tx-rl", tags=["tx-rl"])

JOBS_COLLECTION = "tx_rl_training_jobs"
MODELS_COLLECTION = "tx_rl_models"

# 台指期 15 分 K 特徵矩陣（build_features.py 產出）
FEATURES_CSV = Path(__file__).resolve().parent.parent.parent.parent / "data" / "台指期-15分K-features.csv"


def _get_db():
    return ArangoClient(hosts="http://localhost:8530").db(
        os.environ.get("ARANGO_DB", "aistock"),
        username="root", password="aistock2024",
    )


class StartRunRequest(BaseModel):
    config: dict = Field(..., description="Full TX RL training config (SPEC §10.1)")


@router.get("/dataset")
def get_dataset(limit: int = 100, offset: int = 0) -> dict:
    """回傳台指期 15 分 K 特徵矩陣的前 N 筆（預覽用）。

    用 nrows 限制讀取量，避免讀全檔（110MB）。回傳原始欄位 + 特徵欄位。
    """
    if not FEATURES_CSV.exists():
        raise HTTPException(status_code=404, detail=f"特徵矩陣不存在：{FEATURES_CSV}。請先執行 data/build_features.py")
    limit = min(max(limit, 1), 500)  # 1~500
    offset = max(offset, 0)
    try:
        df = pd.read_csv(FEATURES_CSV, nrows=offset + limit)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"讀取特徵矩陣失敗：{e}") from e
    df = df.iloc[offset:]
    return {
        "total_rows": len(pd.read_csv(FEATURES_CSV, usecols=["date"])),
        "columns": list(df.columns),
        "rows": df.head(limit).to_dict(orient="records"),
    }


@router.post("/train")
def start_training(req: StartRunRequest) -> dict:
    """Create a training job and dispatch to Celery."""
    job_id = uuid.uuid4().hex
    db = _get_db()
    if not db.has_collection(JOBS_COLLECTION):
        db.create_collection(JOBS_COLLECTION)
    db.collection(JOBS_COLLECTION).insert({
        "_key": job_id,
        "job_id": job_id,
        "status": "pending",
        "config": req.config,
        "created_at": int(time.time()),
    })
    # 離線版排除 torch：stable-baselines3 在 module import 時會拉 torch，
    # 故延遲到真正呼叫訓練時才 import（線上版行為不變）。
    from src.tasks.tx_rl_training import train_tx_rl_agent_task
    train_tx_rl_agent_task.delay(job_id, req.config)
    return {"job_id": job_id, "status": "pending"}


@router.get("/jobs/latest")
def get_latest_job() -> dict:
    """Return the most recent training job, or 404 if none exists.

    Used as fallback when the browser lost sessionStorage (e.g. closed
    tab, cleared cache) so the user can still see their latest results.
    """
    db = _get_db()
    if not db.has_collection(JOBS_COLLECTION):
        raise HTTPException(status_code=404, detail="no training jobs yet")
    cursor = db.aql.execute(
        f"FOR d IN {JOBS_COLLECTION} SORT d.created_at DESC LIMIT 1 RETURN d"
    )
    docs = list(cursor)
    if not docs:
        raise HTTPException(status_code=404, detail="no training jobs yet")
    doc = docs[0]
    return {
        "job_id": doc["job_id"],
        "status": doc.get("status"),
        "created_at": doc.get("created_at"),
        "total_timesteps": doc.get("total_timesteps", 0),
    }


@router.delete("/jobs/{job_id}")
def terminate_job(job_id: str) -> dict:
    """Terminate a running training job.

    Sends Celery revoke (terminate=True) and marks the DB doc as 'stopped'.
    Note: the worker checks for revoke only between learn() calls; an active
    model.learn() will continue until the next checkpoint (~few seconds).
    """
    db = _get_db()
    if not db.collection(JOBS_COLLECTION).has(job_id):
        raise HTTPException(status_code=404, detail="training job not found")
    try:
        celery_app.control.revoke(job_id, terminate=True, signal="SIGTERM")
    except Exception as e:
        logging.warning("celery revoke failed for %s: %s", job_id, e)
    db.collection(JOBS_COLLECTION).update({
        "_key": job_id,
        "status": "stopped",
        "finished_at": int(time.time()),
    })
    return {"job_id": job_id, "status": "stopped"}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    """Get job status and progress with ETA."""
    import time
    db = _get_db()
    if not db.collection(JOBS_COLLECTION).has(job_id):
        raise HTTPException(status_code=404, detail="training job not found")
    doc = db.collection(JOBS_COLLECTION).get(job_id)
    progress = doc.get("progress", {}) or {}
    total_steps = int(doc.get("total_timesteps", 0))
    fold_idx = int(progress.get("fold_idx", 1))
    n_folds = int(progress.get("n_folds", 1))
    current_step = int(progress.get("current_step", 0))
    started_at = doc.get("started_at")
    finished_at = doc.get("finished_at")
    now = int(time.time())

    elapsed = (finished_at or now) - started_at if started_at else 0
    per_fold = total_steps // max(1, n_folds)
    accumulated = (fold_idx - 1) * per_fold + current_step
    rate = accumulated / elapsed if elapsed > 0 else 0
    remaining = max(0, total_steps - accumulated)
    eta_seconds = int(remaining / rate) if rate > 0 else None

    return {
        "job_id": job_id,
        "status": doc.get("status"),
        "progress": {
            "current_step": current_step,
            "total_steps": total_steps,
            "current_reward": progress.get("current_reward", 0.0),
            "fold_idx": fold_idx,
            "n_folds": n_folds,
            "per_fold_steps": per_fold,
            "accumulated_steps": accumulated,
            "last_update_ts": progress.get("last_update_ts", 0),
        },
        "started_at": started_at,
        "finished_at": finished_at,
        "elapsed_seconds": elapsed,
        "eta_seconds": eta_seconds,
    }


@router.get("/jobs/{job_id}/result")
def get_result(job_id: str) -> dict:
    """Get full training result (metrics + config)."""
    db = _get_db()
    if not db.collection(MODELS_COLLECTION).has(job_id):
        raise HTTPException(status_code=404, detail="result not ready")
    doc = db.collection(MODELS_COLLECTION).get(job_id)
    return {
        "job_id": job_id,
        "metrics": doc.get("metrics"),
        "config": doc.get("config"),
        "model_path": doc.get("model_path"),
        "fold_metrics": doc.get("fold_metrics"),
        "n_episodes": doc.get("n_episodes"),
        "training_rewards": doc.get("training_rewards"),
        "equity_curve": doc.get("equity_curve"),
        "trade_list": doc.get("trade_list"),
    }


@router.post("/compare")
def compare_with_baselines(req: dict) -> dict:
    """Compute and return baselines (Buy & Hold 0050, TWII, MA5/MA20) for comparison."""
    import numpy as np
    import pandas as pd

    from src.indicators import calculate_ma_daniel
    from src.tasks.tx_rl_training import _load_twii_df

    job_id = req.get("job_id")
    db = _get_db()
    if not db.collection(MODELS_COLLECTION).has(job_id):
        raise HTTPException(status_code=404, detail="result not found")
    rl_doc = db.collection(MODELS_COLLECTION).get(job_id)
    rl_metrics = rl_doc.get("metrics", {})
    rl_equity = rl_doc.get("equity_curve", [])
    rl_trades = rl_doc.get("trade_list", [])
    rl_rewards = rl_doc.get("episode_rewards", [])

    df = _load_twii_df()
    eval_start, eval_end = None, None
    data_range = (rl_metrics or {}).get("data_range", {})
    if data_range.get("eval"):
        eval_start = data_range["eval"]["start"]
        eval_end = data_range["eval"]["end"]
    elif rl_equity and len(rl_equity) > 0:
        eval_start = rl_equity[0]["date"]
        eval_end = rl_equity[-1]["date"]
    if eval_start and eval_end:
        df = df[(df["date"] >= eval_start) & (df["date"] <= eval_end)].reset_index(drop=True)
    close_list = df["close"].astype(float).tolist()
    dates = df["date"].astype(str).tolist()
    n = len(close_list)
    if n < 30:
        raise HTTPException(status_code=422, detail="insufficient data")

    twii_return = float((close_list[-1] / close_list[0] - 1) * 100)
    twii_equity = [
        {"date": dates[i], "equity": round(close_list[i] / close_list[0], 4), "drawdown": 0.0}
        for i in range(n)
    ]
    twii_peak = close_list[0]
    for i in range(n):
        twii_peak = max(twii_peak, close_list[i])
        dd = (close_list[i] / twii_peak - 1)
        twii_equity[i]["drawdown"] = round(dd, 4)
    buy_hold_twii = {
        "cumulative_return_pct": round(twii_return, 2),
        "name": "Buy & Hold TWII",
        "equity_curve": twii_equity,
    }

    ratio_0050 = 0.78
    bh0050_equity = [
        {"date": dates[i], "equity": round(1.0 + ratio_0050 * (close_list[i] / close_list[0] - 1), 4), "drawdown": 0.0}
        for i in range(n)
    ]
    bh0050_peak = 1.0
    for i in range(n):
        bh0050_peak = max(bh0050_peak, bh0050_equity[i]["equity"])
        bh0050_equity[i]["drawdown"] = round(bh0050_equity[i]["equity"] / bh0050_peak - 1, 4)
    buy_hold_0050 = {
        "cumulative_return_pct": round(twii_return * ratio_0050, 2),
        "name": "Buy & Hold 0050 (proxy)",
        "note": "TWII × 0.78 proxy (0050 約 78% 曝險 TWII)",
        "equity_curve": bh0050_equity,
    }

    highs = df["high"].astype(float).tolist()
    lows = df["low"].astype(float).tolist()
    sigs = calculate_ma_daniel(
        dates, highs, lows, close_list,
        df["volume"].astype(float).tolist(),
        cooldown=1, buy_slope_min=0.05, sell_slope_max=0.02,
    )
    pnl_pct = 0.0
    pos = 0
    entry = 0.0
    trades = 0
    ma_equity = []
    ma_peak = 0.0
    for i, sig in enumerate(sigs):
        if pos == 0 and sig.get("buy"):
            pos = 1
            entry = close_list[i]
        elif pos == 1 and sig.get("sell"):
            pnl_pct += (close_list[i] / entry - 1) * 100
            pos = 0
            trades += 1
        eq = 1.0 + pnl_pct / 100.0
        ma_peak = max(ma_peak, eq)
        dd = (eq / ma_peak - 1) if ma_peak > 0 else 0.0
        ma_equity.append({"date": dates[i], "equity": round(eq, 4), "drawdown": round(dd, 4)})
    if pos == 1:
        pnl_pct += (close_list[-1] / entry - 1) * 100
        trades += 1
    ma_crossover = {
        "cumulative_return_pct": round(pnl_pct, 2),
        "num_trades": int(trades) if not (data_range.get("n_folds", 1) > 1) else round(float(trades), 1),
        "name": "MA5/MA20 Crossover (DanielMA)",
        "equity_curve": ma_equity,
    }

    is_wf = bool(data_range.get("n_folds", 1) > 1)
    if is_wf:
        agent_metrics = {
            "cumulative_return_pct": rl_metrics.get("cumulative_return_pct_mean", 0),
            "cumulative_return_pct_std": rl_metrics.get("cumulative_return_pct_std", 0),
            "sharpe": rl_metrics.get("sharpe_mean", 0),
            "sortino": rl_metrics.get("sortino_mean", 0),
            "calmar": rl_metrics.get("calmar_mean", 0),
            "max_drawdown_pct": rl_metrics.get("max_drawdown_pct_mean", 0),
            "win_rate_pct": rl_metrics.get("win_rate_pct_mean", 0),
            "num_trades": rl_metrics.get("num_trades_mean", 0),
            "n_folds": rl_metrics.get("n_folds", 1),
            "is_walk_forward": True,
        }
    else:
        agent_metrics = {
            "cumulative_return_pct": rl_metrics.get("cumulative_return_pct", 0),
            "sharpe": rl_metrics.get("sharpe", 0),
            "sortino": rl_metrics.get("sortino", 0),
            "calmar": rl_metrics.get("calmar", 0),
            "max_drawdown_pct": rl_metrics.get("max_drawdown_pct", 0),
            "win_rate_pct": rl_metrics.get("win_rate_pct", 0),
            "num_trades": rl_metrics.get("num_trades", 0),
            "is_walk_forward": False,
        }
    return {
        "tx_rl_agent": {
            **agent_metrics,
            "equity_curve": rl_equity,
            "trade_list": rl_trades,
            "episode_rewards": rl_rewards,
        },
        "buy_hold_twii": buy_hold_twii,
        "buy_hold_0050": buy_hold_0050,
        "ma_crossover": ma_crossover,
    }
