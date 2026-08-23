"""AI-training API — manage ai_training_jobs (projects + single run)."""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.db import ensure_collection, get_db
from src.tasks.ai_training import train_model_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-training", tags=["ai-training"])

JOBS_COLLECTION = "ai_training_jobs"
MODELS_COLLECTION = "model_artifacts"


# ── Schemas ──

class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128, description="訓練項目名稱")
    tags: list[str] = Field(default_factory=list, description="多選 tag")
    description: str = Field(default="", description="選填說明")


class StartRunRequest(BaseModel):
    job_id: str = Field(description="要啟動的訓練項目 ID")
    model_type: str = Field(description="xgboost | lightgbm | randomforest | mlp | lstm")
    model_params: dict = Field(default_factory=dict)
    data: dict = Field(description="{target, stock_ids, start_date, end_date}")
    split: dict = Field(description="{method, ratios}")
    preprocessing: dict = Field(default_factory=dict)
    device: str = Field(default="auto", description="auto | cuda | cpu")
    feature_selection: dict | None = Field(
        default=None,
        description="特徵子集：{mode: all|top_n, target: <sensitivity target>, top_n: <int>}",
    )


# ── Projects（訓練項目） ──

@router.post("/projects")
def create_project(req: CreateProjectRequest) -> dict:
    """Create a training project doc with status=pending."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    job_id = uuid.uuid4().hex
    col = db.collection(JOBS_COLLECTION)
    doc = {
        "_key": job_id,
        "name": req.name,
        "tags": req.tags,
        "description": req.description,
        "model_type": None,
        "status": "pending",
        "current_epoch": 0,
        "total_epochs": 0,
        "train_loss": None,
        "val_loss": None,
        "metrics": None,
        "backtest_results": None,
        "config_snapshot": None,
        "created_at": _now(),
        "created_by": None,
        "updated_at": _now(),
        "finished_at": None,
        "error": None,
    }
    col.insert(doc, overwrite=True)
    return {"job_id": job_id, "status": "pending"}


@router.get("/projects")
def list_projects(
    status: list[str] | None = Query(default=None, description="多選狀態過濾"),
    tags: list[str] | None = Query(default=None),
    model_type: list[str] | None = Query(default=None),
    q: str | None = Query(default=None, description="名稱模糊搜尋"),
) -> dict:
    """List training projects for the index page."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    col = db.collection(JOBS_COLLECTION)

    bind_vars: dict = {}
    filters: list[str] = []
    if status:
        filters.append("d.status IN @status")
        bind_vars["status"] = status
    if model_type:
        filters.append("d.model_type IN @model_type")
        bind_vars["model_type"] = model_type
    if tags:
        # any-of: 任何 tag 命中即可
        filters.append("LENGTH(INTERSECTION(d.tags, @tags)) > 0")
        bind_vars["tags"] = tags
    if q:
        filters.append("LIKE(d.name, @q, true)")
        bind_vars["q"] = f"%{q}%"
    where = f"FILTER {' AND '.join(filters)}" if filters else ""
    aql = f"""
        FOR d IN {JOBS_COLLECTION}
        {where}
        SORT d.updated_at DESC
        RETURN {{
            job_id: d._key,
            name: d.name,
            tags: d.tags,
            description: d.description,
            model_type: d.model_type,
            status: d.status,
            created_at: d.created_at,
            updated_at: d.updated_at,
            finished_at: d.finished_at,
            test_metric: d.metrics != null ? d.metrics.test : null,
            config_snapshot: d.config_snapshot
        }}
    """
    cursor = db.aql.execute(aql, bind_vars=bind_vars)
    items = list(cursor)
    return {"items": items, "total": len(items)}


