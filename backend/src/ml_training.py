"""Real ML training core for AI-training jobs (spec ``.docs/ai-training.md``).

Pure functions — no Celery / ArangoDB here, so the math is unit-testable.
The Celery task in ``src/tasks/ai_training.py`` orchestrates data loading,
progress persistence and status transitions.

Covered by spec sections:
- §三 預測目標（Y）: next_return / next_direction / next_price
- §四 資料集分割: time-sequential, no shuffle
- §六 標準化: scaler fit on train only
- §十一 評估指標: ML track (regression: MAE/RMSE/R²/勝率; classification: accuracy/AUC/F1)
- §五 模型清單: tree models + MLP + LSTM (torch, CPU)
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

# Columns that are identifiers / internal, never model features.
FEATURE_EXCLUDE = {
    "_id", "_key", "_rev", "stock_id", "date", "feature_config_hash",
    "next_return", "next_5d_return", "next_direction", "next_5d_direction",
    "raw_return",
}

# Model types supported in v1 (spec §五).
SUPPORTED_MODELS = ("xgboost", "lightgbm", "randomforest", "mlp", "lstm")

# task type per prediction target (§三)
TARGET_TASK = {
    "next_return": "regression",
    "next_price": "regression",
    "next_direction": "classification",
    "next_5d_return": "regression",
    "next_5d_direction": "classification",
}

# 4 個生成時一併算好的目標欄位（spec: 目標值隨特徵一起生成）
GENERATED_TARGETS = ("next_return", "next_5d_return", "next_direction", "next_5d_direction")


def compute_target_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Add the 4 target-label columns to a per-stock feature frame.

    Each column is computed per-stock via ``close`` shift, so labels never
    cross a stock boundary. The trailing horizon rows (no future close) get
    NaN — e.g. the last day has no ``next_return``, the last 5 days have no
    ``next_5d_return``. Regression targets keep the raw return; classification
    targets are 1 (up) / 0 (down) with NaN for missing future.
    """
    df = df.sort_values(["stock_id", "date"]).copy()
    grp = df.groupby("stock_id", sort=False)["close"]
    df["next_return"] = grp.shift(-1) / df["close"] - 1
    df["next_5d_return"] = grp.shift(-5) / df["close"] - 1
    nxt = grp.shift(-1)
    df["next_direction"] = (nxt > df["close"]).astype(float).where(nxt.notna())
    nxt5 = grp.shift(-5)
    df["next_5d_direction"] = (nxt5 > df["close"]).astype(float).where(nxt5.notna())
    return df


class TrainingDataError(ValueError):
    """Raised when the prepared training data is unusable (too small / empty)."""


class TrainingStopRequested(RuntimeError):
    """Raised when the user requested stop during data-loading phase."""


# ── Data preparation ─────────────────────────────────────────────────────────

