"""Unit tests for multi-target feature importance (sensitivity analysis).

Covers the 4 prediction targets in ml_training._compute_y / compute_feature_importance:
- next_return (隔日漲跌幅, regression)
- next_5d_return (5日總漲跌幅, regression)
- next_direction (隔日漲跌分類, classification)
- next_5d_direction (5日總漲跌分類, classification)
Plus the 3-model importance comparison.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.ml_training import (
    IMPORTANCE_MODELS,
    TARGET_TASK,
    TrainingDataError,
    _compute_y,
    compute_feature_importance,
)


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "stock_id": ["A"] * 6,
            "date": [f"2024-01-0{i+1}" for i in range(6)],
            "close": [10.0, 11.0, 12.0, 13.0, 14.0, 15.0],
        }
    )


def _feature_rows(n: int = 400, seed: int = 0) -> list[dict]:
    rng = np.random.default_rng(seed)
    dates = [f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(n)]
    rows: list[dict] = []
    for s in range(3):
        price = 100.0
        for i, d in enumerate(dates):
            ret = rng.normal(0, 0.02)
            price *= 1 + ret
            rows.append(
                {
                    "stock_id": str(s),
                    "date": d,
                    "close": price,
                    "momentum": ret + rng.normal(0, 0.01),
                    "rsi": rng.uniform(0, 100),
                    "noise": rng.normal(0, 1),
                    "feature_config_hash": "x",
                }
            )
    return rows


class TestComputeYHorizons:
    def test_target_registry(self):
        assert TARGET_TASK["next_return"] == "regression"
        assert TARGET_TASK["next_5d_return"] == "regression"
        assert TARGET_TASK["next_direction"] == "classification"
        assert TARGET_TASK["next_5d_direction"] == "classification"

    def test_next_return_drops_last_row(self):
        r = _compute_y(_frame(), "next_return")
        assert len(r) == 5
        assert list(r["y"].round(4)) == [0.1, 0.0909, 0.0833, 0.0769, 0.0714]

    def test_next_5d_return_uses_5day_horizon(self):
        r = _compute_y(_frame(), "next_5d_return")
        # 6 rows, shift(-5) → only the first row has a label (15/10−1)
        assert len(r) == 1
        assert r["y"].iloc[0] == pytest.approx(0.5)

    def test_next_direction_drops_last_row(self):
        r = _compute_y(_frame(), "next_direction")
        assert len(r) == 5
        assert list(r["y"]) == [1, 1, 1, 1, 1]

    def test_next_5d_direction(self):
        r = _compute_y(_frame(), "next_5d_direction")
        assert len(r) == 1
        assert list(r["y"]) == [1]  # 15 > 10


class TestComputeFeatureImportance:
    def test_all_4_targets_run(self):
        rows = _feature_rows()
        for t in ("next_return", "next_5d_return", "next_direction", "next_5d_direction"):
            res = compute_feature_importance(
                rows, t, model_types=["xgboost", "lightgbm", "randomforest"], n_estimators=15
            )
            assert res["task"] == TARGET_TASK[t]
            assert set(res["models"]) == {"xgboost", "lightgbm", "randomforest"}
            assert "momentum" in res["feature_columns"]

    def test_importance_returns_sorted_dict(self):
        rows = _feature_rows()
        res = compute_feature_importance(rows, "next_return", model_types=["xgboost"], n_estimators=15)
        imp = res["models"]["xgboost"]
        assert isinstance(imp, dict)
        vals = list(imp.values())
        assert vals == sorted(vals, reverse=True)  # descending
        assert all(v >= 0 for v in vals)

    def test_momentum_has_nonzero_importance(self):
        # momentum is one of the real features → it must be present with a
        # positive gain, proving the ranking returns real feature names
        rows = _feature_rows(seed=3)
        res = compute_feature_importance(rows, "next_5d_return", model_types=["xgboost"], n_estimators=20)
        imp = res["models"]["xgboost"]
        assert "momentum" in imp
        assert imp["momentum"] > 0
        assert "noise" in imp  # all columns present (gain ≥ 0)

    def test_unknown_target_rejected(self):
        with pytest.raises(TrainingDataError):
            compute_feature_importance(_feature_rows(), "next_moon")

    def test_empty_rows_rejected(self):
        with pytest.raises(TrainingDataError):
            compute_feature_importance([], "next_return")

    def test_unsupported_model_filtered(self):
        rows = _feature_rows()
        res = compute_feature_importance(rows, "next_return", model_types=["xgboost", "catboost"], n_estimators=10)
        assert set(res["models"]) == {"xgboost"}

    def test_importance_models_registry(self):
        assert IMPORTANCE_MODELS == ("xgboost", "lightgbm", "randomforest")