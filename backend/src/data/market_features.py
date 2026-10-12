"""Market features loader for TX-RL trading environment.

Reads PCA-reduced features (50 dims, captures ~92% of variance) from
data/market_features/features_pca.parquet produced by scripts/compute_market_features.py.
Features are already stock-vs-TWII relative (market-wide noise filtered).

Output shape: (n_twii_dates, 50) float32 matrix.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

CACHE_FILE = Path(__file__).parent.parent.parent / "data" / "market_features" / "features_pca.parquet"

_FEATURE_CACHE: pd.DataFrame | None = None
_FEATURE_COLUMNS: list[str] | None = None


def _load_cache() -> pd.DataFrame:
    global _FEATURE_CACHE, _FEATURE_COLUMNS
    if _FEATURE_CACHE is None:
        if not CACHE_FILE.exists():
            raise FileNotFoundError(
                f"Market features cache missing: {CACHE_FILE}. "
                "Run scripts/compute_market_features.py first."
            )
        df = pd.read_parquet(CACHE_FILE)
        df["date"] = df["date"].astype(str)
        _FEATURE_CACHE = df.set_index("date").sort_index()
        _FEATURE_COLUMNS = [c for c in _FEATURE_CACHE.columns]
    return _FEATURE_CACHE


def get_feature_columns() -> list[str]:
    _load_cache()
    assert _FEATURE_COLUMNS is not None
    return list(_FEATURE_COLUMNS)


def get_feature_dim() -> int:
    return len(get_feature_columns())


def compute_features(twii_dates: list[str]) -> pd.DataFrame:
    cache = _load_cache()
    out = cache.reindex(twii_dates).ffill().fillna(0.0)
    out.index.name = "date"
    out = out.reset_index()
    for col in out.columns:
        if col == "date":
            continue
        out[col] = out[col].clip(-5.0, 5.0)
    return out


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from src.tasks.tx_rl_training import _load_twii_df

    twii = _load_twii_df()
    feat = compute_features(twii["date"].astype(str).tolist())
    print(f"Features: {feat.shape}")
    print(f"  rows: {len(feat):,}")
    print(f"  cols: {feat.shape[1] - 1} (excl. date)")
    print(f"\nFirst 5 columns: {list(feat.columns[:6])}")
    print(f"\nStats:")
    print(feat[get_feature_columns()[:5]].describe().round(3))