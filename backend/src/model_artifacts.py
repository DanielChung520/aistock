"""Persist trained models to disk so POST /ai-training/models can register them.

Spec §十: the model body is large, so it lives as a file on disk
(``{MODELS_DIR}/{job_id}/...``) while ArangoDB's ``model_artifacts``
collection stores only metadata + blob paths. The Celery task calls
``persist_trained()`` at completion; the router copies metadata into
``model_artifacts`` on save.
"""
from __future__ import annotations

import json
from pathlib import Path

from src.config import get_settings


def models_dir() -> Path:
    """Resolve the on-disk model directory (MODELS_DIR env override)."""
    settings = get_settings()
    if settings.MODELS_DIR:
        return Path(settings.MODELS_DIR)
    return Path(__file__).resolve().parent.parent / "models"


def persist_trained(
    job_id: str,
    est,
    scaler,
    feature_columns: list[str],
    model_type: str,
) -> dict:
    """Serialize a trained estimator + scaler + features under ``MODELS_DIR``.

    - torch LSTM → ``model.pt`` (state_dict) since joblib cannot pickle a
      live nn.Module reliably across torch versions
    - sklearn/xgboost/lightgbm → ``model.joblib``
    - scaler (if any) → ``scaler.joblib``; features → ``features.json``

    Returns the artifact dict stored on the job doc: ``{model_blob,
    scaler_blob, feature_columns, model_format}``.
    """
    import joblib

    out_dir = models_dir() / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    if getattr(est, "IS_LSTM", False):
        import torch

        # state_dict saved from CPU so the artifact loads on any host
        torch.save(est._model.to("cpu").state_dict(), out_dir / "model.pt")
        model_format = "torch_state_dict"
        model_blob = str(out_dir / "model.pt")
    else:
        joblib.dump(est, out_dir / "model.joblib")
        model_format = "joblib"
        model_blob = str(out_dir / "model.joblib")

    scaler_blob = None
    if scaler is not None:
        scaler_blob = str(out_dir / "scaler.joblib")
        joblib.dump(scaler, scaler_blob)

    (out_dir / "features.json").write_text(
        json.dumps(feature_columns, ensure_ascii=False), encoding="utf-8"
    )

    return {
        "model_blob": model_blob,
        "scaler_blob": scaler_blob,
        "feature_columns": feature_columns,
        "model_format": model_format,
    }