def prepare_frame(
    rows: list[dict],
    target: str,
    split_ratios: list[float] | tuple[float, float, float] = (0.7, 0.15, 0.15),
    feature_subset: list[str] | None = None,
) -> dict:
    """Turn raw stock_daily_features docs into train/val/test numpy arrays.

    ``feature_subset`` (optional) restricts the model to a curated list of
    feature columns. Unknown columns are silently dropped so the caller can
    pass the union of multiple sensitivity jobs without bookkeeping.

    Steps (all leak-safe, per spec §四/§六):
      1. resolve y: use the pre-generated target column if present, else
         compute per stock via ``close`` shift (backward compatible with
         legacy rows that lack target columns)
      2. drop rows without a label
      3. time-sequential split by unique date boundary
      4. drop fully-null feature columns, median-fill (median from train only)
      5. scaler-free: returns raw arrays + median/cols so the caller may scale

    Returns dict with ``X_train/y_train/...`` (np.ndarray), ``feature_columns``,
    ``split_boundaries`` (date indexes), ``n_samples`` and ``task``.
    """
    task = TARGET_TASK.get(target)
    if task is None:
        raise TrainingDataError(f"不支援的預測目標: {target}")

    df = pd.DataFrame(rows)
    if df.empty:
        raise TrainingDataError("stock_daily_features 無資料")

    if target in df.columns:
        # Pre-generated target column (v2: 目標值隨特徵生成)
        df["y"] = df[target]
        if task == "classification":
            df["y"] = df["y"].astype(float)
    else:
        df = _compute_y(df, target)

    if task == "classification":
        raw_col = {
            "next_direction": "next_return",
            "next_5d_direction": "next_5d_return",
        }.get(target)
        if raw_col is not None:
            if raw_col in df.columns:
                df["raw_return"] = df[raw_col]
            else:
                raw_df = _compute_y(df.copy(), raw_col)
                df = df.copy()
                df["raw_return"] = raw_df["y"]

    y_finite = np.isfinite(df["y"].to_numpy(dtype=float))
    df = df[y_finite].copy()
    if df.empty:
        raise TrainingDataError("計算 Y 後無樣本（檢查日期區間與股票清單）")

    train, val, test = _time_split(df, _norm_ratios(split_ratios))
    if len(train) < 50 or len(val) < 10 or len(test) < 10:
        raise TrainingDataError(
            f"樣本數不足: train={len(train)} val={len(val)} test={len(test)}"
        )

    feature_cols = [c for c in df.columns if c not in FEATURE_EXCLUDE and c != "y"]
    if feature_subset is not None and feature_subset:
        wanted = set(feature_subset)
        feature_cols = [c for c in feature_cols if c in wanted]
        if not feature_cols:
            raise TrainingDataError(
                f"feature_subset 指定了 {len(feature_subset)} 個欄位，但與可用特徵無交集"
            )
    X_raw = _to_numeric_frame(df, feature_cols)
    # Drop columns that are all null (e.g. bollinger_* when disabled).
    keep = X_raw.notna().any()
    feature_cols = [c for c in feature_cols if keep[c]]
    X_raw = X_raw[feature_cols]

    medians = X_raw.loc[train.index].median()
    # inf in features (from close=0 rows) → NaN, then median-filled below.
    X_full = X_raw.replace([np.inf, -np.inf], np.nan).fillna(medians)

    X_train = X_full.loc[train.index].to_numpy(dtype=np.float64)
    X_val = X_full.loc[val.index].to_numpy(dtype=np.float64)
    X_test = X_full.loc[test.index].to_numpy(dtype=np.float64)

    y_train = train["y"].to_numpy(dtype=np.float64)
    y_val = val["y"].to_numpy(dtype=np.float64)
    y_test = test["y"].to_numpy(dtype=np.float64)

    if task == "classification":
        if not _has_both_classes(y_train):
            raise TrainingDataError("訓練集只有單一類別，無法訓練分類模型")

    return {
        "task": task,
        "X_train": X_train,
        "y_train": y_train,
        "X_val": X_val,
        "y_val": y_val,
        "X_test": X_test,
        "y_test": y_test,
        # dates aligned to y_val / y_test rows (for backtest signal aggregation)
        "dates_val": val["date"].astype(str).to_numpy(),
        "dates_test": test["date"].astype(str).to_numpy(),
        # stock ids aligned to rows — LSTM groups sequences per stock
        "stock_train": train["stock_id"].to_numpy(),
        "stock_val": val["stock_id"].to_numpy(),
        "stock_test": test["stock_id"].to_numpy(),
        "raw_return_train": train["raw_return"].to_numpy() if "raw_return" in train.columns else None,
        "raw_return_val": val["raw_return"].to_numpy() if "raw_return" in val.columns else None,
        "raw_return_test": test["raw_return"].to_numpy() if "raw_return" in test.columns else None,
        "feature_columns": feature_cols,
        "n_samples": {"train": len(train), "val": len(val), "test": len(test)},
        "split_boundaries": {
            "train_start": str(train["date"].min()),
            "val_start": str(val["date"].min()),
            "test_start": str(test["date"].min()),
            "end": str(test["date"].max()),
        },
    }


def winsorize(
    train_y: np.ndarray, val_y: np.ndarray, test_y: np.ndarray, threshold: str | None
) -> tuple[np.ndarray, np.ndarray, np.ndarray, tuple[float, float] | None]:
    """Clip y values to control fat tails (spec §三).

    ``threshold`` is ``"3sigma"`` (fit on train) or ``"5pct"`` (absolute ±5%).
    Returns (train_y, val_y, test_y, (lo, hi) | None) with the same clip bounds
    applied to all three splits.
    """
    if not threshold:
        return train_y, val_y, test_y, None
    if threshold == "3sigma":
        mu = float(np.mean(train_y))
        sigma = float(np.std(train_y))
        lo, hi = mu - 3 * sigma, mu + 3 * sigma
    elif threshold == "5pct":
        lo, hi = -0.05, 0.05
    else:
        raise TrainingDataError(f"不支援的 winsorize 方式: {threshold}")
    return (
        np.clip(train_y, lo, hi),
        np.clip(val_y, lo, hi),
        np.clip(test_y, lo, hi),
        (lo, hi),
    )


# ── Model factory ────────────────────────────────────────────────────────────

def _parse_hidden_layers(raw) -> tuple[int, ...]:
    """Parse MLP hidden_layer_sizes from int / list / comma-string.

    Accepts ``64``, ``[64, 32]``, ``(64, 32)`` or ``"64,32"``; falls back to
    the spec default ``(64, 32)`` when unparsable or empty.
    """
    default = (64, 32)
    if raw is None or raw == "":
        return default
    if isinstance(raw, int):
        return (raw,)
    if isinstance(raw, (list, tuple)):
        try:
            values = tuple(int(v) for v in raw)
        except (TypeError, ValueError):
            return default
        return values or default
    if isinstance(raw, str):
        try:
            parts = [int(p.strip()) for p in raw.split(",") if p.strip()]
        except (TypeError, ValueError):
            return default
        return tuple(parts) if parts else default
    return default


