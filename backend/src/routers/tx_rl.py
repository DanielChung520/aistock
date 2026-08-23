"""TX-RL API — manage training jobs and compare results (SPEC TX-0010 §10.1)."""
from __future__ import annotations

import logging
import os
import time
import uuid

from arango import ArangoClient
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.celery_app import celery_app
from src.tasks.tx_rl_training import train_tx_rl_agent_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tx-rl", tags=["tx-rl"])

JOBS_COLLECTION = "tx_rl_training_jobs"
MODELS_COLLECTION = "tx_rl_models"


def _get_db():
    return ArangoClient(hosts="http://localhost:8530").db(
        os.environ.get("ARANGO_DB", "aistock"),
        username="root", password="aistock2024",
    )


class StartRunRequest(BaseModel):
    config: dict = Field(..., description="Full TX RL training config (SPEC §10.1)")


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
    train_tx_rl_agent_task.delay(job_id, req.config)
    return {"job_id": job_id, "status": "pending"}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    """Get job status and progress."""
    db = _get_db()
    if not db.collection(JOBS_COLLECTION).has(job_id):
        raise HTTPException(status_code=404, detail="training job not found")
    doc = db.collection(JOBS_COLLECTION).get(job_id)
    return {
        "job_id": job_id,
        "status": doc.get("status"),
        "progress": {
            "current_step": doc.get("current_step", 0),
            "total_steps": doc.get("total_timesteps", 0),
            "current_reward": doc.get("current_reward", 0.0),
        },
        "started_at": doc.get("started_at"),
        "finished_at": doc.get("finished_at"),
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

    df = _load_twii_df()
    close_list = df["close"].astype(float).tolist()
    dates = df["date"].astype(str).tolist()
    n = len(close_list)
    if n < 30:
        raise HTTPException(status_code=422, detail="insufficient data")

    twii_return = float((close_list[-1] / close_list[0] - 1) * 100)
    buy_hold_twii = {"cumulative_return_pct": twii_return, "name": "Buy & Hold TWII"}

    buy_hold_0050 = {
        "cumulative_return_pct": round(twii_return * 0.78, 2),
        "name": "Buy & Hold 0050 (proxy)",
        "note": "TWII × 0.78 proxy (0050 約 78% 曝險 TWII)",
    }

    highs = df["high"].astype(float).tolist()
    lows = df["low"].astype(float).tolist()
    sigs = calculate_ma_daniel(
        dates, highs, lows, close_list,
        df["volume"].astype(float).tolist(),
        cooldown=1, buy_slope_min=0.05, sell_slope_max=0.02,
    )
    pnl = 0.0
    pos = 0
    entry = 0.0
    trades = 0
    for i, sig in enumerate(sigs):
        if pos == 0 and sig.get("buy"):
            pos = 1
            entry = close_list[i]
        elif pos == 1 and sig.get("sell"):
            pnl += (close_list[i] / entry - 1) * 100
            pos = 0
            trades += 1
    if pos == 1:
        pnl += (close_list[-1] / entry - 1) * 100
        trades += 1
    ma_crossover = {
        "cumulative_return_pct": round(pnl, 2),
        "num_trades": trades,
        "name": "MA5/MA20 Crossover (DanielMA)",
    }

    return {
        "tx_rl_agent": rl_metrics,
        "buy_hold_twii": buy_hold_twii,
        "buy_hold_0050": buy_hold_0050,
        "ma_crossover": ma_crossover,
    }
