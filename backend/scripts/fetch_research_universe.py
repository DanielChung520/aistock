#!/usr/bin/env python3
"""
已棄用 (DEPRECATED)：本腳本寫入 stock_daily_o1c1。方案A 之後 OHLCV 統一由
stock_daily (yfinance) 提供，O1/C1 由 research_ohlcv 經 yfinance 60m 推導並寫入
stock_daily。請改用 backend/src/tasks/research_download.py。保留僅供歷史參考，勿再執行。
"""
import json
import sys
import time
from datetime import date, timedelta

import yfinance as yf
from arango.exceptions import ArangoError

sys.path.insert(0, '/home/daniel/github/aistock/backend')
from src.db import get_db

UNIVERSE_PATH = "/home/daniel/github/aistock/frontend/src/lib/data/research-universe-ai-memory-passive.json"
COLLECTION = "stock_daily_o1c1"


def _twse(symbol: str) -> str:
    return f"{symbol}.TW"


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
    cursor = db.aql.execute(aql, bind_vars={"sid": stock_id})
    return {row for row in cursor}


def fetch_daily(symbol: str, days: int = 730) -> list[dict]:
    end = date.today()
    start = end - timedelta(days=days)
    df = yf.Ticker(_twse(symbol)).history(
        start=start.isoformat(), end=end.isoformat(), auto_adjust=False
    )
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


def fetch_o1c1(symbol: str, days: int = 730) -> dict[str, dict]:
    """Return {date: {"o1": ..., "c1": ...}}.

    O1 = Close of the 09:00 bar (price at 10:00, Taiwan time)
    C1 = Close of the 12:00 bar (price at 13:00, Taiwan time — nearest hour to 12:30)

    yfinance 60m for .TW returns Asia/Taipei tz-aware timestamps with 5 bars/day
    (09/10/11/12/13). We read hour/minute directly; no conversion.

    NOTE: yfinance's "last 730 days" 1h window is INCLUSIVE of today; using
    start/end with a 730-day-old start lands on the exclusive boundary and
    returns empty data. `period="2y"` reliably maps to the rolling 730d window.
    """
    df = yf.Ticker(_twse(symbol)).history(
        period="2y", interval="60m", auto_adjust=False
    )
    if df.empty:
        return {}
    out: dict[str, dict] = {}
    for dt, r in df.iterrows():
        try:
            h, m = dt.hour, dt.minute
            c = float(r["Close"])
            if c != c:
                continue
            dstr = dt.strftime("%Y-%m-%d")
            if h == 9 and m == 0:
                out.setdefault(dstr, {})["o1"] = round(c, 2)
            elif h == 12 and m == 0:
                out.setdefault(dstr, {})["c1"] = round(c, 2)
        except Exception:
            continue
    return out


def upsert(stock_id: str, records: list[dict]) -> int:
    if not records:
        return 0
    db = get_db()
    col = db.collection(COLLECTION)
    written = 0
    for r in records:
        key = f"{stock_id}_{r['date']}"
        try:
            col.insert({"_key": key, "stock_id": stock_id, **r}, overwrite=True)
            written += 1
        except ArangoError:
            pass
    return written


def main() -> None:
    ensure_collection()
    universe = json.load(open(UNIVERSE_PATH))["stocks"]
    print(f"universe size: {len(universe)} stocks\n")

    summary = []
    for i, s in enumerate(universe):
        sid, name = s["stock_id"], s["name"]
        existing = get_existing_dates(sid)
        try:
            daily = fetch_daily(sid, days=730)
            o1c1 = fetch_o1c1(sid, days=730)
            for r in daily:
                oc = o1c1.get(r["date"], {})
                r["o1"] = oc.get("o1")
                r["c1"] = oc.get("c1")
            written = upsert(sid, daily)
            o1_n = sum(1 for r in daily if r.get("o1") is not None)
            c1_n = sum(1 for r in daily if r.get("c1") is not None)
            summary.append({"sid": sid, "name": name, "daily": len(daily), "o1": o1_n, "c1": c1_n, "new": written})
            print(f"[{i+1:2d}/{len(universe)}] {sid} {name:<8} daily={len(daily):>4}  o1={o1_n:>4}  c1={c1_n:>4}  new={written:>3}")
        except Exception as e:
            summary.append({"sid": sid, "name": name, "error": str(e)})
            print(f"[{i+1:2d}/{len(universe)}] {sid} {name:<8} ✗ {e}")
        time.sleep(0.6)  # rate limit politeness

    ok = [s for s in summary if "error" not in s]
    fail = [s for s in summary if "error" in s]
    print(f"\n=== Summary ===")
    print(f"OK: {len(ok)} / {len(summary)}")
    if fail:
        print("Failed:")
        for s in fail:
            print(f"  {s['sid']} {s['name']}: {s['error']}")
    if ok:
        total_daily = sum(s["daily"] for s in ok)
        total_o1 = sum(s["o1"] for s in ok)
        total_c1 = sum(s["c1"] for s in ok)
        total_new = sum(s["new"] for s in ok)
        print(f"daily rows: {total_daily}  o1 rows: {total_o1}  c1 rows: {total_c1}  newly written: {total_new}")


if __name__ == "__main__":
    main()