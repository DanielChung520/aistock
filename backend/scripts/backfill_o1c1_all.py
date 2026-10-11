"""Backfill O1/C1 for ALL stock_codes from yfinance 60m bars into stock_daily.

O1/C1 definition (identical to src/tasks/research_download.py, 方案A):
  - o1 = Close of the 09:00 60m bar (= 10:00 price)
  - c1 = Close of the 12:00 60m bar (= 13:00 price)
  Derivation: bar where dt.hour == 9 and dt.minute == 0 → o1;
               bar where dt.hour == 12 and dt.minute == 0 → c1.
  Days without 60m data simply get no o1/c1 (field not written, stays null).

Only EXISTING stock_daily rows are patched (col.update merge=True) — OHLCV and
any stored o1/c1 are preserved; dates the new fetch lacks are left untouched,
and no OHLCV-less documents are ever created. Re-runnable: rows are updated in
place by key {stock_id}_{date}, so re-running overwrites with fresh values and
never produces duplicates.

Suffix (.TW / .TWO) is decided via twstock.codes (stock_codes.market is None).
Market type check, see AGENTS.md guardrails (G4/G5 style) and backfill_daily.py.

Usage:
    python scripts/backfill_o1c1_all.py
    python scripts/backfill_o1c1_all.py --stock-ids 1101,2330,0050
    python scripts/backfill_o1c1_all.py --batch 30 --sleep 2
"""
from __future__ import annotations

import argparse
import contextlib
import io
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(BACKEND_ROOT))
sys.path.insert(0, str(SCRIPTS_DIR))

import _dns_fix  # noqa: E402

_dns_fix.patch()

import yfinance as yf  # noqa: E402

from src.db import get_db  # noqa: E402


def _suffix(stock_id: str) -> str:
    import twstock

    info = twstock.codes.get(stock_id)
    if info and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def _fetch_o1c1(stock_id: str) -> dict[str, dict[str, float]]:
    """Fetch O1/C1 for the last 2y via 60m bars. Returns {date: {o1?, c1?}}.

    yfinance applies split/減資 adjustments to 60m data whenever the requested
    range CROSSES a split date — even with auto_adjust=False — while the daily
    OHLCV in stock_daily is on the unadjusted scale (backfill_daily.py uses
    explicit start/end). Mixing scales corrupts o1/c1 (e.g. 6669 1:3 split →
    adjusted close 836.67 vs raw 2510; 4950 減資 2.53x → adjusted 36.99 vs raw
    14.55). To stay on the raw scale we:
      1. detect split dates via ticker.splits,
      2. split the 2y window at each split date (each segment crosses no split),
      3. cap each segment at 700 days (yfinance intraday hard limit: 729 days
         works, 730 returns empty).
    Each segment is fetched with explicit start/end + auto_adjust=False, which
    returns raw prices consistent with stock_daily.
    """
    import datetime as _dt

    ticker = yf.Ticker(f"{stock_id}{_suffix(stock_id)}")
    end_d = _dt.date.today()
    # 728 not 730: yfinance intraday history hard limit is 729 days back —
    # a start exactly 730 days ago returns empty, 729 works. Keep a margin.
    start_d = end_d - _dt.timedelta(days=728)

    # 1) detect split dates within the window
    split_dates: list[_dt.date] = []
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            splits = ticker.splits
        except Exception:
            splits = None
    if splits is not None and not splits.empty:
        for ts in splits.index:
            sd = ts.date()
            if start_d < sd < end_d:
                split_dates.append(sd)
    split_dates.sort()

    # 2) build segments bounded by split dates, capped at 700 days.
    #    A segment ENDING on the split date itself still triggers yfinance's
    #    range-crossing adjustment (verified: end=2026-06-22 → adjusted 836.67,
    #    end=2026-06-21 → raw 2510), so each pre-split segment ends the day
    #    BEFORE the split; the post-split segment starts on the split date.
    segments: list[tuple[str, str]] = []
    seg_start = start_d
    for sd in split_dates:
        segments.append((seg_start.isoformat(), (sd - _dt.timedelta(days=1)).isoformat()))
        seg_start = sd
    segments.append((seg_start.isoformat(), end_d.isoformat()))

    capped: list[tuple[str, str]] = []
    for s0, s1 in segments:
        cur = _dt.date.fromisoformat(s0)
        while (s1_date := _dt.date.fromisoformat(s1)) - cur > _dt.timedelta(days=700):
            nxt = cur + _dt.timedelta(days=700)
            capped.append((cur.isoformat(), nxt.isoformat()))
            cur = nxt
        capped.append((cur.isoformat(), s1))

    # 3) fetch each segment (no split crossed → raw prices)
    out: dict[str, dict[str, float]] = {}
    for s0, s1 in capped:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            df = ticker.history(start=s0, end=s1, interval="60m", auto_adjust=False)
        if df.empty:
            continue
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


