"""Detect scale contamination in stock_daily.

Compares EVERY DB daily close (within a 3-year window) against yfinance RAW
(auto_adjust=False) close on the SAME date, per stock.  Rows written by
fetch_daily_history (which used yfinance's adjusted-by-default history()) sit on
a dividend-adjusted scale and differ from raw closes by >0.5% — contamination
that breaks 60m o1/c1 consistency and indicator math.

A stock is flagged when any of its in-window rows mismatches raw yfinance.

NOTE: "DB latest vs yfinance latest" is WRONG when the DB is stale (missing
recent trading days) — the two are different days.  This script always compares
same-date.

Usage:
    python scripts/detect_scale_contamination.py [--output /tmp/contaminated.json]
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import twstock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.db import get_db  # noqa: E402

TOLERANCE_PCT = 0.5
WINDOW_YEARS = 3


def _suffix(stock_id: str) -> str:
    code = stock_id.split("_")[0]
    if code in twstock.codes:
        market = twstock.codes[code].market
        if market == "上櫃":
            return ".TWO"
    return ".TW"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="/tmp/contaminated.json")
    parser.add_argument("--batch", type=int, default=50, help="yfinance batch size")
    args = parser.parse_args()

    import yfinance as yf

    db = get_db()

    cutoff = (date.today() - timedelta(days=WINDOW_YEARS * 365)).isoformat()
    # All in-window dates per stock, in ascending order.
    dates_by_stock: dict[str, list[str]] = {}
    cursor = db.aql.execute(
        """
        FOR d IN stock_daily
          FILTER d.date >= @cutoff
          COLLECT stock_id = d.stock_id INTO dates = d.date
          RETURN { stock_id, dates }
        """,
        bind_vars={"cutoff": cutoff},
    )
    for row in cursor:
        dates_by_stock[row["stock_id"]] = row["dates"]
    print(
        f"[detect] {len(dates_by_stock)} stocks with data since {cutoff}",
        flush=True,
    )

    today = date.today()
    start_d = (today - timedelta(days=WINDOW_YEARS * 365 + 30)).isoformat()
    end_d = (today + timedelta(days=1)).isoformat()

    contaminated: list[dict] = []
    checked = 0
    skipped = 0
    stocks = sorted(dates_by_stock.keys())

    for i in range(0, len(stocks), args.batch):
        batch = stocks[i : i + args.batch]

        # Load DB closes for this batch's stocks in-window (one query).
        db_close: dict[str, dict[str, float]] = {}
        cur = db.aql.execute(
            """
            FOR d IN stock_daily
              FILTER d.stock_id IN @ids AND d.date >= @cutoff
              RETURN { stock_id: d.stock_id, date: d.date, close: d.close }
            """,
            bind_vars={"ids": batch, "cutoff": cutoff},
        )
        for r in cur:
            db_close.setdefault(r["stock_id"], {})[r["date"]] = float(r["close"])

        tickers = " ".join(f"{sid}{_suffix(sid)}" for sid in batch)
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
                io.StringIO()
            ):
                data = yf.download(
                    tickers=tickers,
                    start=start_d,
                    end=end_d,
                    interval="1d",
                    auto_adjust=False,
                    progress=False,
                    group_by="ticker",
                    threads=True,
                )
        except Exception as exc:  # noqa: BLE001 - network flake, report and continue
            print(f"[detect] batch {i//args.batch} failed: {exc}", flush=True)
            time.sleep(2)
            continue

        for sid in batch:
            full = sid + _suffix(sid)
            checked += 1
            try:
                df = data[full]
            except KeyError:
                skipped += 1
                continue
            if df is None or df.empty:
                skipped += 1
                continue
            yf_close_by_date: dict[str, float] = {}
            for dt, row in df.iterrows():
                c = float(row["Close"])
                if c == c:
                    yf_close_by_date[str(dt.date())] = c

            db_map = db_close.get(sid, {})
            mismatches: list[dict] = []
            compared = 0
            for d, db_c in db_map.items():
                yf_c = yf_close_by_date.get(d)
                if yf_c is None:
                    continue
                compared += 1
                diff_pct = abs(db_c - yf_c) / yf_c * 100
                if diff_pct > TOLERANCE_PCT:
                    mismatches.append(
                        {
                            "db_date": d,
                            "db_close": db_c,
                            "yf_raw_close": yf_c,
                            "diff_pct": round(diff_pct, 2),
                        }
                    )

            if mismatches:
                contaminated.append(
                    {
                        "stock_id": sid,
                        "compared": compared,
                        "mismatch_count": len(mismatches),
                        "mismatch_ratio": round(len(mismatches) / compared, 3)
                        if compared
                        else 0,
                        "samples": mismatches[:5],
                    }
                )

        if (i // args.batch) % 4 == 0:
            print(
                f"[detect] {checked}/{len(stocks)} checked, "
                f"{len(contaminated)} contaminated, {skipped} skipped",
                flush=True,
            )

    Path(args.output).write_text(
        json.dumps(contaminated, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"[detect] DONE: {len(contaminated)} contaminated / {checked} checked, "
        f"skipped {skipped} -> {args.output}",
        flush=True,
    )


if __name__ == "__main__":
    main()