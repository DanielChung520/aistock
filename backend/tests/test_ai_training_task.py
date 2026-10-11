"""End-to-end orchestration tests for train_model_task with in-memory fakes.

The Celery task must depend only on the ports (FeatureLoader / JobStore) — no
ArangoDB. These tests inject fakes and run the FULL flow: load → prepare →
train → evaluate → backtest → persist. The same task body is the template for
a standalone deployment: swap the adapters, keep the task.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from src.tasks.ai_training import train_model_task

DEFAULT_CONFIG = {
    "model_type": "xgboost",
    "model_params": {"n_estimators": 5, "max_depth": 3},
    "data": {
        "target": "next_return",
        "stock_ids": ["0", "1"],
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
    },
    "split": {"ratios": [0.7, 0.15, 0.15]},
    "preprocessing": {"scaler": "none", "winsorize_threshold": None},
    "device": "cpu",
}


def _make_rows(
    n_dates: int = 120, n_stocks: int = 2, seed: int = 0, config_hash: str | None = "abc123"
) -> list[dict]:
    rng = np.random.default_rng(seed)
    dates = [f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(n_dates)]
    rows: list[dict] = []
    for s in range(n_stocks):
        price = 100.0 + s * 10
        for i, d in enumerate(dates):
            price *= 1 + (0.01 + rng.normal(0, 0.02))
            row = {
                "stock_id": str(s),
                "date": d,
                "open": price,
                "high": price * 1.01,
                "low": price * 0.99,
                "close": price,
                "volume": 1000.0,
                "feature_a": price / 100.0,
            }
            if config_hash is not None:
                row["feature_config_hash"] = config_hash
            rows.append(row)
    return rows


class FakeFeatureLoader:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def load_features(self, stock_ids, start, end):
        return [
            r for r in self.rows
            if r["stock_id"] in stock_ids and start <= r["date"] <= end
        ]


class FakeJobStore:
    def __init__(self, doc: dict) -> None:
        self.doc = doc

    def get(self, job_id):
        return self.doc

    def update(self, job_id, fields):
        self.doc = {**self.doc, **fields}

    def stop_requested(self, job_id):
        return bool(self.doc.get("stop_requested"))


def _job_doc(**overrides) -> dict:
    doc = {
        "_key": "job1",
        "model_type": "xgboost",
        "status": "running",
        "config_snapshot": DEFAULT_CONFIG,
    }
    doc.update(overrides)
    return doc


class TestTrainModelTask:
    def test_full_flow_completes_and_persists(self, monkeypatch, tmp_path):
        monkeypatch.setattr("src.model_artifacts.models_dir", lambda: tmp_path)
        store = FakeJobStore(_job_doc())
        loader = FakeFeatureLoader(_make_rows())

        result = train_model_task.run("job1", loader=loader, store=store)

        assert result["ok"] is True
        assert result["status"] == "completed"
        assert store.doc["status"] == "completed"
        # metrics on all three splits
        for split in ("train", "val", "test"):
            assert store.doc["metrics"][split]["mae"] >= 0
        # regression backtest ran
        assert store.doc["backtest_results"]["test"]["days"] > 0
        # data provenance recorded
        assert store.doc["data_provenance"]["feature_config_hashes"] == ["abc123"]
        assert store.doc["data_provenance"]["total_rows"] == 240
        # artifact persisted to the injected models dir
        artifact = store.doc["artifact"]
        assert artifact["model_format"] == "joblib"
        assert (tmp_path / "job1" / "model.joblib").exists()
        assert (tmp_path / "job1" / "features.json").exists()

    def test_mixed_feature_hashes_still_completes(self, monkeypatch, tmp_path):
        monkeypatch.setattr("src.model_artifacts.models_dir", lambda: tmp_path)
        rows = _make_rows()
        rows[0]["feature_config_hash"] = "other-hash"
        store = FakeJobStore(_job_doc())

        result = train_model_task.run("job1", loader=FakeFeatureLoader(rows), store=store)

        assert result["status"] == "completed"
        assert store.doc["data_provenance"]["feature_config_hashes"] == ["abc123", "other-hash"]

    def test_legacy_rows_without_hash_still_train(self, monkeypatch, tmp_path):
        monkeypatch.setattr("src.model_artifacts.models_dir", lambda: tmp_path)
        rows = _make_rows(config_hash=None)
        store = FakeJobStore(_job_doc())

        result = train_model_task.run("job1", loader=FakeFeatureLoader(rows), store=store)

        assert result["status"] == "completed"
        assert store.doc["data_provenance"]["feature_config_hashes"] == []
        assert store.doc["data_provenance"]["hashed_rows"] == 0
        assert store.doc["data_provenance"]["total_rows"] == 240

    def test_unknown_model_type_fails_gracefully(self, monkeypatch, tmp_path):
        monkeypatch.setattr("src.model_artifacts.models_dir", lambda: tmp_path)
        store = FakeJobStore(_job_doc(config_snapshot={**DEFAULT_CONFIG, "model_type": "catboost"}))
        loader = FakeFeatureLoader(_make_rows())

        result = train_model_task.run("job1", loader=loader, store=store)

        assert result["ok"] is False
        assert store.doc["status"] == "failed"
        assert "catboost" in store.doc["error"]

    def test_missing_job_returns_error(self):
        store = FakeJobStore(None)
        result = train_model_task.run("nope", loader=FakeFeatureLoader([]), store=store)
        assert result["ok"] is False
        assert "訓練項目不存在" in result["error"]

    def test_no_feature_rows_fails_gracefully(self, monkeypatch, tmp_path):
        monkeypatch.setattr("src.model_artifacts.models_dir", lambda: tmp_path)
        store = FakeJobStore(_job_doc())
        result = train_model_task.run("job1", loader=FakeFeatureLoader([]), store=store)
        assert result["ok"] is False
        assert store.doc["status"] == "failed"
        assert "無特徵資料" in store.doc["error"]

    def test_stop_requested_halts_between_chunks(self, monkeypatch, tmp_path):
        monkeypatch.setattr("src.model_artifacts.models_dir", lambda: tmp_path)
        store = FakeJobStore(_job_doc(stop_requested=True))
        loader = FakeFeatureLoader(_make_rows())

        result = train_model_task.run("job1", loader=loader, store=store)

        assert result["status"] == "stopped"
        assert store.doc["status"] == "stopped"