def _resolve_device(requested: str = "auto"):
    """Resolve the compute device, honouring an explicit user choice.

    ``requested``: "auto" → CUDA GPU when present, else CPU; "cuda"/"gpu" →
    force GPU; "cpu" → force CPU. Lazy-imports torch so the module never
    hard-depends on it.
    """
    import torch

    if requested == "cpu":
        return torch.device("cpu")
    if requested in ("cuda", "gpu"):
        if torch.cuda.is_available():
            return torch.device("cuda")
        raise TrainingDataError("已要求 GPU，但此主機沒有可用的 CUDA GPU")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _cuda_available() -> bool:
    """True when a CUDA GPU is present (lazy import, never hard-imports torch)."""
    return _resolve_device().type == "cuda"


def build_model(model_type: str, params: dict, task: str, seed: int = 42, device: str = "auto"):
    """Instantiate an unfitted model. Returns (estimator, n_epochs)."""
    p = params or {}
    n_est = int(p.get("n_estimators", 200))
    # Resolve once so forcing GPU without hardware raises here (fail-fast)
    # instead of silently falling back mid-training.
    resolved = _resolve_device(device)
    use_gpu = resolved.type == "cuda"
    if model_type == "xgboost":
        from xgboost import XGBClassifier, XGBRegressor

        cls = XGBRegressor if task == "regression" else XGBClassifier
        early_stop = int(p.get("early_stopping_rounds", 30))
        est = cls(
            n_estimators=n_est,
            max_depth=int(p.get("max_depth", 4)),
            learning_rate=float(p.get("learning_rate", 0.03)),
            subsample=float(p.get("subsample", 0.7)),
            colsample_bytree=float(p.get("colsample_bytree", 0.6)),
            reg_alpha=float(p.get("reg_alpha", 0.5)),
            reg_lambda=float(p.get("reg_lambda", 5.0)),
            min_child_weight=int(p.get("min_child_weight", 10)),
            gamma=float(p.get("gamma", 0.1)),
            random_state=seed,
            n_jobs=-1,
            early_stopping_rounds=early_stop if early_stop > 0 else None,
            # GPU default (spec: 默認用 GPU) — xgboost 3.x uses `device`
            device="cuda" if use_gpu else "cpu",
            tree_method="hist",
        )
        return est, n_est
    if model_type == "lightgbm":
        import lightgbm as lgb
        from lightgbm import LGBMClassifier, LGBMRegressor

        cls = LGBMRegressor if task == "regression" else LGBMClassifier
        early_stop = int(p.get("early_stopping_rounds", 30))
        callbacks = [lgb.early_stopping(early_stop, verbose=False)] if early_stop > 0 else []
        est = cls(
            n_estimators=n_est,
            num_leaves=int(p.get("num_leaves", 31)),
            learning_rate=float(p.get("learning_rate", 0.03)),
            min_child_samples=int(p.get("min_child_samples", 20)),
            reg_alpha=float(p.get("reg_alpha", 0.5)),
            reg_lambda=float(p.get("reg_lambda", 5.0)),
            subsample=float(p.get("subsample", 0.7)),
            subsample_freq=1,
            colsample_bytree=float(p.get("colsample_bytree", 0.6)),
            random_state=seed,
            n_jobs=-1,
            verbose=-1,
            callbacks=callbacks,
            # GPU default (OpenCL path on NVIDIA) — falls back to CPU when absent
            device="gpu" if use_gpu else "cpu",
        )
        return est, n_est
    if model_type == "randomforest":
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

        cls = RandomForestRegressor if task == "regression" else RandomForestClassifier
        est = cls(
            n_estimators=n_est,
            max_depth=int(p.get("max_depth", 8)),
            min_samples_split=int(p.get("min_samples_split", 5)),
            min_samples_leaf=int(p.get("min_samples_leaf", 2)),
            max_features=p.get("max_features", "sqrt"),
            random_state=seed,
            n_jobs=-1,
        )
        return est, n_est
    if model_type == "mlp":
        from sklearn.neural_network import MLPClassifier, MLPRegressor

        epochs = int(p.get("epochs", 60))
        hidden = _parse_hidden_layers(p.get("hidden_layers") or p.get("hidden_units"))
        cls = MLPRegressor if task == "regression" else MLPClassifier
        early_stop = bool(p.get("early_stopping", True))
        est = cls(
            hidden_layer_sizes=hidden,
            max_iter=epochs,
            learning_rate_init=float(p.get("lr", 1e-3)),
            batch_size=int(p.get("batch_size", 64)),
            alpha=float(p.get("alpha", 1e-3)),
            validation_fraction=float(p.get("validation_fraction", 0.1)) if early_stop else 0.1,
            n_iter_no_change=int(p.get("n_iter_no_change", 10)) if early_stop else 100,
            early_stopping=early_stop,
            warm_start=True,
            random_state=seed,
        )
        return est, epochs
    if model_type == "lstm":
        return (
            LSTMWrapper(
                task=task,
                sequence_length=int(p.get("sequence_length", 20)),
                hidden_units=int(p.get("hidden_units", 64)),
                layers=int(p.get("layers", 1)),
                epochs=int(p.get("epochs", 30)),
                batch_size=int(p.get("batch_size", 64)),
                lr=float(p.get("lr", 1e-3)),
                dropout=float(p.get("dropout", 0.2)),
                weight_decay=float(p.get("weight_decay", 1e-4)),
                seed=seed,
                device=str(resolved),
            ),
            int(p.get("epochs", 30)),
        )
    raise TrainingDataError(f"不支援的模型類型: {model_type}")


