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

import yfinance as yf

sys.path.insert(0, "/home/daniel/github/aistock/backend")
from src.db import get_db

COLLECTION = "stock_daily_o1c1"

# 12 TPEx stocks (6287 excluded — no Yahoo data at all)
TPEX_STOCKS = [
    "5351", "6223", "3324", "3217", "6231", "6811",
    "8299", "3260", "8088", "6173", "6284", "8121",
]


def fetch_o1c1(symbol: str) -> dict[str, dict]:
    """Return {date: {"o1": ..., "c1": ...}} from .TWO 60m data."""
    df = yf.Ticker(f"{symbol}.TWO").history(
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


def update_o1c1(stock_id: str, o1c1: dict[str, dict]) -> tuple[int, int]:
    """Patch o1/c1 onto existing rows. Returns (rows_patched, rows_with_o1)."""
    if not o1c1:
        return 0, 0
    db = get_db()
    col = db.collection(COLLECTION)
    patched = 0
    o1_count = 0
    for dstr, oc in o1c1.items():
        key = f"{stock_id}_{dstr}"
        if not col.has(key):
            continue  # only patch rows that exist (FinMind daily backfill)
        updates = {}
        if "o1" in oc:
            updates["o1"] = oc["o1"]
            o1_count += 1
        if "c1" in oc:
            updates["c1"] = oc["c1"]
        if updates:
            col.update({"_key": key, **updates})
            patched += 1
    return patched, o1_count


def main() -> None:
    print(f"backfilling O1/C1 for {len(TPEX_STOCKS)} TPEx stocks via .TWO 60m\n")
    summary = []
    for i, sid in enumerate(TPEX_STOCKS):
        try:
            o1c1 = fetch_o1c1(sid)
            patched, o1_count = update_o1c1(sid, o1c1)
            summary.append({"sid": sid, "days": len(o1c1), "patched": patched, "o1": o1_count, "err": None})
            print(f"[{i+1:2d}/{len(TPEX_STOCKS)}] {sid}  days={len(o1c1):>4}  patched={patched:>4}  o1={o1_count:>4}")
        except Exception as e:
            summary.append({"sid": sid, "days": 0, "patched": 0, "o1": 0, "err": str(e)[:100]})
            print(f"[{i+1:2d}/{len(TPEX_STOCKS)}] {sid}  ✗ {e}")
        time.sleep(0.5)

    ok = [s for s in summary if not s["err"]]
    print(f"\n=== Summary ===")
    print(f"OK: {len(ok)} / {len(TPEX_STOCKS)}")
    if ok:
        print(f"days fetched: {sum(s['days'] for s in ok)}  rows patched: {sum(s['patched'] for s in ok)}  o1 values: {sum(s['o1'] for s in ok)}")
    for s in summary:
        if s["err"]:
            print(f"FAILED: {s['sid']}: {s['err']}")


if __name__ == "__main__":
    main()
