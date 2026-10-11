"""Unit tests for target-column generation + prepare_frame reading them.

v2: feature generation writes the 4 target columns (next_return /
next_5d_return / next_direction / next_5d_direction) per-stock, and
prepare_frame prefers these pre-generated columns over recomputing.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.ml_training import (
    FEATURE_EXCLUDE,
    GENERATED_TARGETS,
    compute_target_columns,
    prepare_frame,
)


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "stock_id": ["A"] * 6,
            "date": [f"2024-01-0{i+1}" for i in range(6)],
            "close": [10.0, 11.0, 12.0, 13.0, 14.0, 15.0],
        }
    )


def _rows_with_targets(n: int = 120, n_stocks: int = 2, seed: int = 0) -> list[dict]:
    rng = np.random.default_rng(seed)
    dates = [f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(n)]
    rows: list[dict] = []
    for s in range(n_stocks):
        price = 100.0 + s * 10
        for i, d in enumerate(dates):
            price *= 1 + rng.normal(0, 0.02)
            rows.append(
                {
                    "stock_id": str(s),
                    "date": d,
                    "close": price,
                    "feature_a": price / 100.0,
                }
            )
    df = compute_target_columns(pd.DataFrame(rows))
    return df.to_dict("records")


class TestComputeTargetColumns:
    def test_all_4_targets_present(self):
        r = compute_target_columns(_frame())
        for t in GENERATED_TARGETS:
            assert t in r.columns

    def test_next_return_shift1(self):
        r = compute_target_columns(_frame())
        # 6 rows, next_return uses shift(-1) → first 5 have values, last is NaN
        assert r["next_return"].iloc[0] == pytest.approx(0.1)
        assert np.isnan(r["next_return"].iloc[5])

    def test_next_5d_return_shift5(self):
        r = compute_target_columns(_frame())
        assert r["next_5d_return"].iloc[0] == pytest.approx(0.5)  # 15/10−1
        assert np.isnan(r["next_5d_return"].iloc[1:6]).all()

    def test_direction_binary_with_nan(self):
        r = compute_target_columns(_frame())
        assert r["next_direction"].iloc[0] == 1.0  # 11 > 10
        assert np.isnan(r["next_direction"].iloc[5])

    def test_targets_never_cross_stock_boundary(self):
        df = pd.DataFrame(
            {
                "stock_id": ["A"] * 3 + ["B"] * 3,
                "date": ["2024-01-01", "2024-01-02", "2024-01-03"] * 2,
                "close": [10.0, 20.0, 30.0, 100.0, 200.0, 300.0],
            }
        )
        r = compute_target_columns(df)
        # last row of stock A must have NaN (not B's value)
        assert np.isnan(r["next_return"].iloc[2])
        assert r["next_return"].iloc[3] == pytest.approx(1.0)  # B: 200/100−1


class TestPrepareFrameReadsTargets:
    def test_uses_pregenerated_target_column(self):
        rows = _rows_with_targets()
        data = prepare_frame(rows, "next_return")
        # y should come from the stored column, matching a recompute
        df = compute_target_columns(pd.DataFrame(rows))
        expected = df["next_return"].dropna().to_numpy()
        assert len(data["y_train"]) + len(data["y_val"]) + len(data["y_test"]) == len(expected)
        assert np.isfinite(data["y_train"]).all()

    def test_legacy_rows_without_targets_still_work(self):
        # rows WITHOUT target columns → prepare_frame recomputes (backward compat)
        rng = np.random.default_rng(0)
        n = 100
        dates = [f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(n)]
        rows = []
        for s in range(2):
            price = 100.0
            for i, d in enumerate(dates):
                price *= 1 + rng.normal(0, 0.02)
                rows.append({"stock_id": str(s), "date": d, "close": price})
        data = prepare_frame(rows, "next_return")
        assert data["task"] == "regression"
        assert len(data["y_train"]) > 0

    def test_target_columns_excluded_from_features(self):
        rows = _rows_with_targets()
        data = prepare_frame(rows, "next_return")
        for t in GENERATED_TARGETS:
            assert t not in data["feature_columns"]
            assert t in FEATURE_EXCLUDE

    def test_classification_target_read(self):
        rows = _rows_with_targets(seed=1)
        data = prepare_frame(rows, "next_direction")
        assert data["task"] == "classification"
        assert set(np.unique(data["y_train"])) <= {0.0, 1.0}