# ── LSTM (spec §五, torch CPU) ───────────────────────────────────────────────

class LSTMWrapper:
    """Sklearn-style wrapper around a PyTorch LSTM with warm-start chunking.

    The Celery task feeds it 2D ``(n_samples, n_features)`` matrices whose
    rows are ordered stock-major (all rows of stock A, then stock B, ... —
    see ``prepare_frame``). To make sequences meaningful we slice per-stock
    windows of ``sequence_length`` consecutive rows; rows that cannot form a
    full window (the first ``sequence_length - 1`` rows of each stock) are
    edge-padded with the first available row, so ``predict`` always returns
    one value per input row and stays aligned with ``y`` / ``dates`` for the
    backtest track.

    Warm-start contract with the task: ``fit(X, y)`` trains exactly
    ``self.max_iter`` epochs on top of the existing weights (the task sets
    ``max_iter = chunk`` per progress step, mirroring MLP's warm_start).
    Runs on CUDA when a GPU is present (see ``_torch_device``); tensors are
    moved to ``self.device`` and predictions are returned as CPU numpy.
    """

    IS_LSTM = True

    def __init__(
        self,
        task: str,
        sequence_length: int = 20,
        hidden_units: int = 64,
        layers: int = 2,
        epochs: int = 50,
        batch_size: int = 32,
        lr: float = 1e-3,
        dropout: float = 0.0,
        weight_decay: float = 0.0,
        seed: int = 42,
        device: str = "auto",
    ) -> None:
        self.task = task
        self.sequence_length = int(sequence_length)
        self.hidden_units = int(hidden_units)
        self.layers = int(layers)
        self.batch_size = int(batch_size)
        self.lr = float(lr)
        self.dropout = float(dropout)
        self.weight_decay = float(weight_decay)
        self.seed = int(seed)
        self.max_iter = int(epochs)
        self.device = _resolve_device(device)
        self._model = None
        self._feature_count: int | None = None
        self._groups: np.ndarray | None = None
        self._is_fitted = False

    def set_groups(self, groups: np.ndarray) -> None:
        """Record per-row stock ids so sequences never cross a stock boundary."""
        groups = np.asarray(groups, dtype=object)
        self._groups = groups
        mapping: dict[object, int] = {}
        idx = np.empty(len(groups), dtype=np.int64)
        for i, g in enumerate(groups):
            gid = mapping.get(g)
            if gid is None:
                gid = len(mapping)
                mapping[g] = gid
            idx[i] = gid
        self._group_idx = idx
        boundaries = np.where(np.diff(idx) != 0)[0] + 1
        self._group_starts = np.concatenate([[0], boundaries])
        self._group_ends = np.concatenate([boundaries, [len(idx)]])

    def fit(self, X, y) -> "LSTMWrapper":
        """Train ``self.max_iter`` epochs on (optionally) scaled features."""
        import torch

        X = np.asarray(X, dtype=np.float32)
        y = np.asarray(y, dtype=np.float32)
        n = X.shape[0]
        if n < self.sequence_length:
            raise TrainingDataError(
                f"樣本數 {n} 小於 LSTM sequence_length {self.sequence_length}，請縮短序列或增加資料"
            )
        if self._model is None:
            torch.manual_seed(self.seed)
            self._feature_count = X.shape[1]
            if self._groups is None or len(self._groups) != n:
                self._group_idx = np.zeros(n, dtype=np.int64)
                self._group_starts = np.array([0])
                self._group_ends = np.array([n])
            self._model = _build_lstm_module(self._feature_count, self.task, self)
            self._model = self._model.to(self.device)
        yt = torch.from_numpy(y).to(self.device)
        optimizer = torch.optim.Adam(self._model.parameters(), lr=self.lr, weight_decay=self.weight_decay)
        loss_fn = (
            torch.nn.MSELoss()
            if self.task == "regression"
            else torch.nn.CrossEntropyLoss()
        )
        self._model.train()
        for _ in range(self.max_iter):
            perm = torch.randperm(n, generator=torch.Generator().manual_seed(self.seed))
            for i in range(0, n, self.batch_size):
                idx = perm[i : i + self.batch_size].cpu().numpy()
                batch_windows = self._make_windows_for_rows(X, idx)
                xt = torch.from_numpy(batch_windows).to(self.device)
                optimizer.zero_grad()
                out = self._model(xt)
                if self.task == "classification":
                    loss = loss_fn(out, yt[idx].long())
                else:
                    loss = loss_fn(out.squeeze(-1), yt[idx])
                loss.backward()
                optimizer.step()
        self._is_fitted = True
        return self

    def predict(self, X, groups: np.ndarray | None = None) -> np.ndarray:
        """Return per-row predictions (aligned to X rows via edge-padding).

        ``groups`` overrides the training stock ids per call (used for val/test
        splits); falls back to the training groups when omitted.
        """
        import torch

        if not self._is_fitted or self._model is None:
            raise TrainingDataError("LSTM 尚未訓練，無法預測")
        X = np.asarray(X, dtype=np.float32)
        n = X.shape[0]
        if groups is not None and len(groups) == n and not np.array_equal(
            np.asarray(groups, dtype=object), self._groups
        ):
            saved = (self._group_idx, self._group_starts, self._group_ends, self._groups)
            self.set_groups(groups)
            try:
                return self._predict_in_batches(X)
            finally:
                self._group_idx, self._group_starts, self._group_ends, self._groups = saved
        return self._predict_in_batches(X)

    def _predict_in_batches(self, X: np.ndarray) -> np.ndarray:
        import torch

        n = X.shape[0]
        preds = np.empty(n, dtype=np.float32)
        self._model.eval()
        with torch.no_grad():
            for i in range(0, n, self.batch_size):
                batch_idx = np.arange(i, min(i + self.batch_size, n))
                batch_windows = self._make_windows_for_rows(X, batch_idx)
                out = self._model(torch.from_numpy(batch_windows).to(self.device))
                if self.task == "classification":
                    proba = torch.softmax(out, dim=1)
                    preds[batch_idx] = proba[:, 1].cpu().numpy()
                else:
                    preds[batch_idx] = out.squeeze(-1).cpu().numpy()
        return preds

    def _window_for_row(self, X: np.ndarray, row: int) -> np.ndarray:
        """Build the window for a single row with edge padding."""
        seq = self.sequence_length
        gid = int(self._group_idx[row])
        start = int(self._group_starts[gid])
        end = int(self._group_ends[gid])
        local = row - start
        if local >= seq - 1:
            win = X[row - seq + 1 : row + 1]
        else:
            pad_rows = seq - 1 - local
            pad = np.repeat(X[start : start + 1], pad_rows, axis=0)
            win = np.concatenate([pad, X[start : row + 1]], axis=0)
        return win

    def _make_windows_for_rows(self, X: np.ndarray, row_indices: np.ndarray) -> np.ndarray:
        """Build windows only for the requested rows.

        Memory footprint is O(len(row_indices) * seq * n_features), so a 1024-row
        batch with seq=20 / 454 features costs ~37 MB instead of the 24 GB the
        full-tensor version paid.
        """
        n_feat = X.shape[1]
        out = np.empty((len(row_indices), self.sequence_length, n_feat), dtype=np.float32)
        for k, row in enumerate(row_indices):
            out[k] = self._window_for_row(X, int(row))
        return out


