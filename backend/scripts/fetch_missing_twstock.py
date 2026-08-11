#!/usr/bin/env python3
"""
已棄用 (DEPRECATED)：本腳本寫入 stock_daily_o1c1。方案A 之後 OHLCV 統一由
stock_daily (yfinance) 提供，O1/C1 由 research_ohlcv 經 yfinance 60m 推導並寫入
stock_daily。請改用 backend/src/tasks/research_download.py。保留僅供歷史參考，勿再執行。
"""
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, "/home/daniel/github/aistock/backend/scripts")
import _dns_fix  # noqa: E402
_dns_fix.patch()

import twstock
from arango.exceptions import ArangoError

sys.path.insert(0, "/home/daniel/github/aistock/backend")
from src.db import get_db

COLLECTION = "stock_daily_o1c1"

# The 18 stocks yfinance could not resolve (from earlier verification).
# NOTE: some may be delisted / renamed; twstock will raise StockIDNotFoundError.
MISSING = [
    "5351", "6223", "3324", "3536", "3217", "6091", "6231", "6811", "8299",
    "3260", "8088", "6173", "6284", "6444", "6287", "1333", "2456", "8121",
]

START_DATE = date(2024, 8, 8)  # ~2y window, matches stock_daily_o1c1 data


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


def fetch_twstock_daily(symbol: str) -> list[dict]:
    """Return [{date, open, high, low, close, volume}] since START_DATE."""
    st = twstock.Stock(symbol)
    data = st.fetch_from(START_DATE.year, START_DATE.month)
    rows = []
    for d in data:
        dstr = d.date.strftime("%Y-%m-%d")
        if dstr < START_DATE.isoformat():
            continue
        rows.append({
            "date": dstr,
            "open": round(float(d.open), 2),
            "high": round(float(d.high), 2),
            "low": round(float(d.low), 2),
            "close": round(float(d.close), 2),
            "volume": int(d.capacity if d.capacity else 0),
        })
    return rows


def upsert(stock_id: str, records: list[dict]) -> int:
    if not records:
        return 0
    col = get_db().collection(COLLECTION)
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
    print(f"backfilling {len(MISSING)} stocks into {COLLECTION} (from {START_DATE})\n")

    summary = []
    for i, sid in enumerate(MISSING):
        existing = get_existing_dates(sid)
        try:
            daily = fetch_twstock_daily(sid)
            new_rows = [r for r in daily if r["date"] not in existing]
            written = upsert(sid, new_rows)
            summary.append({"sid": sid, "total": len(daily), "new": written, "err": None})
            print(f"[{i+1:2d}/{len(MISSING)}] {sid}  total={len(daily):>4}  new={written:>3}")
        except Exception as e:
            summary.append({"sid": sid, "total": 0, "new": 0, "err": str(e)[:100]})
            print(f"[{i+1:2d}/{len(MISSING)}] {sid}  ✗ {e}")
        time.sleep(1.5)  # twstock politeness

    ok = [s for s in summary if not s["err"]]
    fail = [s for s in summary if s["err"]]
    print(f"\n=== Summary ===")
    print(f"OK: {len(ok)} / {len(MISSING)}")
    if ok:
        print(f"rows total: {sum(s['total'] for s in ok)}  newly written: {sum(s['new'] for s in ok)}")
    if fail:
        print("Failed:")
        for s in fail:
            print(f"  {s['sid']}: {s['err']}")


if __name__ == "__main__":
    main()
