#!/usr/bin/env python3
"""
已棄用 (DEPRECATED)：本腳本寫入 stock_daily_o1c1。方案A 之後 OHLCV 統一由
stock_daily (yfinance) 提供，O1/C1 由 research_ohlcv 經 yfinance 60m 推導並寫入
stock_daily。請改用 backend/src/tasks/backfill_daily.py / research_download.py。
保留僅供歷史參考，勿再執行。

Original docstring below (history only):
---
Backfill 10 years of daily OHLCV for the 59-stock research universe.

Extends `stock_daily_o1c1` from the current ~2y window back to 2016-08-01.
Existing O1/C1 values (2y model-training window) are PRESERVED — this script
only upserts open/high/low/close/volume and leaves o1/c1 untouched.

Source: yfinance with correct suffix (.TW for 上市/TWSE, .TWO for 上櫃/TPEx).
Resumable: skips dates already present with a non-null close.

Usage:
  python scripts/backfill_10y.py            # all 59 stocks
  python scripts/backfill_10y.py --sid 2330 # single stock
"""
import argparse
import sys
import time
from datetime import date

sys.path.insert(0, "/home/daniel/github/aistock/backend/scripts")
import _dns_fix  # noqa: E402
_dns_fix.patch()

import yfinance as yf
from arango.exceptions import ArangoError

sys.path.insert(0, "/home/daniel/github/aistock/backend")
from src.db import get_db

COLLECTION = "stock_daily_o1c1"
UNIVERSE_PATH = "/home/daniel/github/aistock/frontend/src/lib/data/research-universe-ai-memory-passive.json"
START = "2016-08-01"

# 5 delisted/renamed stocks with no data source — skip (removed from universe)
SKIP = {"3536", "6091", "6444", "1333", "2456"}


def ensure_collection() -> None:
    db = get_db()
    if not db.has_collection(COLLECTION):
        db.create_collection(COLLECTION)
    col = db.collection(COLLECTION)
    existing = [idx["fields"] for idx in col.indexes() if idx["fields"] != ["_key"]]
    if ["stock_id", "date"] not in existing:
        try:
            col.add_index({"type": "hash", "fields": ["stock_id", "date"], "unique": True})
        except Exception:
            pass


def get_existing_dates(stock_id: str) -> set[str]:
    db = get_db()
    aql = """
    FOR d IN stock_daily_o1c1
      FILTER d.stock_id == @sid
      RETURN d.date
    """
    return {row for row in db.aql.execute(aql, bind_vars={"sid": stock_id})}


def _suffix(stock_id: str) -> str:
    import twstock

    info = twstock.codes.get(stock_id)
    if info and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def fetch_10y(stock_id: str) -> list[dict]:
    """Return [{date, open, high, low, close, volume}] since START."""
    ticker = f"{stock_id}{_suffix(stock_id)}"
    df = yf.Ticker(ticker).history(start=START, end="2030-01-01", auto_adjust=False)
    if df.empty:
        return []
    rows = []
    for dt, r in df.iterrows():
        try:
            c = float(r["Close"])
            if c != c:
                continue
            rows.append({
                "date": dt.strftime("%Y-%m-%d"),
                "open": round(float(r["Open"]), 2),
                "high": round(float(r["High"]), 2),
                "low": round(float(r["Low"]), 2),
                "close": round(c, 2),
                "volume": int(r["Volume"]),
            })
        except Exception:
            continue
    return rows


def upsert(stock_id: str, records: list[dict]) -> tuple[int, int]:
    """Upsert OHLCV, preserving existing o1/c1. Returns (written, preserved_o1c1)."""
    if not records:
        return 0, 0
    db = get_db()
    col = db.collection(COLLECTION)
    written = 0
    preserved = 0
    for r in records:
        key = f"{stock_id}_{r['date']}"
        doc = {"_key": key, "stock_id": stock_id, **r}
        try:
            existing = col.get(key)
            if existing:
                # preserve o1/c1 if present on the existing row
                if existing.get("o1") is not None:
                    doc["o1"] = existing["o1"]
                    preserved += 1
                if existing.get("c1") is not None:
                    doc["c1"] = existing["c1"]
            col.insert(doc, overwrite=True)
            written += 1
        except ArangoError:
            pass
    return written, preserved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sid", type=str, default=None)
    args = parser.parse_args()

    ensure_collection()
    import json

    universe = json.load(open(UNIVERSE_PATH))["stocks"]
    stocks = [s for s in universe if s["stock_id"] not in SKIP]
    if args.sid:
        stocks = [s for s in stocks if s["stock_id"] == args.sid]
    print(f"backfilling 10y for {len(stocks)} stocks (skip: {sorted(SKIP)})\n")

    summary = []
    for i, s in enumerate(stocks):
        sid = s["stock_id"]
        existing = get_existing_dates(sid)
        try:
            rows = fetch_10y(sid)
            new_rows = [r for r in rows if r["date"] not in existing]
            written, preserved = upsert(sid, new_rows)
            summary.append({"sid": sid, "total": len(rows), "new": written, "preserved": preserved})
            print(f"[{i+1:2d}/{len(stocks)}] {sid} {s['name']:<8} total={len(rows):>5}  new={written:>5}  o1c1_preserved={preserved:>4}")
        except Exception as e:
            summary.append({"sid": sid, "err": str(e)[:100]})
            print(f"[{i+1:2d}/{len(stocks)}] {sid} {s['name']:<8} ✗ {e}")
        time.sleep(0.5)

    ok = [s for s in summary if "err" not in s]
    fail = [s for s in summary if "err" in s]
    print(f"\n=== Summary ===")
    print(f"OK: {len(ok)} / {len(stocks)}")
    if ok:
        print(f"rows fetched: {sum(s['total'] for s in ok)}  newly written: {sum(s['new'] for s in ok)}  o1/c1 preserved: {sum(s['preserved'] for s in ok)}")
    if fail:
        print("Failed:")
        for s in fail:
            print(f"  {s['sid']}: {s['err']}")


if __name__ == "__main__":
    main()
