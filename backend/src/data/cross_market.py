"""Cross-market reference data loader for TWII RL trading environment.

Computes daily-aligned US market features (S&P 500, Nasdaq, VIX, US 10Y yield,
USD index) that align to TWII trading days. Handles US/TW holiday mismatch
by using forward-fill (carry-forward last known value).

Output columns (per TWII date):
  - sp500_ret_1d: S&P 500 1-day return
  - sp500_ret_5d: S&P 500 5-day return
  - ixic_ret_1d:  Nasdaq 1-day return
  - ixic_ret_5d:  Nasdaq 5-day return
  - vix_level:    VIX level (normalized 0..1 over 5y window)
  - vix_change:   VIX 1-day change
  - tnx_change:   US 10Y yield 5-day change
  - dxy_ret_5d:   DXY 5-day return
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

CACHE_DIR = Path(__file__).parent.parent.parent / "data" / "cross_market"

FEATURE_COLUMNS = [
    "sp500_ret_1d", "sp500_ret_5d",
    "ixic_ret_1d", "ixic_ret_5d",
    "vix_level", "vix_change",
    "tnx_change", "dxy_ret_5d",
]


def _load_one(name: str) -> pd.Series:
    path = CACHE_DIR / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Cross-market cache missing: {path}. Run scripts/fetch_cross_market.py")
    df = pd.read_csv(path, parse_dates=["date"])
    df = df.sort_values("date").reset_index(drop=True)
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    return df.set_index("date")["close"].rename(name)


def load_panel() -> pd.DataFrame:
    """Load all cross-market series as one DataFrame, indexed by date string.

    Returns DataFrame with columns: sp500, ixic, vix, tnx, dxy (close prices).
    Reindexed with business-day forward-fill to cover all calendar days, so
    alignment to TWII dates works regardless of TW/US holiday mismatch.
    """
    series = [_load_one(name) for name in ("sp500", "ixic", "vix", "tnx", "dxy")]
    panel = pd.concat(series, axis=1)
    panel.index = pd.to_datetime(panel.index)
    full_idx = pd.date_range(panel.index.min(), panel.index.max(), freq="D")
    panel = panel.reindex(full_idx).ffill().dropna(how="all")
    panel.index = panel.index.strftime("%Y-%m-%d")
    panel = panel[~panel.index.duplicated(keep="last")]
    return panel


def compute_features(twii_dates: Iterable[str]) -> pd.DataFrame:
    """Compute 8 cross-market features aligned to TWII trading dates.

    For each TWII date, fetches features using the most recent available US
    trading day's data (forward-fill logic). If a TWII date precedes the first
    available US date, fills with 0.0 (no signal yet).
    """
    panel = load_panel()
    dates = pd.to_datetime(list(twii_dates))
    if len(dates) == 0:
        return pd.DataFrame(columns=["date"] + FEATURE_COLUMNS)

    sp500 = panel["sp500"].copy()
    ixic = panel["ixic"].copy()
    vix = panel["vix"].copy()
    tnx = panel["tnx"].copy()
    dxy = panel["dxy"].copy()

    sp500_ret_1d = sp500.pct_change(1)
    sp500_ret_5d = sp500.pct_change(5)
    ixic_ret_1d = ixic.pct_change(1)
    ixic_ret_5d = ixic.pct_change(5)
    vix_change = vix.pct_change(1)

    # VIX level: rolling 5y z-score (more stable than raw value for neural net)
    vix_roll_mean = vix.rolling(window=252 * 5, min_periods=60).mean()
    vix_roll_std = vix.rolling(window=252 * 5, min_periods=60).std() + 1e-9
    vix_z = (vix - vix_roll_mean) / vix_roll_std
    # Clip to [-3, 3] to avoid extreme outliers dominating the network
    vix_level = vix_z.clip(-3.0, 3.0) / 3.0

    tnx_change = tnx.diff(5)
    dxy_ret_5d = dxy.pct_change(5)

    feat = pd.DataFrame({
        "sp500_ret_1d": sp500_ret_1d,
        "sp500_ret_5d": sp500_ret_5d,
        "ixic_ret_1d": ixic_ret_1d,
        "ixic_ret_5d": ixic_ret_5d,
        "vix_level": vix_level,
        "vix_change": vix_change,
        "tnx_change": tnx_change,
        "dxy_ret_5d": dxy_ret_5d,
    })
    feat.index.name = "date"

    # Reindex to TWII dates; NaN → 0.0 (no signal)
    feat = feat.reindex(dates.strftime("%Y-%m-%d")).fillna(0.0)
    feat.index.name = "date"
    feat = feat.reset_index()

    # Clip extreme returns to [-0.2, 0.2] (US single-day moves rarely exceed this)
    for col in ("sp500_ret_1d", "ixic_ret_1d", "vix_change"):
        feat[col] = feat[col].clip(-0.2, 0.2)
    for col in ("sp500_ret_5d", "ixic_ret_5d", "dxy_ret_5d"):
        feat[col] = feat[col].clip(-0.3, 0.3)
    feat["tnx_change"] = feat["tnx_change"].clip(-1.0, 1.0)

    return feat


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from src.tasks.tx_rl_training import _load_twii_df

    twii = _load_twii_df()
    feat = compute_features(twii["date"].astype(str).tolist())
    print(f"Features: {feat.shape}, columns: {list(feat.columns)}")
    print(f"Date range: {feat['date'].iloc[0]} ~ {feat['date'].iloc[-1]}")
    print(f"\nSample (2015-08-24 crash day):")
    sample = feat[feat["date"] == "2015-08-24"]
    if not sample.empty:
        print(sample.to_string(index=False))
    print(f"\nFeature stats:")
    print(feat[FEATURE_COLUMNS].describe().round(4))