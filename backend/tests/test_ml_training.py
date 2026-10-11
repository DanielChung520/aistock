"""Unit tests for src.ml_training — pure functions, no DB / Celery required.

Covers spec `.docs/ai-training.md`:
- §三  預測目標（Y）: next_return / next_direction / next_price, per-stock shift(-1)
- §四  資料集分割: time-sequential, no shuffle
- §六  標準化: median fill from train only
- §五  模型清單: tree models + MLP + LSTM (torch, CPU)
- §十一 評估指標: ML track (MAE/RMSE/R²/勝率; accuracy/AUC/F1) + backtest track

All expectations were verified against the current implementation before writing.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.ml_training import (
    LSTMWrapper,
    SUPPORTED_MODELS,
    TARGET_TASK,
    TrainingDataError,
    _compute_y,
    build_model,
    compute_metrics,
    prepare_frame,
    run_prediction_backtest,
    winsorize,
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_rows(
    n_dates: int = 120,
    n_stocks: int = 2,
    seed: int = 0,
    drift: float = 0.01,
) -> list[dict]:
    """Deterministic per-stock OHLCV rows with unique ISO dates.

    ``drift`` controls the daily return mean: >0 → mostly up (for regression),
    0 → random walk with both signs (for classification labels).
    """
    rng = np.random.default_rng(seed)
    dates = [f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(n_dates)]
    rows: list[dict] = []
    for s in range(n_stocks):
        price = 100.0 + s * 10
        for i, d in enumerate(dates):
            price *= 1 + (drift + rng.normal(0, 0.02))
            rows.append(
                {
                    "_key": f"{s}_{d}",
                    "stock_id": str(s),
                    "date": d,
                    "open": round(price, 2),
                    "high": round(price * 1.01, 2),
                    "low": round(price * 0.99, 2),
                    "close": round(price, 2),
                    "volume": 1000.0,
                    "feature_a": round(price / 100.0, 4),
                    "feature_b": 1.0 if price > 100.0 else 0.0,
                    "feature_config_hash": "testhash",
                }
            )
    return rows


# ── prepare_frame (§三 / §四 / §六) ─────────────────────────────────────────


class TestPrepareFrame:
    def test_basic_structure_and_alignment(self):
        data = prepare_frame(_make_rows(), "next_return")
        assert data["task"] == "regression"
        assert set(
            ("X_train", "y_train", "X_val", "y_val", "X_test", "y_test")
        ) <= set(data)
        # every y row has a matching X row
        assert len(data["X_train"]) == len(data["y_train"])
        assert len(data["X_val"]) == len(data["y_val"])
        assert len(data["X_test"]) == len(data["y_test"])
        # stock arrays aligned to rows
        assert len(data["stock_train"]) == len(data["y_train"])
        assert len(data["stock_val"]) == len(data["y_val"])
        assert len(data["stock_test"]) == len(data["y_test"])
        # dates aligned to rows
        assert len(data["dates_val"]) == len(data["y_val"])
        assert len(data["dates_test"]) == len(data["y_test"])
        # y finite (no NaN / inf labels)
        for y in (data["y_train"], data["y_val"], data["y_test"]):
            assert np.isfinite(y).all()

    def test_last_row_of_each_stock_dropped(self):
        rows = _make_rows(n_dates=100, n_stocks=3)
        data = prepare_frame(rows, "next_return")
        total = sum(data["n_samples"].values())
        # 300 rows − 3 stock-final rows (no label)
        assert total == 300 - 3

    def test_time_sequential_split_no_shuffle(self):
        data = prepare_frame(_make_rows(), "next_return")
        # val dates strictly before test dates (time order preserved)
        assert str(np.min(data["dates_test"])) > str(np.max(data["dates_val"]))
        # split boundaries are a monotone progression
        bounds = data["split_boundaries"]
        assert bounds["train_start"] < bounds["val_start"] < bounds["test_start"] <= bounds["end"]
        # every test row is on/after the test boundary
        assert str(np.min(data["dates_test"])) >= bounds["test_start"]

    def test_feature_columns_exclude_internal_fields(self):
        data = prepare_frame(_make_rows(), "next_return")
        for col in ("_id", "_key", "_rev", "stock_id", "date", "y", "feature_config_hash"):
            assert col not in data["feature_columns"]

    def test_median_fill_from_train_only(self):
        # feature_c is 5.0 in the train window, None afterwards — the fill
        # value must come from the TRAIN median, proving no val/test leakage.
        rows = _make_rows(n_dates=120)
        for i, row in enumerate(rows):
            row["feature_c"] = 5.0 if i < 84 * 2 else None
        data = prepare_frame(rows, "next_return")
        idx_c = data["feature_columns"].index("feature_c")
        assert (data["X_val"][:, idx_c] == 5.0).all()
        assert (data["X_test"][:, idx_c] == 5.0).all()

    def test_all_null_feature_column_dropped(self):
        rows = _make_rows()
        for row in rows:
            row["feature_dead"] = None
        data = prepare_frame(rows, "next_return")
        assert "feature_dead" not in data["feature_columns"]

    def test_inf_feature_replaced_and_filled(self):
        rows = _make_rows()
        rows[0]["feature_inf"] = float("inf")
        rows[1]["feature_inf"] = 3.0
        for row in rows[2:]:
            row["feature_inf"] = 3.0
        data = prepare_frame(rows, "next_return")
        assert "feature_inf" in data["feature_columns"]
        idx = data["feature_columns"].index("feature_inf")
        assert np.isfinite(data["X_train"][:, idx]).all()

    def test_unknown_target_rejected(self):
        with pytest.raises(TrainingDataError):
            prepare_frame(_make_rows(), "next_moon")

    def test_empty_rows_rejected(self):
        with pytest.raises(TrainingDataError):
            prepare_frame([], "next_return")

    def test_too_few_samples_rejected(self):
        with pytest.raises(TrainingDataError, match="樣本數不足"):
            prepare_frame(_make_rows(n_dates=30), "next_return")

    def test_classification_task_and_labels(self):
        # drift=0 → random walk, both up/down classes present
        data = prepare_frame(_make_rows(drift=0.0, seed=1), "next_direction")
        assert data["task"] == "classification"
        assert set(np.unique(data["y_train"])) == {0.0, 1.0}
        assert set(np.unique(data["y_val"])) <= {0.0, 1.0}
        assert set(np.unique(data["y_test"])) <= {0.0, 1.0}

    def test_single_class_training_set_rejected(self):
        # strong drift → every label is 1 → cannot train a classifier
        rows = _make_rows(drift=0.05, seed=2)
        with pytest.raises(TrainingDataError, match="單一類別"):
            prepare_frame(rows, "next_direction")


# ── _compute_y (§三) ────────────────────────────────────────────────────────


class TestComputeY:
    def _frame(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "stock_id": ["A"] * 4,
                "date": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"],
                "close": [10.0, 11.0, 12.0, 13.0],
            }
        )

    def test_next_return_shifts_close_and_drops_last(self):
        r = _compute_y(self._frame(), "next_return")
        assert len(r) == 3  # last row has no next-day label
        assert list(r["y"].round(6)) == [0.1, 0.090909, 0.083333]

    def test_next_direction_binary(self):
        r = _compute_y(self._frame(), "next_direction")
        # last row has no next-day data → dropped, not labelled 0
        assert len(r) == 3
        assert list(r["y"]) == [1, 1, 1]

    def test_next_direction_never_labels_last_row_down(self):
        # regression: NaN > close evaluates to False → astype(int) → 0, which
        # dropna() keeps. The last row must be dropped like the other targets.
        df = pd.DataFrame(
            {
                "stock_id": ["A"] * 2,
                "date": ["2024-01-01", "2024-01-02"],
                "close": [10.0, 11.0],
            }
        )
        r = _compute_y(df, "next_direction")
        assert len(r) == 1
        assert list(r["y"]) == [1]

    def test_next_price_is_next_close(self):
        r = _compute_y(self._frame(), "next_price")
        assert list(r["y"]) == [11.0, 12.0, 13.0]

    def test_y_never_crosses_stock_boundary(self):
        df = pd.DataFrame(
            {
                "stock_id": ["A"] * 3 + ["B"] * 3,
                "date": ["2024-01-01", "2024-01-02", "2024-01-03"] * 2,
                "close": [10.0, 20.0, 30.0, 100.0, 200.0, 300.0],
            }
        )
        r = _compute_y(df, "next_return")
        by_stock = r.groupby("stock_id")["y"].apply(list).to_dict()
        assert by_stock["A"] == [1.0, 0.5]  # 20/10−1, 30/20−1
        assert by_stock["B"] == [1.0, 0.5]  # 200/100−1, 300/200−1


# ── winsorize (§三) ─────────────────────────────────────────────────────────


class TestWinsorize:
    def test_none_passthrough(self):
        t, v, te, bounds = winsorize(
            np.array([-0.1, 0.1]), np.array([0.2]), np.array([0.3]), None
        )
        assert bounds is None
        assert list(t) == [-0.1, 0.1]
        assert list(v) == [0.2]
        assert list(te) == [0.3]

    def test_5pct_clips_to_plusminus_5(self):
        t, v, te, bounds = winsorize(
            np.array([-0.1, 0.1]), np.array([0.2]), np.array([-0.3]), "5pct"
        )
        assert bounds == (-0.05, 0.05)
        assert list(t) == [-0.05, 0.05]
        assert list(v) == [0.05]
        assert list(te) == [-0.05]

    def test_3sigma_bounds_fit_on_train(self):
        train = np.array([0.0, 1.0, 2.0, 3.0])  # mean 1.5, std ~1.118
        t, v, te, bounds = winsorize(train, np.array([9.0]), np.array([-9.0]), "3sigma")
        lo, hi = bounds
        assert lo < hi
        # all outputs clipped inside the train-derived bounds
        assert t.max() <= hi and t.min() >= lo
        assert v[0] <= hi and te[0] >= lo
        # out-of-bound inputs are exactly clipped to the bounds
        assert v[0] == hi
        assert te[0] == lo

    def test_invalid_threshold_rejected(self):
        with pytest.raises(TrainingDataError):
            winsorize(np.array([0.0]), np.array([0.0]), np.array([0.0]), "9sigma")


# ── LSTMWrapper / _make_windows (§五, torch CPU) ───────────────────────────


class TestMakeWindows:
    @staticmethod
    def _wrapper(seq: int) -> LSTMWrapper:
        return LSTMWrapper(task="regression", sequence_length=seq)

    def test_shape_and_edge_padding(self):
        X = np.arange(10 * 2, dtype=np.float32).reshape(10, 2)
        groups = np.array(["A"] * 5 + ["B"] * 5, dtype=object)
        seq = 3
        w = self._wrapper(seq)._make_windows(X, groups)
        assert w.shape == (10, seq, 2)
        # first row of stock A is edge-padded with itself
        assert (w[0] == X[0]).all()
        # row 1 = pad(row0) + row1
        assert (w[1, 0] == X[0]).all() and (w[1, 1] == X[0]).all() and (w[1, 2] == X[1]).all()
        # first row of stock B never contains stock-A rows
        assert (w[5] == X[5]).all()

    def test_window_never_spans_stock_boundary(self):
        X = np.arange(10, dtype=np.float32).reshape(10, 1)
        groups = np.array([0, 0, 1, 1, 1, 2, 2, 2, 2, 2])
        seq = 4
        w = self._wrapper(seq)._make_windows(X, groups)
        # for every row j, every window row belongs to the same stock as j
        for j in range(10):
            stock = groups[j]
            assert set(w[j].flatten().tolist()).issubset(
                {float(v) for v in X[groups == stock].flatten()}
            )

    def test_no_groups_treated_as_single_sequence(self):
        X = np.arange(6, dtype=np.float32).reshape(6, 1)
        seq = 3
        w = self._wrapper(seq)._make_windows(X, None)
        assert w.shape == (6, seq, 1)
        # last row's window is the 3 most recent rows
        assert (w[5, :, 0] == [3, 4, 5]).all()

    def test_insufficient_samples_rejected(self):
        X = np.zeros((2, 2), dtype=np.float32)
        with pytest.raises(TrainingDataError, match="小於 LSTM"):
            self._wrapper(5)._make_windows(X, None)


class TestLSTMWrapper:
    def test_predict_before_fit_raises(self):
        est = LSTMWrapper(task="regression", sequence_length=2)
        with pytest.raises(TrainingDataError, match="尚未訓練"):
            est.predict(np.zeros((4, 2), dtype=np.float32))

    def test_fit_predict_smoke_on_cpu(self):
        # small deterministic CPU training loop — validates fit/predict shapes
        rng = np.random.default_rng(7)
        X = rng.normal(size=(8, 3)).astype(np.float32)
        y = rng.normal(size=8).astype(np.float32)
        est = LSTMWrapper(
            task="regression",
            sequence_length=2,
            hidden_units=4,
            layers=1,
            epochs=1,
            batch_size=8,
            seed=42,
            device="cpu",
        )
        est.set_groups(np.array([0, 0, 0, 0, 1, 1, 1, 1]))
        est.fit(X, y)
        pred = est.predict(X, groups=np.array([0, 0, 0, 0, 1, 1, 1, 1]))
        assert pred.shape == (8,)
        assert np.isfinite(pred).all()

    def test_fit_warm_start_continues_training(self):
        # fitting twice with max_iter=1 each must not error (warm-start contract)
        rng = np.random.default_rng(3)
        X = rng.normal(size=(6, 2)).astype(np.float32)
        y = rng.normal(size=6).astype(np.float32)
        est = LSTMWrapper(
            task="regression", sequence_length=2, hidden_units=4, layers=1,
            epochs=1, batch_size=6, device="cpu",
        )
        est.max_iter = 1
        est.fit(X, y)
        est.max_iter = 1
        est.fit(X, y)  # second fit reuses the existing weights
        assert est._is_fitted


# ── build_model (§五) ───────────────────────────────────────────────────────


class TestBuildModel:
    def test_supported_models_instantiate(self):
        from lightgbm import LGBMRegressor
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.neural_network import MLPRegressor
        from xgboost import XGBRegressor

        expected = {
            "xgboost": XGBRegressor,
            "lightgbm": LGBMRegressor,
            "randomforest": RandomForestRegressor,
            "mlp": MLPRegressor,
        }
        for name, cls in expected.items():
            est, _ = build_model(name, {}, "regression", device="cpu")
            assert isinstance(est, cls), f"{name} → {type(est)}"
        est, epochs = build_model("lstm", {"epochs": 7}, "regression", device="cpu")
        assert isinstance(est, LSTMWrapper)
        assert epochs == 7

    def test_regression_vs_classification_mapping(self):
        from lightgbm import LGBMClassifier, LGBMRegressor

        reg, _ = build_model("lightgbm", {}, "regression", device="cpu")
        cls, _ = build_model("lightgbm", {}, "classification", device="cpu")
        assert isinstance(reg, LGBMRegressor)
        assert isinstance(cls, LGBMClassifier)

    def test_mlp_hidden_layers_parsed(self):
        est, epochs = build_model(
            "mlp", {"hidden_layers": "16,8", "epochs": 5}, "regression", device="cpu"
        )
        assert est.hidden_layer_sizes == (16, 8)
        assert epochs == 5

    def test_tree_n_estimators_param(self):
        est, n_est = build_model(
            "randomforest", {"n_estimators": 42}, "regression", device="cpu"
        )
        assert n_est == 42
        assert est.n_estimators == 42

    def test_unknown_model_type_rejected(self):
        with pytest.raises(TrainingDataError, match="不支援的模型類型"):
            build_model("catboost", {}, "regression", device="cpu")

    def test_supported_models_registry(self):
        assert SUPPORTED_MODELS == ("xgboost", "lightgbm", "randomforest", "mlp", "lstm")
        assert TARGET_TASK == {
            "next_return": "regression",
            "next_price": "regression",
            "next_direction": "classification",
            "next_5d_return": "regression",
            "next_5d_direction": "classification",
        }


# ── compute_metrics (§十一 ML track) ────────────────────────────────────────


class TestComputeMetrics:
    def test_regression_perfect(self):
        m = compute_metrics(np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0, 3.0]), "regression")
        assert m["mae"] == 0.0
        assert m["rmse"] == 0.0
        assert m["r2"] == 1.0
        assert m["win_rate"] == 100.0

    def test_regression_win_rate_sign_match(self):
        y_true = np.array([0.01, -0.02, 0.03, -0.04])
        y_pred = np.array([0.02, -0.01, -0.01, 0.01])  # signs: T, T, F, F
        m = compute_metrics(y_true, y_pred, "regression")
        assert m["win_rate"] == 50.0

    def test_classification_perfect(self):
        y_true = np.array([0, 0, 1, 1])
        y_pred = np.array([0.1, 0.2, 0.8, 0.9])
        m = compute_metrics(y_true, y_pred, "classification")
        assert m["accuracy"] == 1.0
        assert m["f1"] == 1.0
        assert m["auc"] == 1.0

    def test_classification_auc_none_when_single_class(self):
        y_true = np.array([0, 0, 0, 0])
        y_pred = np.array([0.1, 0.2, 0.3, 0.4])
        m = compute_metrics(y_true, y_pred, "classification")
        assert m["accuracy"] == 1.0
        assert m["auc"] is None

    def test_classification_auc_none_when_single_prediction_value(self):
        y_true = np.array([0, 0, 1, 1])
        y_pred = np.array([0.9, 0.9, 0.9, 0.9])
        m = compute_metrics(y_true, y_pred, "classification")
        assert m["auc"] is None


# ── run_prediction_backtest (§十一 backtest track) ─────────────────────────


class TestRunPredictionBacktest:
    def test_empty_input(self):
        r = run_prediction_backtest([], np.array([]), np.array([]))
        assert r["days"] == 0
        assert r["equity_curve"] == []
        assert r["total_return_pct"] == 0.0

    def test_long_only_signal_flow(self):
        dates = ["d0", "d1", "d2", "d3", "d4"]
        y = np.array([0.01, 0.01, 0.01, 0.01, 0.01])
        pred = np.array([0.01, 0.01, -0.01, 0.01, -0.01])
        r = run_prediction_backtest(dates, y, pred)  # default ±0.5%
        assert r["days"] == 5
        assert r["buys"] == 2  # d0 and d3
        assert r["sells"] == 2  # d2 and d4
        assert r["trades"] == 2
        assert r["win_rate_pct"] == 100.0
        assert r["total_return_pct"] == 3.03  # 1.01^3 − 1 (exit days excluded)
        assert r["max_drawdown_pct"] == 0.0
        assert r["profit_factor"] is None  # no losing trade
        assert len(r["equity_curve"]) == 5
        assert r["equity_curve"][-1] == {"date": "d4", "equity": 103.03}

    def test_hold_position_until_end_closes_trade(self):
        dates = ["d0", "d1", "d2"]
        y = np.array([0.01, 0.01, 0.01])
        pred = np.array([0.01, 0.01, 0.01])  # never sells
        r = run_prediction_backtest(dates, y, pred)
        assert r["buys"] == 1
        assert r["sells"] == 0
        assert r["trades"] == 1  # final position force-closed at end
        assert r["total_return_pct"] == 3.03  # 1.01^3 − 1

    def test_multi_stock_collapses_to_daily_mean(self):
        dates = ["d1", "d1", "d2", "d2"]
        y = np.array([0.01, 0.03, 0.01, 0.01])
        pred = np.array([0.02, 0.02, 0.02, 0.02])
        r = run_prediction_backtest(dates, y, pred)
        assert r["days"] == 2  # two unique dates
        assert len(r["equity_curve"]) == 2
        assert len(r["series"]) == 2
        # d1 daily mean y = (0.01+0.03)/2 = 0.02, d2 = 0.01
        assert r["series"][0]["y"] == 0.02
        assert r["series"][1]["y"] == 0.01
        # equity = 1.02 × 1.01 − 1
        assert r["total_return_pct"] == 3.02

    def test_custom_thresholds(self):
        dates = ["d0", "d1", "d2"]
        y = np.array([0.01, 0.01, 0.01])
        pred = np.array([0.004, 0.004, 0.004])  # below default 0.5% buy threshold
        r = run_prediction_backtest(dates, y, pred)  # default → no trades
        assert r["buys"] == 0
        r2 = run_prediction_backtest(
            dates, y, pred, buy_thresh_pct=0.2, sell_thresh_pct=-0.2
        )
        assert r2["buys"] == 1  # 0.004 > 0.002 now triggers