@router.get("/projects/{job_id}")
def get_project(job_id: str) -> dict:
    """Get a single training project's full doc (for wizard to load settings)."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    doc = db.collection(JOBS_COLLECTION).get(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    out = _serialize(doc)
    out["backtest_results"] = _backtest_with_series(doc)
    return out


def _backtest_with_series(doc: dict) -> dict | None:
    """Attach per-day (date, y, pred) series to backtest_results.

    Newer jobs store ``series`` inside backtest_results directly (written by
    ``run_prediction_backtest``). Older jobs only have ``backtest_snapshot``
    (per-day mean date/y/pred arrays) — rebuild the series from it so the
    Step 6 charts render for existing projects too.
    """
    results = doc.get("backtest_results")
    snapshot = doc.get("backtest_snapshot")
    if not results or not snapshot:
        return results
    for split in ("val", "test"):
        part = results.get(split)
        snap = snapshot.get(split)
        if not part or not snap or part.get("series"):
            continue
        dates = snap.get("dates") or []
        ys = snap.get("y") or []
        preds = snap.get("pred") or []
        if len(dates) == len(ys) == len(preds):
            part["series"] = [
                {"date": d, "y": float(y), "pred": float(p)}
                for d, y, p in zip(dates, ys, preds)
            ]
    return results


class PatchProjectRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128, description="新名稱（省略 = 不改）")
    tags: list[str] | None = Field(default=None, description="新 tags（省略 = 不改）")
    description: str | None = Field(default=None, description="新描述（省略 = 不改）")


@router.patch("/projects/{job_id}")
def patch_project(job_id: str, req: PatchProjectRequest) -> dict:
    """Update editable metadata (name/tags/description). Bumps updated_at."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    col = db.collection(JOBS_COLLECTION)
    if not col.get(job_id):
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    update: dict = {"_key": job_id, "updated_at": _now()}
    if req.name is not None:
        update["name"] = req.name
    if req.tags is not None:
        update["tags"] = req.tags
    if req.description is not None:
        update["description"] = req.description
    col.update(update)
    return {"job_id": job_id, "updated": True}


