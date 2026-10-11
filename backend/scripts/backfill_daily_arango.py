"""Backfill ArangoDB stock_daily from 2010 for watchlist stocks.

Uses yfinance (which carries full TWSE history back to 2010) and merges into
the existing ArangoDB stock_daily collection — missing older rows are added,
existing rows are left untouched. After this, fetch_daily_history can serve
data back to 2010 and the Daniel MA warm-up spans the full range.

Usage:
    python scripts/backfill_daily_arango.py [--stock 2330] [--start 2010-01-01]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import get_db


def _suffix(stock_id: str) -> str:
    import twstock

    info = twstock.codes.get(stock_id)
    if info and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def _fetch(symbol: str, start: str, end: str) -> list[dict]:
    ticker = yf.Ticker(f"{symbol}{_suffix(symbol)}")
    hist = ticker.history(start=start, end=end, auto_adjust=False)
    records = []
    for dt, row in hist.iterrows():
        close_val = float(row["Close"])
        if close_val != close_val:
            continue
        ts = dt
        if getattr(ts, "tzinfo", None) is not None:
            ts = ts.tz_localize(None)
        records.append(
            {
                "date": ts.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(close_val, 2),
                "volume": int(row["Volume"]),
            }
        )
    return records


def _backfill_stock(symbol: str, start: str, end: str) -> int:
    db = get_db()
    col = db.collection("stock_daily")
    existing = {
        str(r)
        for r in db.aql.execute(
            "FOR d IN stock_daily FILTER d.stock_id == @s RETURN d.date",
            bind_vars={"s": symbol},
        )
    }
    fetched = _fetch(symbol, start, end)
    new_rows = [r for r in fetched if r["date"] not in existing]
    added = 0
    for r in new_rows:
        key = f"{symbol}_{r['date']}"
        doc = {"_key": key, "stock_id": symbol, **r}
        try:
            col.insert(doc, overwrite=False)
            added += 1
        except Exception:
            pass
    print(
        f"  {symbol}: fetched={len(fetched)}, existing={len(existing)}, added={added}, "
        f"total_after={len(existing) + added}"
    )
    return added


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock", type=str, default=None)
    parser.add_argument("--start", type=str, default="2010-01-01")
    parser.add_argument("--end", type=str, default="2027-01-01")
    args = parser.parse_args()

    db = get_db()
    if args.stock:
        stock_ids = [args.stock]
    else:
        stock_ids = [str(s) for s in db.aql.execute("FOR w IN watchlist RETURN w.stock_id")]

    print(f"Backfilling {len(stock_ids)} stocks from {args.start} to {args.end}")
    for sid in stock_ids:
        _backfill_stock(sid, args.start, args.end)


if __name__ == "__main__":
    main()
