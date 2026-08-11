#!/usr/bin/env python3
"""
已棄用 (DEPRECATED)：本腳本寫入 stock_daily_o1c1。方案A 之後 OHLCV 統一由
stock_daily (yfinance) 提供，O1/C1 由 research_ohlcv 經 yfinance 60m 推導並寫入
stock_daily。請改用 backend/src/tasks/research_download.py。保留僅供歷史參考，勿再執行。
"""
import sys
import time
from datetime import date, timedelta
from pathlib import Path
import re

sys.path.insert(0, "/home/daniel/github/aistock/backend/scripts")
import _dns_fix  # noqa: E402
_dns_fix.patch()

import httpx
from arango.exceptions import ArangoError

sys.path.insert(0, "/home/daniel/github/aistock/backend")
from src.db import get_db

COLLECTION = "stock_daily_o1c1"
API = "https://api.finmindtrade.com/api/v4/data"
ENV_PATH = Path("/home/daniel/github/aistock/backend/.env")
START_DATE = date(2024, 8, 8)  # ~2y window, matches stock_daily_o1c1 data

# The 18 stocks yfinance could not resolve (from earlier verification).
MISSING = [
    "5351", "6223", "3324", "3536", "3217", "6091", "6231", "6811", "8299",
    "3260", "8088", "6173", "6284", "6444", "6287", "1333", "2456", "8121",
]


def load_token() -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("FINMIND_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("FINMIND_TOKEN not found in backend/.env")


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


def fetch_finmind_daily(token: str, symbol: str) -> list[dict]:
    """Return [{date, open, high, low, close, volume}] since START_DATE via FinMind."""
    r = httpx.get(
        API,
        params={
            "dataset": "TaiwanStockPrice",
            "data_id": symbol,
            "start_date": START_DATE.isoformat(),
            "end_date": date.today().isoformat(),
            "token": token,
        },
        timeout=30,
    )
    j = r.json()
    if j.get("msg") != "success":
        raise RuntimeError(f"{symbol}: {j.get('msg', r.status_code)}")
    rows = []
    for row in j.get("data") or []:
        try:
            rows.append({
                "date": str(row["date"])[:10],
                "open": round(float(row["open"]), 2),
                "high": round(float(row["max"]), 2),
                "low": round(float(row["min"]), 2),
                "close": round(float(row["close"]), 2),
                "volume": int(row["Trading_Volume"]),
            })
        except (KeyError, ValueError, TypeError):
            continue
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
    token = load_token()
    print(f"backfilling {len(MISSING)} stocks into {COLLECTION} via FinMind (from {START_DATE})\n")

    summary = []
    for i, sid in enumerate(MISSING):
        existing = get_existing_dates(sid)
        try:
            daily = fetch_finmind_daily(token, sid)
            new_rows = [r for r in daily if r["date"] not in existing]
            written = upsert(sid, new_rows)
            summary.append({"sid": sid, "total": len(daily), "new": written, "err": None})
            print(f"[{i+1:2d}/{len(MISSING)}] {sid}  total={len(daily):>4}  new={written:>3}")
        except Exception as e:
            summary.append({"sid": sid, "total": 0, "new": 0, "err": str(e)[:100]})
            print(f"[{i+1:2d}/{len(MISSING)}] {sid}  ✗ {e}")
        time.sleep(0.8)  # FinMind politeness

    ok = [s for s in summary if not s["err"]]
    fail = [s for s in summary if s["err"]]
    empty = [s for s in ok if s["total"] == 0]
    print(f"\n=== Summary ===")
    print(f"OK: {len(ok)} / {len(MISSING)}")
    if ok:
        print(f"rows total: {sum(s['total'] for s in ok)}  newly written: {sum(s['new'] for s in ok)}")
    if empty:
        print(f"OK but 0 rows (likely delisted/renamed): {[s['sid'] for s in empty]}")
    if fail:
        print("Failed:")
        for s in fail:
            print(f"  {s['sid']}: {s['err']}")


if __name__ == "__main__":
    main()