@router.delete("/projects/{job_id}")
def delete_project(job_id: str) -> dict:
    """Delete a training project (v1: hard delete; no soft delete yet)."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    col = db.collection(JOBS_COLLECTION)
    if not col.get(job_id):
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    col.delete(job_id)
    return {"job_id": job_id, "deleted": True}


class BatchDeleteRequest(BaseModel):
    """Batch-delete training projects. Skips running jobs (those must be stopped first)."""
    job_ids: list[str] = Field(min_length=1, description="要刪除的訓練項目 ID 列表")


@router.post("/projects/batch-delete")
def batch_delete_projects(req: BatchDeleteRequest) -> dict:
    """Delete multiple training projects atomically per-id.

    Returns per-id outcome so the frontend can surface partial failures:
      - ``deleted`` — successfully removed
      - ``not_found`` — ids that never existed
      - ``blocked`` — ids skipped because they're currently ``running``
        (user must stop the run first)
    """
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    col = db.collection(JOBS_COLLECTION)

    deleted: list[str] = []
    not_found: list[str] = []
    blocked: list[dict] = []

    # Deduplicate input order, preserve first-seen order
    seen: set[str] = set()
    ordered_ids: list[str] = []
    for jid in req.job_ids:
        if jid not in seen:
            seen.add(jid)
            ordered_ids.append(jid)

    for jid in ordered_ids:
        doc = col.get(jid)
        if not doc:
            not_found.append(jid)
            continue
        if doc.get("status") == "running":
            blocked.append({
                "job_id": jid,
                "name": doc.get("name", ""),
                "reason": "running",
            })
            continue
        col.delete(jid)
        deleted.append(jid)

    return {"deleted": deleted, "not_found": not_found, "blocked": blocked}


# ── Runs（從既有 project 啟動訓練） ──

@router.post("/jobs")
def start_run(req: StartRunRequest) -> dict:
    """Start a training run on an existing project (overwrites status + config_snapshot)."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    col = db.collection(JOBS_COLLECTION)
    doc = col.get(req.job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    if doc.get("status") == "running":
        raise HTTPException(status_code=409, detail="已有訓練在進行中")

    snapshot = {
        "model_type": req.model_type,
        "model_params": req.model_params,
        "data": req.data,
        "split": req.split,
        "preprocessing": req.preprocessing,
        "device": req.device,
        "feature_selection": req.feature_selection,
    }
    col.update({
        "_key": req.job_id,
        "model_type": req.model_type,
        "status": "running",
        "current_epoch": 0,
        "total_epochs": 0,
        "train_loss": None,
        "val_loss": None,
        "metrics": None,
        "backtest_results": None,
        "config_snapshot": snapshot,
        "error": None,
        "stop_requested": False,
        "updated_at": _now(),
        "finished_at": None,
    })
    train_model_task.delay(req.job_id)
    return {"job_id": req.job_id, "status": "running"}


@router.post("/jobs/{job_id}/stop")
def stop_run(job_id: str) -> dict:
    """Set the graceful-stop flag; the worker checks it between epochs (§九)."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    col = db.collection(JOBS_COLLECTION)
    doc = col.get(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    if doc.get("status") != "running":
        raise HTTPException(status_code=409, detail="僅 running 狀態可停止")
    col.update({"_key": job_id, "stop_requested": True, "updated_at": _now()})
    return {"job_id": job_id, "stop_requested": True}


@router.get("/jobs/{job_id}")
def get_run(job_id: str) -> dict:
    """Poll training run progress."""
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    doc = db.collection(JOBS_COLLECTION).get(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    out = _serialize(doc)
    out["backtest_results"] = _backtest_with_series(doc)
    return out


class BacktestRequest(BaseModel):
    buy_thresh_pct: float = Field(default=0.5, ge=-100, le=100, description="買入訊號閾值（%）— regression 用")
    sell_thresh_pct: float = Field(default=-0.5, ge=-100, le=100, description="賣出訊號閾值（%）— regression 用")
    buy_threshold: float = Field(default=0.5, ge=0.0, le=1.0, description="機率閾值 — classification 用（>= 此值進場 long）")
    sell_threshold: float = Field(default=0.5, ge=0.0, le=1.0, description="機率閾值 — classification 用（< 此值出場）")


@router.post("/jobs/{job_id}/backtest")
def rerun_backtest(job_id: str, req: BacktestRequest) -> dict:
    """Re-run Step 6 backtest at user-chosen thresholds from the snapshot.

    Snapshot stores per-day cross-sectional mean captured at training
    completion, so this endpoint never reloads the model.
    """
    ensure_collection(JOBS_COLLECTION)
    db = get_db()
    col = db.collection(JOBS_COLLECTION)
    doc = col.get(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    snapshot = doc.get("backtest_snapshot")
    if not snapshot:
        raise HTTPException(status_code=409, detail="尚無回測快照（分類目標或尚未完成訓練）")

    sample = snapshot.get("val") or snapshot.get("test")
    is_classification = sample is not None and "raw_return" in sample and "prob" in sample

    from src.ml_training import run_classification_backtest, run_prediction_backtest

    if is_classification:
        results = {
            "val": run_classification_backtest(
                snapshot["val"]["dates"],
                snapshot["val"]["raw_return"],
                snapshot["val"]["prob"],
                buy_threshold=req.buy_threshold,
                sell_threshold=req.sell_threshold,
            ),
            "test": run_classification_backtest(
                snapshot["test"]["dates"],
                snapshot["test"]["raw_return"],
                snapshot["test"]["prob"],
                buy_threshold=req.buy_threshold,
                sell_threshold=req.sell_threshold,
            ),
        }
        payload = {
            "val": results["val"],
            "test": results["test"],
            "thresholds": {"buy_threshold": req.buy_threshold, "sell_threshold": req.sell_threshold},
        }
    else:
        results = {
            "val": run_prediction_backtest(
                snapshot["val"]["dates"],
                snapshot["val"]["y"],
                snapshot["val"]["pred"],
                buy_thresh_pct=req.buy_thresh_pct,
                sell_thresh_pct=req.sell_thresh_pct,
            ),
            "test": run_prediction_backtest(
                snapshot["test"]["dates"],
                snapshot["test"]["y"],
                snapshot["test"]["pred"],
                buy_thresh_pct=req.buy_thresh_pct,
                sell_thresh_pct=req.sell_thresh_pct,
            ),
        }
        payload = {
            "val": results["val"],
            "test": results["test"],
            "thresholds": {"buy_pct": req.buy_thresh_pct, "sell_pct": req.sell_thresh_pct},
        }
    col.update({"_key": job_id, "backtest_results": payload, "updated_at": _now()})
    return payload


# ── Models（儲存訓練成果到 model_artifacts，spec §八/§十） ──

class SaveModelRequest(BaseModel):
    job_id: str = Field(description="從哪個已完成訓練項目儲存")
    name: str = Field(min_length=1, max_length=128, description="模型顯示名稱（使用者自訂）")
    description: str = Field(default="", max_length=512, description="一句話說明用途/特色")
    tags: list[str] = Field(default_factory=list, description="多選 tag（baseline/production/experimental/retired + 自訂）")


@router.post("/models")
def save_model(req: SaveModelRequest) -> dict:
    """Register a trained model into model_artifacts (job status → saved).

    The Celery task persisted the estimator + scaler to disk at training
    completion (spec §十: ArangoDB stores metadata only); this endpoint copies
    that artifact's metadata into ``model_artifacts`` and flips the job to
    ``saved``.
    """
    ensure_collection(MODELS_COLLECTION)
    db = get_db()
    jobs_col = db.collection(JOBS_COLLECTION)
    doc = jobs_col.get(req.job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="訓練項目不存在")
    if doc.get("status") not in ("completed", "saved"):
        raise HTTPException(status_code=409, detail="僅 completed 狀態的訓練可儲存模型")
    artifact = doc.get("artifact")
    if not artifact:
        raise HTTPException(status_code=409, detail="訓練成果尚未持久化（worker 未完成或版本過舊）")

    snapshot = doc.get("config_snapshot") or {}
    artifact_id = uuid.uuid4().hex
    model_artifacts = db.collection(MODELS_COLLECTION)
    model_artifacts.insert({
        "_key": artifact_id,
        "name": req.name,
        "description": req.description,
        "tags": req.tags,
        "job_id": req.job_id,
        "model_type": doc.get("model_type"),
        "model_params": (snapshot.get("model_params") or {}),
        "data_config": (snapshot.get("data") or {}),
        "split_config": (snapshot.get("split") or {}),
        "preprocessing_config": (snapshot.get("preprocessing") or {}),
        "metrics": doc.get("metrics"),
        "backtest_results": doc.get("backtest_results"),
        "model_blob": artifact.get("model_blob"),
        "model_format": artifact.get("model_format"),
        "scaler_blob": artifact.get("scaler_blob"),
        "feature_columns": artifact.get("feature_columns", []),
        "created_at": _now(),
        "created_by": None,
    })
    jobs_col.update({
        "_key": req.job_id,
        "status": "saved",
        "updated_at": _now(),
    })
    return {"artifact_id": artifact_id, "job_id": req.job_id, "status": "saved"}


@router.get("/models")
def list_models(q: str | None = Query(default=None, description="名稱模糊搜尋")) -> dict:
    """List saved model artifacts (index page 簡歷)."""
    ensure_collection(MODELS_COLLECTION)
    db = get_db()
    where = ""
    bind_vars: dict = {}
    if q:
        where = "FILTER LIKE(d.name, @q, true)"
        bind_vars["q"] = f"%{q}%"
    aql = f"""
        FOR d IN {MODELS_COLLECTION}
        {where}
        SORT d.created_at DESC
        RETURN {{
            artifact_id: d._key,
            name: d.name,
            description: d.description,
            tags: d.tags,
            model_type: d.model_type,
            job_id: d.job_id,
            metrics: d.metrics,
            model_format: d.model_format,
            created_at: d.created_at
        }}
    """
    cursor = db.aql.execute(aql, bind_vars=bind_vars)
    items = list(cursor)
    return {"items": items, "total": len(items)}


# ── Hardware check（Step 1 運算裝置） ──

@router.get("/hardware")
def check_hardware() -> dict:
    """Report the compute devices available for training runs.

    Step 1 shows this to let the user pick auto/GPU/CPU. ``cuda`` (torch)
    and ``opencl`` (LightGBM GPU path) are probed lazily so this stays fast.
    """
    gpu = {"available": False, "name": None, "capability": None,
           "memory_total_mb": None, "memory_free_mb": None}
    try:
        import torch

        gpu["available"] = torch.cuda.is_available()
        gpu["torch_version"] = torch.__version__
        gpu["cuda_version"] = torch.version.cuda
        if gpu["available"]:
            gpu["name"] = torch.cuda.get_device_name(0)
            gpu["capability"] = ".".join(str(x) for x in torch.cuda.get_device_capability(0))
            free, total = torch.cuda.mem_get_info(0)
            gpu["memory_total_mb"] = round(total / 1024**2)
            gpu["memory_free_mb"] = round(free / 1024**2)
    except Exception as exc:  # torch import may fail on non-GPU hosts
        logger.warning("hardware check (cuda) failed: %s", exc)

    opencl = {"available": False, "platform": None}
    try:
        import pyopencl as cl

        platforms = cl.get_platforms()
        opencl["available"] = any(
            "NVIDIA" in p.name or "CUDA" in p.name for p in platforms
        )
        opencl["platform"] = [p.name for p in platforms]
    except Exception:
        opencl["available"] = False

    recommended = "cuda" if gpu["available"] else "cpu"
    return {
        "gpu": gpu,
        "opencl": opencl,
        "recommended": recommended,
    }


# ── Helpers ──

def _now() -> int:
    import time
    return int(time.time())


def _serialize(doc: dict) -> dict:
    """Strip Arango internal fields and return project + run payload."""
    out = {k: v for k, v in doc.items() if not k.startswith("_")}
    out["job_id"] = doc.get("_key")
    return out
