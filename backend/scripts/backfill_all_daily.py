"""Backfill daily history for ALL stock_codes (2010 onward).

Runs the existing backfill_daily_history_sync per stock in batches, resuming
where it left off (stocks already having data are skipped). Used to bootstrap
the screener universe — 1961 stocks, each ~4057 rows at 2010+.

Usage:
    python scripts/backfill_all_daily.py [--batch 50] [--skip-existing]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import get_db
from src.tasks.backfill_daily import backfill_daily_history_sync


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=30, help="stocks before a short sleep")
    parser.add_argument("--skip-existing", action="store_true", help="skip stocks with any daily data")
    args = parser.parse_args()

    db = get_db()
    stock_ids = [str(s) for s in db.aql.execute("FOR s IN stock_codes RETURN s.stock_id")]

    if args.skip_existing:
        have = set(
            str(s)
            for s in db.aql.execute("FOR d IN stock_daily COLLECT s = d.stock_id RETURN s")
        )
        pending = [s for s in stock_ids if s not in have]
        print(f"Total {len(stock_ids)}, skip-existing → pending {len(pending)}")
    else:
        pending = stock_ids
        print(f"Total {len(stock_ids)}")

    done = 0
    failed = 0
    start = time.time()
    for i, sid in enumerate(pending, start=1):
        try:
            r = backfill_daily_history_sync(sid)
            added = r.get("added", 0)
            print(f"[{i}/{len(pending)}] {sid}: added={added}", flush=True)
            done += 1
        except Exception as exc:
            failed += 1
            print(f"[{i}/{len(pending)}] {sid}: FAILED {exc}", flush=True)
        if i % args.batch == 0:
            el = time.time() - start
            print(f"--- progress {i}/{len(pending)} done={done} failed={failed} elapsed={el:.0f}s rate={done/el*3600:.0f}/hr ---", flush=True)
            time.sleep(2)

    print(f"=== Complete: done={done} failed={failed} ===")


if __name__ == "__main__":
    main()
