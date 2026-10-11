"""Celery task: real ML training for ai_training_jobs (spec §九/§十六).

Reads ``stock_daily_features`` for the project's stock list + date range,
computes the label Y on the fly (per-stock shift(-1), §三), splits
time-sequentially (no shuffle, §四), applies scaler fit on train only (§六),
trains XGBoost/LightGBM/RandomForest/MLP with warm_start chunked progress
writes, then evaluates train/val/test (§十一).

The task depends only on the ports in ``src.ports`` (FeatureLoader / JobStore).
The ArangoDB-backed adapters in ``src.adapters`` are the defaults; tests and a
standalone deployment inject their own implementations. Progress: the job doc
is updated every N epochs with current_epoch / train_loss / val_loss so the
frontend polling sees real numbers.
"""
from __future__ import annotations

import logging
import time
import traceback
from collections import Counter

from src.adapters import ArangoFeatureLoader, ArangoJobStore
from src.celery_app import celery_app

logger = logging.getLogger(__name__)

PROGRESS_MIN_CHUNK_SECONDS = 30
PROGRESS_MIN_CHUNKS = 5

FEATURES_COLLECTION = "stock_daily_features"
SENSITIVITY_COLLECTION = "sensitivity_jobs"


def _now() -> int:
    return int(time.time())


def _release_training_memory(est, data) -> None:
    """Release model + frame caches once a training run is over.

    PyTorch's CUDA caching allocator keeps blocks around for reuse, so
    a worker that ran one LSTM keeps ~0.8 GB of VRAM pinned until it
    dies. Call this in the ``finally`` so the worker process returns
    close to its idle footprint.
    """
    import gc

    gc.collect()
    if hasattr(est, "_model") and est._model is not None:
        del est._model
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except ImportError:
        pass
    for key in (
        "X_train", "X_val", "X_test",
        "y_train", "y_val", "y_test",
        "rows", "windows",
    ):
        if isinstance(data, dict) and key in data:
            data[key] = None
    gc.collect()


def _loss(y_true, y_pred, task: str) -> float | None:
    """Chunk loss used for the progress curve."""
    import numpy as np

    from sklearn.metrics import log_loss, root_mean_squared_error

    if task == "regression":
        return round(float(root_mean_squared_error(y_true, y_pred)), 6)
    try:
        return round(float(log_loss(y_true, y_pred, labels=[0, 1])), 6)
    except ValueError:
        return None