def _build_lstm_module(n_features: int, task: str, wrapper: "LSTMWrapper"):
    """Construct the torch LSTM module for the wrapper (imports torch lazily)."""
    import torch.nn as nn

    hidden = wrapper.hidden_units
    layers = wrapper.layers
    out = 2 if task == "classification" else 1
    dropout = wrapper.dropout
    weight_decay = wrapper.weight_decay

    class _LSTMModel(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=n_features,
                hidden_size=hidden,
                num_layers=layers,
                batch_first=True,
                dropout=dropout if layers > 1 else 0.0,
            )
            self.dropout = nn.Dropout(dropout) if dropout > 0 else None
            self.head = nn.Linear(hidden, out)
            self.weight_decay = weight_decay

        def forward(self, x):
            out, _ = self.lstm(x)
            last = out[:, -1, :]
            if self.dropout is not None:
                last = self.dropout(last)
            return self.head(last)

    return _LSTMModel()


# ── Metrics (spec §十一 ML track) ────────────────────────────────────────────

def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, task: str) -> dict:
    """ML-track metrics for one split."""
    y_true = np.asarray(y_true, dtype=np.float64)
    y_pred = np.asarray(y_pred, dtype=np.float64)
    if task == "regression":
        from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error

        win_rate = float(np.mean(np.sign(y_pred) == np.sign(y_true)) * 100) if len(y_true) else 0.0
        return {
            "mae": round(float(mean_absolute_error(y_true, y_pred)), 6),
            "rmse": round(float(root_mean_squared_error(y_true, y_pred)), 6),
            "r2": round(float(r2_score(y_true, y_pred)), 4),
            "win_rate": round(win_rate, 2),
        }
    from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

    y_pred_bin = (y_pred > 0.5).astype(int)
    out = {
        "accuracy": round(float(accuracy_score(y_true, y_pred_bin)), 4),
        "f1": round(float(f1_score(y_true, y_pred_bin, zero_division=0)), 4),
    }
    if _has_both_classes(y_true) and len(np.unique(y_pred)) > 1:
        out["auc"] = round(float(roc_auc_score(y_true, y_pred)), 4)
    else:
        out["auc"] = None
    return out


# ── Backtest (spec §十一 backtest track) ────────────────────────────────────

