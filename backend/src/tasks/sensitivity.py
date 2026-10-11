"""Celery task: feature sensitivity analysis (multi-target × multi-model).

Runs on a generated ``stock_daily_features`` dataset: loads the feature rows
for a target universe, computes the chosen target's label (per-stock,
horizon-aware), then trains XGBoost / LightGBM / RandomForest and records
each model's per-feature gain importance. The result is persisted to the
``sensitivity_jobs`` collection so the frontend can review it later.

Depends only on the ports in ``src.ports`` (FeatureLoader) — no direct
ArangoDB query in the core logic.
"""
from __future__ import annotations

import logging
import time
import traceback
from datetime import date, datetime, timedelta, timezone

from src.adapters import ArangoFeatureLoader
from src.celery_app import celery_app

logger = logging.getLogger(__name__)

JOBS_COLLECTION = "sensitivity_jobs"
WARMUP_DAYS = 400


def _now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _update_job(job_id: str, fields: dict) -> None:
    from arango.exceptions import ArangoError

    from src.db import get_db

    col = get_db().collection(JOBS_COLLECTION)
    for attempt in range(5):
        try:
            col.update({"_key": job_id, **fields})
            return
        except ArangoError:
            if attempt == 4:
                raise
            time.sleep(0.2 * (attempt + 1))


@celery_app.task
def sensitivity_task(
    job_id: str,
    target: str,
    stock_ids: list[str],
    start_date: str,
    end_date: str,
    model_types: list[str] | None = None,
    n_estimators: int = 100,
    loader=None,
) -> dict:
    """Run the sensitivity analysis and persist the importance ranking."""
    loader = loader or ArangoFeatureLoader()
    try:
        from src.ml_training import (
            IMPORTANCE_MODELS,
            TrainingDataError,
            compute_feature_importance,
        )

        window_start = (date.fromisoformat(start_date) - timedelta(days=WARMUP_DAYS)).isoformat()
        rows = loader.load_features(stock_ids, window_start, end_date)
        if not rows:
            raise TrainingDataError("指定股票 + 日期區間內無特徵資料")

        result = compute_feature_importance(
            rows, target, model_types=model_types, n_estimators=n_estimators, device="cpu"
        )
        result["stock_ids"] = stock_ids
        result["start_date"] = start_date
        result["end_date"] = end_date

        _update_job(job_id, {
            "status": "completed",
            "result": result,
            "error": None,
            "finished_at": _now_ts(),
            "updated_at": _now_ts(),
        })
        logger.info("sensitivity %s: completed target=%s models=%s", job_id, target, list(result["models"]))
        return {"ok": True, "job_id": job_id, "status": "completed", "result": result}

    except Exception as exc:
        logger.error("sensitivity %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        _update_job(job_id, {
            "status": "failed",
            "error": str(exc),
            "finished_at": _now_ts(),
            "updated_at": _now_ts(),
        })
        return {"ok": False, "job_id": job_id, "error": str(exc)}