def _chunk_size_for(n_total: int) -> int:
    """Pick a chunk size so progress updates land roughly every 30-60s.

    Empirical per-epoch cost on the heaviest path (mlp, universe=all,
    ~663k train rows) is ~23s, so a 2-epoch chunk is the right cadence.
    Lighter models get bigger chunks so we still cap total updates at
    PROGRESS_MIN_CHUNKS to keep the loss curve readable.
    """
    target_seconds = 50
    per_epoch_seconds = 23
    by_time = max(1, round(target_seconds / per_epoch_seconds))
    by_min_chunks = max(1, n_total // PROGRESS_MIN_CHUNKS)
    chunk = max(1, min(by_time, by_min_chunks))
    return min(chunk, n_total)


def _fit_chunk(est, n_done: int, chunk: int, X_train, y_train, eval_set=None) -> None:
    """Advance the warm_start model by one chunk and refit.

    Tree models grow n_estimators to ``n_done``; MLP advances max_iter by
    ``chunk`` (warm_start=True keeps prior weights, so each fit() continues
    training instead of restarting).
    """
    if hasattr(est, "n_estimators"):
        est.n_estimators = n_done
        if eval_set is not None and _supports_early_stopping(est):
            try:
                est.fit(X_train, y_train, eval_set=eval_set, verbose=False)
            except TypeError:
                est.fit(X_train, y_train)
        else:
            est.fit(X_train, y_train)
    else:
        est.max_iter = chunk
        est.fit(X_train, y_train)


def _supports_early_stopping(est) -> bool:
    """XGBoost 3.x requires eval_set when early_stopping_rounds > 0."""
    if hasattr(est, "early_stopping_rounds"):
        return est.early_stopping_rounds is not None and est.early_stopping_rounds > 0
    return False


def _predict(est, X, groups=None):
    """Predict, passing per-row stock groups for LSTM (other models ignore)."""
    if getattr(est, "IS_LSTM", False):
        return est.predict(X, groups=groups)
    return est.predict(X)


def _build_backtest(data: dict, est, task: str, X_val, y_val_raw, X_test, y_test_raw) -> tuple[dict | None, dict | None]:
    """Compute Step 6 backtest track: snapshot + default-threshold results.

    For regression targets, predicts val/test next-day returns, collapses the
    multi-stock universe into a daily cross-sectional mean signal, and stores:
      - ``backtest_results``: stats at default thresholds (buy 0.5% / sell -0.5%)
      - ``backtest_snapshot``: per-day mean (date, y, pred) arrays so the
        router's POST /backtest can re-run at user-chosen thresholds without
        reloading the model.

    For classification targets, translates the predicted probability into a
    long/flat strategy using a 0.5 buy threshold, then stores:
      - ``backtest_results``: same shape as regression (total return, win rate,
        max drawdown, precision/recall at the threshold)
      - ``backtest_snapshot``: per-day mean (date, raw_return, prob) so the
        router can re-run at user-chosen thresholds.
    """
    import numpy as np
    import pandas as pd

    from src.ml_training import run_classification_backtest, run_prediction_backtest

    pred_val = _predict(est, X_val, data.get("stock_val"))
    pred_test = _predict(est, X_test, data.get("stock_test"))

    if task == "regression":
        def _daily(snapshot_dates, y_arr, pred_arr) -> dict:
            df = pd.DataFrame({"date": [str(d) for d in snapshot_dates], "y": y_arr, "pred": pred_arr})
            daily = df.groupby("date", sort=True).agg(y=("y", "mean"), pred=("pred", "mean")).reset_index()
            return {
                "dates": daily["date"].tolist(),
                "y": [round(float(v), 8) for v in daily["y"]],
                "pred": [round(float(v), 8) for v in daily["pred"]],
            }

        snapshot = {
            "val": _daily(data["dates_val"], y_val_raw, pred_val),
            "test": _daily(data["dates_test"], y_test_raw, pred_test),
        }
        results = {
            "val": run_prediction_backtest(
                snapshot["val"]["dates"], snapshot["val"]["y"], snapshot["val"]["pred"]
            ),
            "test": run_prediction_backtest(
                snapshot["test"]["dates"], snapshot["test"]["y"], snapshot["test"]["pred"]
            ),
        }
        return results, snapshot

    raw_val = data.get("raw_return_val")
    raw_test = data.get("raw_return_test")
    if raw_val is None or raw_test is None:
        return None, None

    def _daily_cls(snapshot_dates, raw_arr, prob_arr) -> dict:
        df = pd.DataFrame({
            "date": [str(d) for d in snapshot_dates],
            "raw_return": raw_arr,
            "prob": prob_arr,
        })
        daily = df.groupby("date", sort=True).agg(
            raw_return=("raw_return", "mean"), prob=("prob", "mean")
        ).reset_index()
        return {
            "dates": daily["date"].tolist(),
            "raw_return": [round(float(v), 8) for v in daily["raw_return"]],
            "prob": [round(float(v), 8) for v in daily["prob"]],
        }

    snapshot = {
        "val": _daily_cls(data["dates_val"], raw_val, pred_val),
        "test": _daily_cls(data["dates_test"], raw_test, pred_test),
    }
    results = {
        "val": run_classification_backtest(
            snapshot["val"]["dates"], snapshot["val"]["raw_return"], snapshot["val"]["prob"]
        ),
        "test": run_classification_backtest(
            snapshot["test"]["dates"], snapshot["test"]["raw_return"], snapshot["test"]["prob"]
        ),
    }
    return results, snapshot


def _feature_provenance(rows: list[dict]) -> dict:
    """Summarise the feature-config hashes observed across the loaded rows.

    Each ``stock_daily_features`` doc carries the hash of the config that
    produced it (written by ``src.tasks.feature_generate``). Rows generated
    before that field existed have None — they are counted separately so a
    legacy dataset still trains.
    """
    counter = Counter(row.get("feature_config_hash") for row in rows)
    hashes = sorted(h for h in counter if h)
    return {
        "feature_config_hashes": hashes,
        "hashed_rows": sum(counter.values()) - (counter.get(None) or 0),
        "total_rows": len(rows),
    }


def _all_feature_stocks() -> list[str]:
    """Resolve all distinct stock_ids present in stock_daily_features."""
    from src.db import get_db

    db = get_db()
    cursor = db.aql.execute(
        f"""
        FOR d IN {FEATURES_COLLECTION}
        COLLECT sid = d.stock_id
        SORT sid
        RETURN sid
        """
    )
    return list(cursor)


def _resolve_feature_subset(selection: dict | None, fallback_target: str) -> list[str] | None:
    """Translate ``feature_selection`` config into a concrete column list.

    Modes:
      - ``{"mode": "all"}`` or empty/missing → ``None`` (use every column).
      - ``{"mode": "top_n", "target": "...", "top_n": 30}`` → fetch the most
        recent completed sensitivity job for that target and union the top-N
        columns across all model types, deduped in original ranking order.
    """
    if not selection:
        return None
    mode = selection.get("mode", "all")
    if mode == "all":
        return None
    if mode != "top_n":
        logger.warning("train: 未知的 feature_selection.mode=%s，使用全部特徵", mode)
        return None

    target = selection.get("target") or fallback_target
    top_n = int(selection.get("top_n", 30))
    if top_n <= 0:
        return None

    from src.db import get_db

    db = get_db()
    c = db.aql.execute(
        """
        FOR j IN @@coll
          FILTER j.target == @target AND j.status == "completed"
          SORT j.created_at DESC
          LIMIT 1
          RETURN j
        """,
        bind_vars={"@coll": SENSITIVITY_COLLECTION, "target": target},
    )
    docs = list(c)
    if not docs:
        logger.warning("train: 找不到 target=%s 的 sensitivity job，使用全部特徵", target)
        return None

    job = docs[0]
    models = (job.get("result") or {}).get("models") or {}
    seen: set[str] = set()
    selected: list[str] = []
    for importance in models.values():
        for col in (importance or {}).keys():
            if col in seen:
                continue
            seen.add(col)
            selected.append(col)
            if len(selected) >= top_n:
                break
        if len(selected) >= top_n:
            break
    return selected


@celery_app.task
def train_model_task(job_id: str, loader=None, store=None) -> dict:
    """Run real training on the project doc identified by job_id.

    ``loader`` / ``store`` are the FeatureLoader / JobStore implementations
    (default: the ArangoDB adapters). Tests inject in-memory fakes.
    """
    loader = loader or ArangoFeatureLoader()
    store = store or ArangoJobStore()

    doc = store.get(job_id)
    if not doc:
        return {"ok": False, "job_id": job_id, "error": "訓練項目不存在"}

    snapshot = doc.get("config_snapshot") or {}
    model_type = snapshot.get("model_type") or doc.get("model_type") or "xgboost"
    model_params = snapshot.get("model_params") or {}
    data_cfg = snapshot.get("data") or {}
    split_cfg = snapshot.get("split") or {}
    prep_cfg = snapshot.get("preprocessing") or {}
    feature_selection = snapshot.get("feature_selection")

    target = data_cfg.get("target", "next_return")
    stock_ids = data_cfg.get("stock_ids") or []
    universe = data_cfg.get("universe") or ""
    start_date = data_cfg.get("start_date")
    end_date = data_cfg.get("end_date")
    ratios = split_cfg.get("ratios") or [0.7, 0.15, 0.15]
    scaler_name = prep_cfg.get("scaler", "none")
    winsorize_threshold = prep_cfg.get("winsorize_threshold")

    try:
        from src.ml_training import (
            SUPPORTED_MODELS,
            TrainingDataError,
            TrainingStopRequested,
            _resolve_device,
            build_model,
            compute_metrics,
            prepare_frame,
            winsorize,
        )

        if model_type not in SUPPORTED_MODELS:
            raise TrainingDataError(f"模型 {model_type} 尚未支援")

        # 1. resolve stock universe (all → 全市場 from stock_daily_features)
        if universe == "all" or not stock_ids:
            if universe == "all":
                stock_ids = _all_feature_stocks()
            if not stock_ids:
                raise TrainingDataError("無法解析訓練股票清單（stock_ids 或 universe 皆空）")

        if store.stop_requested(job_id):
            raise TrainingStopRequested(f"train {job_id}: stopped before loading features")

        logger.info("train %s: loading features for %d stocks", job_id, len(stock_ids))
        rows = loader.load_features(stock_ids, start_date, end_date)
        if not rows:
            raise TrainingDataError("指定股票 + 日期區間內無特徵資料")

        if store.stop_requested(job_id):
            raise TrainingStopRequested(f"train {job_id}: stopped after loading features")

        # 1.5 data provenance — flag rows produced by different feature configs
        provenance = _feature_provenance(rows)
        if len(provenance["feature_config_hashes"]) > 1:
            logger.warning(
                "train %s: 混合特徵設定 %s（重訓前建議重新產生特徵）",
                job_id, provenance["feature_config_hashes"],
            )

        # 2. prepare (Y + time split + median fill)
        feature_subset = _resolve_feature_subset(feature_selection, fallback_target=target)
        if feature_subset is not None:
            logger.info(
                "train %s: 套用特徵子集 %d 欄位 (mode=%s)",
                job_id, len(feature_subset),
                (feature_selection or {}).get("mode", "?"),
            )
        data = prepare_frame(rows, target, ratios, feature_subset=feature_subset)
        if store.stop_requested(job_id):
            raise TrainingStopRequested(f"train {job_id}: stopped after prepare_frame")
        task = data["task"]
        X_train, y_train = data["X_train"], data["y_train"]
        X_val, y_val = data["X_val"], data["y_val"]
        X_test, y_test = data["X_test"], data["y_test"]

        # 3. winsorize Y (fit bounds on train) — keep raw for backtest PnL
        y_val_raw, y_test_raw = data["y_val"], data["y_test"]
        y_train, y_val, y_test, _bounds = winsorize(
            y_train, y_val, y_test, winsorize_threshold
        )

        # 4. scaler — fit on train only (§六)
        scaler = None
        if scaler_name != "none":
            from sklearn.preprocessing import MinMaxScaler, RobustScaler, StandardScaler

            scaler_cls = {
                "standard": StandardScaler,
                "robust": RobustScaler,
                "minmax": MinMaxScaler,
            }.get(scaler_name)
            if scaler_cls is None:
                raise TrainingDataError(f"不支援的 scaler: {scaler_name}")
            scaler = scaler_cls().fit(X_train)
            X_train = scaler.transform(X_train)
            X_val = scaler.transform(X_val)
            X_test = scaler.transform(X_test)

        # 5. model
        est, n_total = build_model(
            model_type, model_params, task, device=snapshot.get("device", "auto")
        )
        # LSTM slices per-stock sequences — give it the row→stock mapping.
        if hasattr(est, "set_groups"):
            est.set_groups(data["stock_train"])
        store.update(job_id, {
            "status": "running",
            "current_epoch": 0,
            "total_epochs": n_total,
            "n_samples": data["n_samples"],
            "train_loss": None,
            "val_loss": None,
            "loss_history": [],
            "metrics": None,
            "backtest_results": None,
            "error": None,
            "started_at": _now(),
            "updated_at": _now(),
        })
        logger.info(
            "train %s: %s %s target=%s samples=%s epochs=%d scaler=%s",
            job_id, model_type, task, target, data["n_samples"], n_total, scaler_name,
        )

        # 6. chunked training with progress (warm_start)
        chunk = _chunk_size_for(n_total)
        stopped = False
        loss_history: list[dict] = []
        eval_set = [(X_val, y_val)] if _supports_early_stopping(est) else None
        for n_done in range(chunk, n_total + 1, chunk):
            _fit_chunk(est, n_done, chunk, X_train, y_train, eval_set)
            pred_train = _predict(est, X_train, data.get("stock_train"))
            pred_val = _predict(est, X_val, data.get("stock_val"))
            train_loss = _loss(y_train, pred_train, task)
            val_loss = _loss(y_val, pred_val, task)
            loss_history.append({
                "epoch": min(n_done, n_total),
                "train": train_loss,
                "val": val_loss,
            })
            store.update(job_id, {
                "current_epoch": min(n_done, n_total),
                "train_loss": train_loss,
                "val_loss": val_loss,
                "loss_history": loss_history,
                "updated_at": _now(),
            })
            if store.stop_requested(job_id):
                stopped = True
                break
        if n_done < n_total and not stopped:
            # finish the tail chunk if n_total is not a multiple of chunk
            _fit_chunk(est, n_total, chunk, X_train, y_train, eval_set)
            tail_train = _loss(y_train, _predict(est, X_train, data.get("stock_train")), task)
            tail_val = _loss(y_val, _predict(est, X_val, data.get("stock_val")), task)
            loss_history.append({
                "epoch": n_total,
                "train": tail_train,
                "val": tail_val,
            })
            store.update(job_id, {
                "current_epoch": n_total,
                "train_loss": tail_train,
                "val_loss": tail_val,
                "loss_history": loss_history,
                "updated_at": _now(),
            })

        if stopped:
            store.update(job_id, {
                "status": "stopped",
                "finished_at": _now(),
                "updated_at": _now(),
            })
            return {"ok": True, "job_id": job_id, "status": "stopped"}

        # 7. final evaluation on train/val/test (§十一)
        metrics = {
            "train": compute_metrics(y_train, _predict(est, X_train, data.get("stock_train")), task),
            "val": compute_metrics(y_val, _predict(est, X_val, data.get("stock_val")), task),
            "test": compute_metrics(y_test, _predict(est, X_test, data.get("stock_test")), task),
        }
        backtest_results, backtest_snapshot = _build_backtest(
            data, est, task, X_val, y_val_raw, X_test, y_test_raw
        )
        from src.model_artifacts import persist_trained

        artifact = persist_trained(
            job_id, est, scaler, data["feature_columns"], model_type
        )
        store.update(job_id, {
            "status": "completed",
            "device": str(_resolve_device(snapshot.get("device", "auto"))),
            "n_samples": data["n_samples"],
            "metrics": metrics,
            "backtest_results": backtest_results,
            "backtest_snapshot": backtest_snapshot,
            "artifact": artifact,
            "data_provenance": provenance,
            "finished_at": _now(),
            "updated_at": _now(),
        })
        logger.info("train %s: completed %s", job_id, metrics["val"])
        return {"ok": True, "job_id": job_id, "status": "completed", "metrics": metrics}

    except TrainingStopRequested as exc:
        logger.info("train %s: %s", job_id, exc)
        store.update(job_id, {
            "status": "stopped",
            "error": str(exc),
            "finished_at": _now(),
            "updated_at": _now(),
        })
        return {"ok": True, "job_id": job_id, "status": "stopped"}

    except Exception as exc:
        logger.error("train %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        store.update(job_id, {
            "status": "failed",
            "error": str(exc),
            "finished_at": _now(),
            "updated_at": _now(),
        })
        return {"ok": False, "job_id": job_id, "error": str(exc)}

    finally:
        _release_training_memory(est, data)