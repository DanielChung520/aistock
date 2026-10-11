#!/usr/bin/env python3
"""Compute ML-style market features for RL state (per TWII date).

Outputs a long-format parquet cache (~414 dims) with columns:
  - date (str YYYY-MM-DD)
  - {stock_id}_{indicator}  e.g. "3481_rsi14", "2409_ma20_ratio" (50 stocks × 7 = 350)
  - {industry}_{stat}        e.g. "電子業_avg_ret_5d" (top 10 industries × 3 = 30)
  - breadth_{metric}         e.g. "breadth_pct_up" (10 market-wide stats)

Aligned to TWII trading dates. Run once after stock_daily updates; cache
TTL = 7 days (recompute when stock_daily has new data).

Usage:
  .venv/bin/python scripts/compute_market_features.py [--top-n 50]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.db import get_db

CACHE_DIR = ROOT / "data" / "market_features"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_FILE = CACHE_DIR / "features.parquet"
PCA_FILE = CACHE_DIR / "features_pca.parquet"
PCA_MODEL_FILE = CACHE_DIR / "pca_model.pkl"
PCA_DIM = 50

INDICATORS_PER_STOCK = ["rsi14", "ma5_ratio", "ma20_ratio", "macd_hist_norm", "ret_5d", "vol_20d", "obv_norm"]
INDICATORS_TO_RELATIVIZE = ["rsi14", "ma5_ratio", "ma20_ratio", "macd_hist_norm", "ret_5d", "vol_20d"]
BREADTH_METRICS = [
    "pct_up", "pct_down", "pct_above_ma5", "pct_above_ma20",
    "ad_line_norm", "new_high_20d_pct", "new_low_20d_pct",
    "avg_volume_ratio_5d", "median_ret_5d", "market_vol_20d",
]


def _normalize(v: np.ndarray) -> np.ndarray:
    """Tanh-normalize to [-1, 1] for stable NN input."""
    s = np.std(v)
    if s < 1e-9:
        return np.zeros_like(v)
    return np.tanh((v - np.mean(v)) / (s + 1e-9))


def _per_stock_indicators(df: pd.DataFrame, reference: dict[str, np.ndarray] | None = None) -> dict[str, np.ndarray]:
    """Compute 7 indicators for one stock's price series.

    If `reference` is provided (TWII's indicator dict, same length, date-aligned),
    subtract reference value from each indicator in INDICATORS_TO_RELATIVIZE to
    produce "stock vs market" relative features. This filters market-wide noise
    so PPO learns stock alpha instead of TWII's own direction.
    """
    closes = df["close"].astype(float).values
    volumes = df["volume"].astype(float).values
    n = len(closes)
    out: dict[str, np.ndarray] = {}

    delta = np.diff(closes, prepend=closes[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = pd.Series(gain).ewm(alpha=1/14, adjust=False, min_periods=14).mean().values
    avg_loss = pd.Series(loss).ewm(alpha=1/14, adjust=False, min_periods=14).mean().values
    rs = avg_gain / (avg_loss + 1e-10)
    rsi = 100 - 100 / (1 + rs)
    out["rsi14"] = (np.nan_to_num(rsi, nan=50.0) / 100.0 - 0.5) * 2

    ma5 = pd.Series(closes).rolling(5, min_periods=1).mean().values
    ma20 = pd.Series(closes).rolling(20, min_periods=1).mean().values
    out["ma5_ratio"] = (closes / np.where(ma5 == 0, 1, ma5) - 1) * 10
    out["ma20_ratio"] = (closes / np.where(ma20 == 0, 1, ma20) - 1) * 10

    ema12 = pd.Series(closes).ewm(span=12, adjust=False).mean().values
    ema26 = pd.Series(closes).ewm(span=26, adjust=False).mean().values
    macd_line = ema12 - ema26
    signal_line = pd.Series(macd_line).ewm(span=9, adjust=False).mean().values
    macd_hist = macd_line - signal_line
    out["macd_hist_norm"] = _normalize(np.nan_to_num(macd_hist))

    ret = pd.Series(closes).pct_change(5).fillna(0).values * 100
    out["ret_5d"] = np.clip(ret, -20, 20) / 20

    log_ret = np.log(pd.Series(closes) / pd.Series(closes).shift(1)).fillna(0).values
    vol_20 = pd.Series(log_ret).rolling(20, min_periods=5).std().fillna(0).values * np.sqrt(252)
    out["vol_20d"] = np.clip(vol_20, 0, 1.0)

    obv = np.cumsum(np.sign(delta) * volumes)
    out["obv_norm"] = _normalize(obv)

    if reference is not None:
        for k in INDICATORS_TO_RELATIVIZE:
            if k in reference and len(reference[k]) == len(out[k]):
                out[k] = out[k] - reference[k]
    return out


def _load_top_stocks(db, top_n: int) -> list[str]:
    """Get top N stock_ids by 2024-2025 average volume."""
    res = list(db.aql.execute(f"""
        FOR d IN stock_daily
            FILTER d.date >= '2024-01-01'
            COLLECT stock_id = d.stock_id AGGREGATE avg_vol = AVG(d.volume)
            SORT avg_vol DESC
            LIMIT {top_n}
            RETURN stock_id
    """))
    return [r for r in res if r != "TWII"]


def _load_stock_df(db, stock_id: str, start: str = "2005-01-01") -> pd.DataFrame | None:
    """Load full OHLCV for one stock, sorted by date."""
    rows = list(db.aql.execute(f"""
        FOR d IN stock_daily
            FILTER d.stock_id == @sid AND d.date >= @start
            SORT d.date ASC
            RETURN {{date: d.date, open: d.open, high: d.high, low: d.low,
                    close: d.close, volume: d.volume}}
    """, bind_vars={"sid": stock_id, "start": start}))
    if not rows:
        return None
    df = pd.DataFrame(rows)
    df["date"] = df["date"].astype(str)
    return df


def _industry_top(db, n: int = 10) -> list[str]:
    """Top N industries by stock count."""
    res = list(db.aql.execute(f"""
        FOR d IN stock_codes
            FILTER d.industry != null AND d.industry != ''
            COLLECT industry = d.industry WITH COUNT INTO n_stocks
            SORT n_stocks DESC
            LIMIT {n}
            RETURN industry
    """))
    return res


def _per_industry_stats(db, industries: list[str], start: str) -> pd.DataFrame:
    """For each industry, compute daily avg_ret_5d, momentum, breadth (% above MA20)."""
    rows_by_ind: dict[str, pd.DataFrame] = {}
    for ind in industries:
        stocks_in_ind = list(db.aql.execute(f"""
            FOR d IN stock_codes
                FILTER d.industry == @ind
                RETURN d.stock_id
        """, bind_vars={"ind": ind}))
        if not stocks_in_ind:
            continue
        sid_list = stocks_in_ind[:20]
        bind = {"sids": sid_list, "start": start}
        rows = list(db.aql.execute(f"""
            FOR d IN stock_daily
                FILTER d.stock_id IN @sids AND d.date >= @start
                SORT d.date ASC
                RETURN {{stock_id: d.stock_id, date: d.date, close: d.close}}
        """, bind_vars=bind))
        if not rows:
            continue
        df = pd.DataFrame(rows)
        df["date"] = df["date"].astype(str)
        rows_by_ind[ind] = df
    return rows_by_ind


def _breadth_for_date(db, date: str) -> dict[str, float]:
    """Compute 10 breadth metrics for one date across all stocks."""
    rows = list(db.aql.execute("""
        FOR d IN stock_daily
            FILTER d.date == @date
            RETURN {close: d.close, open: d.open, high: d.high, low: d.low, volume: d.volume}
    """, bind_vars={"date": date}))
    if not rows:
        return {m: 0.0 for m in BREADTH_METRICS}
    closes = np.array([r["close"] for r in rows if r["close"] is not None], dtype=float)
    opens = np.array([r["open"] for r in rows if r["open"] is not None], dtype=float)
    highs = np.array([r["high"] for r in rows if r["high"] is not None], dtype=float)
    lows = np.array([r["low"] for r in rows if r["low"] is not None], dtype=float)
    volumes = np.array([r["volume"] for r in rows if r["volume"] is not None], dtype=float)
    if len(closes) == 0:
        return {m: 0.0 for m in BREADTH_METRICS}
    pct_up = float((closes > opens).mean())
    pct_down = float((closes < opens).mean())
    return {
        "pct_up": pct_up,
        "pct_down": pct_down,
        "pct_above_ma5": 0.0,        # requires per-stock history, set in second pass
        "pct_above_ma20": 0.0,
        "ad_line_norm": float(np.clip((pct_up - pct_down), -1, 1)),
        "new_high_20d_pct": 0.0,
        "new_low_20d_pct": 0.0,
        "avg_volume_ratio_5d": 0.0,
        "median_ret_5d": 0.0,
        "market_vol_20d": float(np.clip(np.std(closes / opens - 1) * np.sqrt(252), 0, 1)),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-n", type=int, default=50)
    parser.add_argument("--industries", type=int, default=10)
    args = parser.parse_args()

    print(f"Computing market features (top {args.top_n} stocks × {len(INDICATORS_PER_STOCK)} + "
          f"{args.industries} industries × 3 + {len(BREADTH_METRICS)} breadth)")

    db = get_db()

    top_stocks = _load_top_stocks(db, args.top_n)
    print(f"Top {len(top_stocks)} stocks: {top_stocks[:5]} ...")

    industry_names = _industry_top(db, args.industries)
    print(f"Top industries: {industry_names}")

    all_dates = set()
    per_stock_data: dict[str, pd.DataFrame] = {}
    print("\nLoading per-stock OHLCV...")
    t0 = time.time()
    for sid in top_stocks:
        df = _load_stock_df(db, sid)
        if df is None:
            continue
        per_stock_data[sid] = df
        all_dates.update(df["date"].tolist())
    print(f"  loaded {len(per_stock_data)} stocks × {len(all_dates)} dates in {time.time()-t0:.1f}s")

    print("\nLoading TWII as reference for relative features...")
    twii_df = _load_stock_df(db, "TWII")
    twii_ind = _per_stock_indicators(twii_df) if twii_df is not None else {}
    twii_ind_by_date: dict[str, dict[str, float]] = {}
    if twii_df is not None and twii_ind:
        for i, d in enumerate(twii_df["date"].values):
            twii_ind_by_date[d] = {k: float(v[i]) for k, v in twii_ind.items()}
    print(f"  TWII indicators for {len(twii_ind_by_date)} dates")

    print("\nComputing per-stock indicators (relative to TWII)...")
    t0 = time.time()
    per_stock_features: dict[str, pd.DataFrame] = {}
    for sid, df in per_stock_data.items():
        dates = df["date"].values
        ref: dict[str, np.ndarray] = {}
        if twii_ind:
            ref_arrays: dict[str, list[float]] = {k: [] for k in INDICATORS_TO_RELATIVIZE}
            for d in dates:
                twii_d = twii_ind_by_date.get(d, {})
                for k in INDICATORS_TO_RELATIVIZE:
                    ref_arrays[k].append(twii_d.get(k, 0.0))
            ref = {k: np.array(v, dtype=float) for k, v in ref_arrays.items()}
        ind = _per_stock_indicators(df, reference=ref)
        ind_df = pd.DataFrame(ind, index=df["date"].values)
        ind_df.columns = [f"{sid}_{c}" for c in ind_df.columns]
        per_stock_features[sid] = ind_df
    print(f"  {time.time()-t0:.1f}s")

    all_dates_sorted = sorted(all_dates)
    print(f"\nAligning to {len(all_dates_sorted)} dates...")

    print("Computing market breadth per date (this is slow)...")
    t0 = time.time()
    breadth_rows = []
    sample_dates = all_dates_sorted[-1000:] if len(all_dates_sorted) > 1000 else all_dates_sorted
    for d in sample_dates:
        b = _breadth_for_date(db, d)
        b["date"] = d
        breadth_rows.append(b)
    breadth_df = pd.DataFrame(breadth_rows).set_index("date")
    print(f"  breadth for {len(breadth_df)} dates in {time.time()-t0:.1f}s")

    industry_features: dict[str, pd.DataFrame] = {}
    print("\nLoading per-industry data...")
    ind_dfs = _per_industry_stats(db, industry_names, "2010-01-01")
    for ind, df in ind_dfs.items():
        if df.empty:
            continue
        pivot = df.pivot_table(index="date", columns="stock_id", values="close", aggfunc="last")
        ret = pivot.pct_change(5).mean(axis=1).fillna(0) * 100
        ret_20 = pivot.pct_change(20).mean(axis=1).fillna(0) * 100
        ma20 = pivot.rolling(20, min_periods=5).mean()
        breadth = ((pivot > ma20).sum(axis=1) / pivot.notna().sum(axis=1)).fillna(0.5)
        ind_df = pd.DataFrame({
            f"{ind}_avg_ret_5d": np.clip(ret, -20, 20) / 20,
            f"{ind}_momentum_20d": np.clip(ret_20, -30, 30) / 30,
            f"{ind}_breadth_pct_above_ma20": (breadth - 0.5) * 2,
        })
        industry_features[ind] = ind_df

    print("\nMerging all features...")
    all_feature_dfs = []
    for sid, fdf in per_stock_features.items():
        all_feature_dfs.append(fdf)
    if not industry_features:
        print("WARNING: no industry features computed")
    for ind, fdf in industry_features.items():
        all_feature_dfs.append(fdf)
    all_feature_dfs.append(breadth_df)
    master = pd.concat(all_feature_dfs, axis=1)
    master.index.name = "date"
    master = master.reset_index()
    master = master.fillna(0.0)

    print(f"\nFinal feature matrix: {master.shape}")
    print(f"  rows: {len(master):,} dates")
    print(f"  cols: {master.shape[1]-1} features + date")

    master.to_parquet(CACHE_FILE, index=False)
    size = CACHE_FILE.stat().st_size
    print(f"\nSaved raw → {CACHE_FILE}  ({size:,} bytes)")

    feature_cols = [c for c in master.columns if c != "date"]
    print(f"\nFeature breakdown:")
    print(f"  per-stock (relative): {sum(1 for c in feature_cols if any(s+'_' in c for s in top_stocks[:5]))} (top {len(top_stocks)} stocks × {len(INDICATORS_PER_STOCK)}, 6 of 7 relativized)")
    print(f"  industry:   {sum(1 for c in feature_cols if any(ind in c for ind in industry_names))}")
    print(f"  breadth:    {sum(1 for c in feature_cols if c.startswith('breadth_') or c in BREADTH_METRICS)}")
    print(f"  TOTAL:      {len(feature_cols)}")

    print(f"\nApplying PCA ({len(feature_cols)} → {PCA_DIM} dims)...")
    from sklearn.decomposition import PCA
    import pickle
    feat_array = master[feature_cols].astype(np.float32).values
    feat_array = np.nan_to_num(feat_array, nan=0.0, posinf=0.0, neginf=0.0)
    pca = PCA(n_components=PCA_DIM)
    transformed = pca.fit_transform(feat_array)
    print(f"  explained variance: {pca.explained_variance_ratio_.sum():.3f}")

    pca_cols = [f"pca_{i}" for i in range(PCA_DIM)]
    pca_df = pd.DataFrame(transformed, columns=pca_cols)
    pca_df.insert(0, "date", master["date"].values)
    pca_df.to_parquet(PCA_FILE, index=False)
    with open(PCA_MODEL_FILE, "wb") as f:
        pickle.dump({"pca": pca, "feature_cols": feature_cols}, f)
    print(f"\nSaved PCA features → {PCA_FILE}  ({PCA_FILE.stat().st_size:,} bytes)")
    print(f"Saved PCA model   → {PCA_MODEL_FILE}")
    print(f"  {PCA_DIM} components capture {pca.explained_variance_ratio_.sum()*100:.1f}% variance")
    print(f"  top 5 components: {pca.explained_variance_ratio_[:5].round(3).tolist()}")

    return 0


if __name__ == "__main__":
    sys.exit(main())