def run_prediction_backtest(
    dates: list[str] | np.ndarray,
    y_true: np.ndarray,
    y_pred: np.ndarray,
    buy_thresh_pct: float = 0.5,
    sell_thresh_pct: float = -0.5,
) -> dict:
    """Simulate a long-only strategy from model predictions (spec §步驟 6).

    Signal conversion per spec: predicted next-day return > buy threshold →
    long; < sell threshold → flat; else hold current position. Runs on the
    daily cross-sectional mean prediction/return so multi-stock universes
    collapse into one daily portfolio signal.

    Returns aggregate stats + per-day equity curve for the wizard Step 6
    回測軌 table.
    """
    dates = [str(d) for d in dates]
    y_true = np.asarray(y_true, dtype=np.float64)
    y_pred = np.asarray(y_pred, dtype=np.float64)
    if len(dates) == 0:
        return _empty_backtest()

    df = pd.DataFrame({"date": dates, "y": y_true, "pred": y_pred})
    daily = (
        df.groupby("date", sort=True)
        .agg(y=("y", "mean"), pred=("pred", "mean"))
        .reset_index()
    )
    day_dates = daily["date"].tolist()
    day_y = daily["y"].to_numpy()
    day_pred = daily["pred"].to_numpy()
    n_days = len(day_dates)

    buy, sell = buy_thresh_pct / 100.0, sell_thresh_pct / 100.0

    equity = 1.0
    peak = 1.0
    max_drawdown = 0.0
    position = False
    entry_idx = -1
    entry_date = ""
    trade_returns: list[float] = []
    equity_curve: list[dict] = []
    buys = 0
    sells = 0

    for i in range(n_days):
        if not position and day_pred[i] > buy:
            position = True
            entry_idx = i
            entry_date = day_dates[i]
            buys += 1
        elif position and day_pred[i] < sell:
            position = False
            trade_returns.append(
                float(np.prod(1.0 + day_y[entry_idx + 1 : i + 1])) - 1.0
                if i > entry_idx
                else 0.0
            )
            sells += 1

        if position:
            equity *= 1.0 + day_y[i]
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, (peak - equity) / peak)
        equity_curve.append(
            {"date": day_dates[i], "equity": round(equity * 100.0, 2)}
        )

    if position:
        trade_returns.append(
            float(np.prod(1.0 + day_y[entry_idx + 1 :])) - 1.0
            if entry_idx + 1 < n_days
            else 0.0
        )

    wins = [r for r in trade_returns if r > 0]
    losses = [r for r in trade_returns if r <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))

    return {
        "days": n_days,
        "total_return_pct": round((equity - 1.0) * 100.0, 2),
        "win_rate_pct": round(len(wins) / len(trade_returns) * 100.0, 1)
        if trade_returns
        else 0.0,
        "max_drawdown_pct": round(max_drawdown * 100.0, 2),
        "trades": len(trade_returns),
        "buys": buys,
        "sells": sells,
        "profit_factor": round(gross_win / gross_loss, 2)
        if gross_loss > 0
        else None,
        "equity_curve": equity_curve,
        "series": [
            {"date": d, "y": round(float(y), 8), "pred": round(float(p), 8)}
            for d, y, p in zip(day_dates, day_y, day_pred)
        ],
    }


def _empty_backtest() -> dict:
    return {
        "days": 0,
        "total_return_pct": 0.0,
        "win_rate_pct": 0.0,
        "max_drawdown_pct": 0.0,
        "trades": 0,
        "buys": 0,
        "sells": 0,
        "profit_factor": None,
        "equity_curve": [],
    }


