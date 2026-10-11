#!/usr/bin/env python3
"""Fetch cross-market reference data (US indices, VIX, DXY, US bond yield).

Caches results as CSV under data/cross_market/. Re-runnable; skips if file exists.

Tickers:
  ^GSPC  - S&P 500
  ^IXIC  - Nasdaq Composite
  ^VIX   - CBOE Volatility Index
  ^TNX   - 10-Year Treasury Yield
  DX-Y.NYB - US Dollar Index

Usage:
  .venv/bin/python scripts/fetch_cross_market.py [--start 2005-01-01]
"""
import sys
import time
from pathlib import Path

import pandas as pd
import yfinance as yf

CACHE_DIR = Path(__file__).parent.parent / "data" / "cross_market"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

TICKERS = {
    "sp500": "^GSPC",
    "ixic": "^IXIC",
    "vix": "^VIX",
    "tnx": "^TNX",
    "dxy": "DX-Y.NYB",
}


def fetch_one(name: str, ticker: str, start: str, end: str) -> Path:
    out_path = CACHE_DIR / f"{name}.csv"
    if out_path.exists():
        df = pd.read_csv(out_path, parse_dates=["date"])
        if len(df) > 0 and pd.Timestamp(df["date"].min()) <= pd.Timestamp(start):
            print(f"  ✓ {name}: cached ({len(df)} rows)")
            return out_path

    print(f"  ↓ {name} ({ticker}) downloading...")
    try:
        data = yf.Ticker(ticker).history(start=start, end=end, auto_adjust=False)
    except Exception as e:
        print(f"  ✗ {name}: failed - {e}")
        return out_path

    if data.empty:
        print(f"  ✗ {name}: no data")
        return out_path

    df = pd.DataFrame({
        "date": data.index.strftime("%Y-%m-%d"),
        "open": data["Open"].values,
        "high": data["High"].values,
        "low": data["Low"].values,
        "close": data["Close"].values,
        "volume": data["Volume"].values if "Volume" in data else 0,
    })
    df.to_csv(out_path, index=False)
    print(f"  ✓ {name}: saved {len(df)} rows → {out_path.name}")
    return out_path


def main() -> int:
    start = "2005-01-01"
    end = "2026-12-31"
    for arg in sys.argv[1:]:
        if arg.startswith("--start="):
            start = arg.split("=", 1)[1]

    print(f"Fetching cross-market data ({start} ~ {end}) → {CACHE_DIR}")
    for name, ticker in TICKERS.items():
        fetch_one(name, ticker, start, end)
        time.sleep(1)  # polite rate limit

    print("\n=== cache summary ===")
    for f in sorted(CACHE_DIR.glob("*.csv")):
        df = pd.read_csv(f, parse_dates=["date"])
        print(f"  {f.name:<16} {len(df):>5} rows  {df['date'].min().date()} ~ {df['date'].max().date()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())