"""Repair scale contamination in stock_daily.

Rows written by fetch_daily_history (before data_fetcher.py:148 was fixed to pass
auto_adjust=False) sit on yfinance's dividend-adjusted scale (auto_adjust=True
default) and mix into an otherwise raw-scale collection — breaking 60m o1/c1
consistency and indicator math.  This script re-fetches the FULL history with
auto_adjust=False (raw, actual traded prices) and overwrites the OHLCV via
_store_daily (which preserves existing o1/c1 fields).

After repair, re-run backfill_o1c1_all.py for the same stocks so the values that
were discarded by the sanity check (raw o1/c1 vs adjusted daily range) get
populated.

Usage:
    python scripts/repair_scale_contamination.py [--stock-ids 2330,0050] [--sleep 1]
    python scripts/repair_scale_contamination.py --from-file /tmp/contaminated_ids.json
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.data_fetcher import _store_daily  # noqa: E402
from src.db import get_db  # noqa: E402

BACKFILL_START = "2010-01-01"
BACKFILL_END = "2030-01-01"


def _suffix(stock_id: str) -> str:
    import twstock

    code = stock_id.split("_")[0]
    info = twstock.codes.get(code)
    if info and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def _fetch_daily_raw(symbol: str, start: str, end: str) -> list[dict]:
    import yfinance as yf

    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        ticker = yf.Ticker(f"{symbol}{_suffix(symbol)}")
        hist = ticker.history(start=start, end=end, auto_adjust=False)
    records: list[dict] = []
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-ids", type=str, default=None, help="comma-separated stock ids")
    parser.add_argument("--from-file", type=str, default=None, help="JSON file with stock id list")
    parser.add_argument("--sleep", type=float, default=1.0, help="seconds between stocks")
    parser.add_argument("--start", default=BACKFILL_START, help="fetch start date")
    args = parser.parse_args()

    if args.stock_ids:
        stock_ids = [s.strip() for s in args.stock_ids.split(",") if s.strip()]
    elif args.from_file:
        stock_ids = json.loads(Path(args.from_file).read_text(encoding="utf-8"))
    else:
        db = get_db()
        stock_ids = [str(s) for s in db.aql.execute("FOR s IN stock_codes RETURN s.stock_id")]
    print(f"[repair] {len(stock_ids)} stocks to repair", flush=True)

    ok = 0
    failed: list[str] = []
    total_rows = 0
    for i, sid in enumerate(stock_ids):
        try:
            records = _fetch_daily_raw(sid, args.start, BACKFILL_END)
            if not records:
                print(f"[repair] {sid}: no data fetched (skipped)", flush=True)
                continue
            _store_daily(sid, records)
            total_rows += len(records)
            ok += 1
            if (i + 1) % 10 == 0:
                print(
                    f"[repair] {i + 1}/{len(stock_ids)} done, {ok} ok, {total_rows} rows",
                    flush=True,
                )
        except Exception as exc:  # noqa: BLE001 - per-stock failure isolation
            failed.append(sid)
            print(f"[repair] {sid} FAILED: {exc}", flush=True)
        time.sleep(args.sleep)

    print(
        f"[repair] DONE: {ok}/{len(stock_ids)} ok, {total_rows} rows overwritten, "
        f"{len(failed)} failed: {failed}",
        flush=True,
    )


if __name__ == "__main__":
    main()