def run_classification_backtest(
    dates: list[str] | np.ndarray,
    raw_returns: np.ndarray,
    prob_pred: np.ndarray,
    buy_threshold: float = 0.5,
    sell_threshold: float = 0.5,
) -> dict:
    """Translate classification probabilities into a long/flat strategy.

    For each row: ``prob > buy_threshold`` → enter long for the day,
    ``prob < sell_threshold`` → flat, else hold previous position.
    Daily P&L is the realised ``raw_return`` from the matching row, so the
    portfolio aggregates the cross-sectional mean of selected names.

    For classification tasks, ``buy_threshold`` doubles as the decision
    boundary (e.g. 0.5 = standard, 0.6 = only high-confidence longs).
    """
    dates = [str(d) for d in dates]
    raw_returns = np.asarray(raw_returns, dtype=np.float64)
    prob_pred = np.asarray(prob_pred, dtype=np.float64)
    if len(dates) == 0 or len(raw_returns) == 0:
        return _empty_backtest()

    df = pd.DataFrame({
        "date": dates,
        "raw_return": raw_returns,
        "prob": prob_pred,
    })
    daily = (
        df.groupby("date", sort=True)
        .agg(raw_return=("raw_return", "mean"), prob=("prob", "mean"))
        .reset_index()
    )
    day_dates = daily["date"].tolist()
    day_ret = daily["raw_return"].to_numpy()
    day_prob = daily["prob"].to_numpy()
    n_days = len(day_dates)

    equity = 1.0
    peak = 1.0
    max_drawdown = 0.0
    position = False
    entry_idx = -1
    trade_returns: list[float] = []
    equity_curve: list[dict] = []
    buys = 0
    sells = 0
    wins = 0
    losses = 0

    for i in range(n_days):
        if not position and day_prob[i] > buy_threshold:
            position = True
            entry_idx = i
            buys += 1
        if position and day_prob[i] < sell_threshold:
            trade_ret = float(np.prod(1 + day_ret[entry_idx : i + 1]) - 1)
            trade_returns.append(trade_ret)
            if trade_ret > 0:
                wins += 1
            else:
                losses += 1
            sells += 1
            position = False
            entry_idx = -1

        if position:
            equity *= 1 + day_ret[i]
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, (peak - equity) / peak if peak > 0 else 0.0)
        equity_curve.append({
            "date": day_dates[i],
            "y": equity,
            "pred": day_prob[i],
        })

    if position:
        trade_ret = float(np.prod(1 + day_ret[entry_idx : n_days]) - 1)
        trade_returns.append(trade_ret)
        if trade_ret > 0:
            wins += 1
        else:
            losses += 1

    total_return_pct = (equity - 1.0) * 100.0
    n_trades = len(trade_returns)
    win_rate_pct = (wins / n_trades * 100.0) if n_trades else 0.0
    gross_win = sum(r for r in trade_returns if r > 0)
    gross_loss = -sum(r for r in trade_returns if r < 0)
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else None

    signal_at_threshold = (day_prob > buy_threshold).astype(int)
    realised_dir = (day_ret > 0).astype(int)
    tp = int(np.sum((signal_at_threshold == 1) & (realised_dir == 1)))
    fp = int(np.sum((signal_at_threshold == 1) & (realised_dir == 0)))
    fn = int(np.sum((signal_at_threshold == 0) & (realised_dir == 1)))
    precision_at_threshold = tp / max(1, tp + fp)
    recall_at_threshold = tp / max(1, tp + fn)

    return {
        "days": n_days,
        "total_return_pct": round(total_return_pct, 4),
        "win_rate_pct": round(win_rate_pct, 2),
        "max_drawdown_pct": round(max_drawdown * 100.0, 4),
        "trades": n_trades,
        "buys": buys,
        "sells": sells,
        "profit_factor": round(profit_factor, 4) if profit_factor is not None else None,
        "buy_threshold": buy_threshold,
        "sell_threshold": sell_threshold,
        "precision_at_threshold": round(float(precision_at_threshold), 4),
        "recall_at_threshold": round(float(recall_at_threshold), 4),
        "equity_curve": equity_curve,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _compute_y(df: pd.DataFrame, target: str) -> pd.DataFrame:
    """Per-stock label via ``close`` shift (spec §三).

    Supports next-day (shift -1) and 5-day (shift -5) horizons, as regression
    (return) or classification (direction). The trailing horizon rows have no
    label and are dropped (never mislabelled 0).
    """
    df = df.sort_values(["stock_id", "date"]).copy()
    grp = df.groupby("stock_id", sort=False)["close"]
    if target == "next_return":
        df["y"] = grp.shift(-1) / df["close"] - 1
    elif target == "next_5d_return":
        df["y"] = grp.shift(-5) / df["close"] - 1
    elif target == "next_direction":
        nxt = grp.shift(-1)
        # (NaN > close) is False → astype(int) → 0, which dropna() keeps;
        # where() re-introduces NaN so the no-label last row is dropped.
        df["y"] = (nxt > df["close"]).astype(int).where(nxt.notna())
        df["raw_return"] = (nxt / df["close"] - 1).where(nxt.notna())
    elif target == "next_5d_direction":
        nxt5 = grp.shift(-5)
        df["y"] = (nxt5 > df["close"]).astype(int).where(nxt5.notna())
        df["raw_return"] = (nxt5 / df["close"] - 1).where(nxt5.notna())
    elif target == "next_price":
        df["y"] = grp.shift(-1)
    else:
        raise TrainingDataError(f"不支援的預測目標: {target}")
    return df.dropna(subset=["y"])


def _time_split(df: pd.DataFrame, ratios: tuple[float, float, float]):
    """Split by unique-date boundary — no shuffle (spec §四)."""
    dates = sorted(df["date"].unique())
    n = len(dates)
    i1 = int(n * ratios[0] / sum(ratios))
    i2 = i1 + int(n * ratios[1] / sum(ratios))
    train_dates = set(dates[:i1])
    val_dates = set(dates[i1:i2])
    test_dates = set(dates[i2:])
    train = df[df["date"].isin(train_dates)]
    val = df[df["date"].isin(val_dates)]
    test = df[df["date"].isin(test_dates)]
    if val.empty or test.empty:
        raise TrainingDataError("時間序分割後 val/test 為空，請縮短日期區間或調整比例")
    return train, val, test


def _norm_ratios(ratios) -> tuple[float, float, float]:
    r = [float(x) for x in ratios]
    if len(r) != 3 or any(x <= 0 for x in r):
        raise TrainingDataError(f"分割比例必須為 3 個正數: {ratios}")
    s = sum(r)
    return (r[0] / s, r[1] / s, r[2] / s)


def _to_numeric_frame(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    for c in cols:
        s = df[c]
        if s.dtype == bool:
            out[c] = s.astype(int)
        else:
            out[c] = pd.to_numeric(s, errors="coerce")
    return out


def _has_both_classes(y: np.ndarray) -> bool:
    return len(np.unique(y)) > 1


# ── Feature importance (sensitivity analysis) ───────────────────────────────

# Models compared for feature importance (spec: 敏感度分析).
IMPORTANCE_MODELS = ("xgboost", "lightgbm", "randomforest")


def compute_feature_importance(
    rows: list[dict],
    target: str,
    model_types: list[str] | None = None,
    n_estimators: int = 100,
    seed: int = 42,
    device: str = "cpu",
) -> dict:
    """Train each selected model and return its per-feature gain importance.

    Loads Y via ``_compute_y`` (per-stock, horizon-aware), median-fills from
    the full frame (sensitivity is a screen, not a trained artifact — no split
    is needed for ranking), drops constant/all-null columns, then fits one
    model per type and extracts feature importance.

    Returns: {model_type: {feature: importance_score}} sorted desc, plus
    ``task`` and ``feature_columns``.
    """
    models = [m for m in (model_types or list(IMPORTANCE_MODELS)) if m in IMPORTANCE_MODELS]
    if not models:
        raise TrainingDataError("沒有可用的重要性模型")

    task = TARGET_TASK.get(target)
    if task is None:
        raise TrainingDataError(f"不支援的預測目標: {target}")

    if not rows:
        raise TrainingDataError("無特徵資料")

    df = _compute_y(pd.DataFrame(rows), target)
    if df.empty:
        raise TrainingDataError("計算 Y 後無樣本")

    feature_cols = [c for c in df.columns if c not in FEATURE_EXCLUDE and c != "y"]
    X = _to_numeric_frame(df, feature_cols)
    keep = X.notna().any()
    feature_cols = [c for c in feature_cols if keep[c]]
    X = X[feature_cols]
    # Drop constant columns (std == 0 or all-null).
    X = X.replace([np.inf, -np.inf], np.nan)
    std = X.std()
    feature_cols = [c for c in feature_cols if c not in std[std == 0].index and X[c].notna().any()]
    X = X[feature_cols]
    if X.shape[1] == 0:
        raise TrainingDataError("沒有可用的特徵欄位")
    X = X.fillna(X.median())

    y = df["y"].to_numpy(dtype=np.float64)
    if task == "classification" and not _has_both_classes(y):
        raise TrainingDataError("目標只有單一類別，無法分析")

    result: dict = {"target": target, "task": task, "feature_columns": feature_cols, "models": {}}
    for mt in models:
        try:
            importance = _train_importance(mt, X.to_numpy(), y, task, n_estimators, seed, device)
        except Exception as exc:  # a single model failing shouldn't kill the run
            result["models"][mt] = {"error": str(exc)}
            continue
        ranked = dict(
            sorted(
                ((feature_cols[i], v) for i, v in enumerate(importance) if v is not None),
                key=lambda kv: kv[1],
                reverse=True,
            )
        )
        result["models"][mt] = ranked
    return result


def _train_importance(
    model_type: str,
    X: np.ndarray,
    y: np.ndarray,
    task: str,
    n_estimators: int,
    seed: int,
    device: str,
) -> list[float | None]:
    """Fit one model and return per-feature gain importance (aligned to X cols)."""
    if model_type == "xgboost":
        from xgboost import XGBClassifier, XGBRegressor

        cls = XGBRegressor if task == "regression" else XGBClassifier
        est = cls(
            n_estimators=n_estimators, max_depth=6, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, random_state=seed, n_jobs=-1,
            device="cpu",
        )
        est.fit(X, y)
        score_map = est.get_booster().get_score(importance_type="gain")
        out: list[float | None] = [None] * X.shape[1]
        for k, v in score_map.items():
            if k.startswith("f"):
                try:
                    out[int(k[1:])] = float(v)
                except ValueError:
                    continue
        return out
    if model_type == "lightgbm":
        from lightgbm import LGBMClassifier, LGBMRegressor

        cls = LGBMRegressor if task == "regression" else LGBMClassifier
        est = cls(
            n_estimators=n_estimators, num_leaves=31, learning_rate=0.05,
            min_child_samples=20, random_state=seed, n_jobs=-1, verbose=-1,
        )
        est.fit(X, y)
        imp = est.booster_.feature_importance(importance_type="gain")
        return [float(v) for v in imp]
    if model_type == "randomforest":
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

        cls = RandomForestRegressor if task == "regression" else RandomForestClassifier
        est = cls(n_estimators=n_estimators, max_depth=6, random_state=seed, n_jobs=-1)
        est.fit(X, y)
        imp = est.feature_importances_
        return [float(v) for v in imp]
    raise TrainingDataError(f"不支援的重要性模型: {model_type}")