def _upsert_o1c1(stock_id: str, o1c1: dict[str, dict[str, float]]) -> dict:
    """Patch O1/C1 onto existing stock_daily rows (merge=True). Returns stats.

    Sanity check: o1/c1 must lie within [low * 0.99, high * 1.01]. yfinance 60m
    history is sometimes inconsistent with its own daily bars for stocks that had
    splits/capital reductions (e.g. 5:1 減資 → 60m close ~5x the daily close),
    so values outside the daily range are discarded as corrupt.
    """
    from arango.exceptions import ArangoError

    db = get_db()
    col = db.collection("stock_daily")
    existing = {
        str(r["date"]): r
        for r in db.aql.execute(
            "FOR d IN stock_daily FILTER d.stock_id == @s "
            "RETURN {date: d.date, low: d.low, high: d.high}",
            bind_vars={"s": stock_id},
        )
    }
    patched = 0
    o1_count = 0
    c1_count = 0
    discarded = 0
    for dstr, oc in o1c1.items():
        row = existing.get(dstr)
        if row is None:
            continue  # only patch existing OHLCV rows; never create OHLCV-less docs
        lo, hi = row["low"], row["high"]
        updates: dict[str, float] = {}
        if "o1" in oc and lo * 0.99 <= oc["o1"] <= hi * 1.01:
            updates["o1"] = oc["o1"]
            o1_count += 1
        elif "o1" in oc:
            discarded += 1
        if "c1" in oc and lo * 0.99 <= oc["c1"] <= hi * 1.01:
            updates["c1"] = oc["c1"]
            c1_count += 1
        elif "c1" in oc:
            discarded += 1
        if not updates:
            continue
        try:
            col.update({"_key": f"{stock_id}_{dstr}", **updates}, merge=True)
            patched += 1
        except ArangoError:
            pass
    return {
        "stock_id": stock_id,
        "patched": patched,
        "o1": o1_count,
        "c1": c1_count,
        "discarded": discarded,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill O1/C1 into stock_daily for all stocks")
    parser.add_argument(
        "--stock-ids", type=str, default=None, help="comma-separated stock ids (default: all)"
    )
    parser.add_argument("--batch", type=int, default=30, help="stocks before a short sleep")
    parser.add_argument("--sleep", type=float, default=2.0, help="seconds to sleep per batch")
    args = parser.parse_args()

    db = get_db()
    if args.stock_ids:
        stock_ids = [s.strip() for s in args.stock_ids.split(",") if s.strip()]
    else:
        stock_ids = [str(s) for s in db.aql.execute("FOR s IN stock_codes RETURN s.stock_id")]
    total = len(stock_ids)
    print(f"Total {total} stocks to backfill O1/C1", flush=True)

    done = 0
    failed = 0
    failed_list: list[tuple[str, str]] = []
    total_o1 = 0
    total_c1 = 0
    start = time.time()
    for i, sid in enumerate(stock_ids, start=1):
        try:
            o1c1 = _fetch_o1c1(sid)
            stat = _upsert_o1c1(sid, o1c1)
            print(
                f"[{i}/{total}] {sid}: daily={stat['patched']} "
                f"o1={stat['o1']} c1={stat['c1']} discarded={stat['discarded']}",
                flush=True,
            )
            done += 1
            total_o1 += stat["o1"]
            total_c1 += stat["c1"]
        except Exception as exc:
            failed += 1
            failed_list.append((sid, str(exc)))
            print(f"[{i}/{total}] {sid}: FAILED {exc}", flush=True)
        if i % args.batch == 0:
            el = time.time() - start
            rate = done / el * 3600 if el > 0 else 0.0
            print(
                f"--- progress {i}/{total} done={done} failed={failed} "
                f"elapsed={el:.0f}s rate={rate:.0f}/hr ---",
                flush=True,
            )
            time.sleep(args.sleep)

    print(f"\n=== Summary ===")
    print(f"OK: {done} / {total}  failed: {failed}")
    print(f"total o1 values: {total_o1}  total c1 values: {total_c1}")
    for sid, err in failed_list:
        print(f"FAILED: {sid}: {err[:200]}")


if __name__ == "__main__":
    main()
