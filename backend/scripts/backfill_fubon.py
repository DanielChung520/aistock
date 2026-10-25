"""Backfill OHLCV bars from the Fubon API into ArangoDB.

Resumable: each symbol only fetches dates after its newest stored bar, so a
rerun after a partial failure continues where it stopped.

Usage:
  python scripts/backfill_fubon.py                      # all 4-digit codes, daily, 2010 ->
  python scripts/backfill_fubon.py --symbols 2330,2317
  python scripts/backfill_fubon.py --timeframe 15 --days 30
  python scripts/backfill_fubon.py --limit 50
"""

import argparse
import logging
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_fubon")

BACKFILL_START = "2010-01-01"

_TARGETS = {
    "D": ("stock_daily", "date"),
    "15": ("stock_minute_15m", "datetime"),
    "1": ("stock_minute_1m", "datetime"),
}


def _universe(limit: int | None) -> list[str]:
    from src.db import get_db

    aql = """
    FOR c IN stock_codes
      FILTER c.stock_id =~ '^[0-9]{4}$'
      SORT c.stock_id ASC
      RETURN c.stock_id
    """
    ids = [str(x) for x in get_db().aql.execute(aql)]
    return ids[:limit] if limit else ids


def _latest_stored(symbol: str, collection: str, field: str) -> str | None:
    from src.db import get_db

    aql = f"""
    FOR d IN {collection}
      FILTER d.stock_id == @s
      COLLECT AGGREGATE m = MAX(d.{field})
      RETURN m
    """
    rows = list(get_db().aql.execute(aql, bind_vars={"s": symbol}))
    return rows[0] if rows and rows[0] else None


def _upsert(symbol: str, observation_field: str, rows: list[dict], collection: str) -> int:
    from arango.exceptions import ArangoError

    from src.db import get_db

    col = get_db().collection(collection)
    written = 0
    for row in rows:
        if observation_field == "date":
            key = f"{symbol}_{row['date']}"
        else:
            key = f"{symbol}_{row['date'].replace(' ', '_').replace(':', '')}"
        doc = {"_key": key, "stock_id": symbol, observation_field: row["date"], **{
            k: row[k] for k in ("open", "high", "low", "close", "volume")
        }}
        try:
            col.insert(doc, overwrite=True, overwrite_mode="update")
            written += 1
        except ArangoError:
            pass
    return written


def _next_start(symbol: str, timeframe: str, collection: str, field: str, days: int) -> str:
    latest = _latest_stored(symbol, collection, field)
    if latest:
        stored = date.fromisoformat(str(latest)[:10])
        return (stored + timedelta(days=1)).isoformat()
    if timeframe == "D":
        return BACKFILL_START
    return (date.today() - timedelta(days=days)).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill bars from Fubon into ArangoDB")
    parser.add_argument("--symbols", help="comma-separated stock ids (default: all 4-digit codes)")
    parser.add_argument("--timeframe", default="D", choices=sorted(_TARGETS), help="D / 15 / 1")
    parser.add_argument("--days", type=int, default=60, help="lookback for minute timeframes")
    parser.add_argument("--limit", type=int, help="cap number of symbols (for testing)")
    parser.add_argument("--full", action="store_true", help="re-fetch from 2010 for daily, overwriting stored rows")
    parser.add_argument("--start-after", help="resume: skip symbols <= this id")
    args = parser.parse_args()

    from src import fubon_market
    from src.db import ensure_collection

    collection, field = _TARGETS[args.timeframe]
    ensure_collection(collection)

    symbols = (
        [s.strip() for s in args.symbols.split(",") if s.strip()]
        if args.symbols
        else _universe(args.limit)
    )
    if args.start_after:
        symbols = [s for s in symbols if s > args.start_after]
    today = date.today().isoformat()

    logger.info("backfill start: tf=%s target=%s symbols=%d", args.timeframe, collection, len(symbols))
    total_written = 0
    failures = 0
    consecutive = 0
    for i, symbol in enumerate(symbols, 1):
        try:
            start = (
                BACKFILL_START
                if args.full and args.timeframe == "D"
                else _next_start(symbol, args.timeframe, collection, field, args.days)
            )
            if start > today:
                continue
            rows = fubon_market.fetch_candles(symbol, args.timeframe, start, today)
            written = _upsert(symbol, field, rows, collection) if rows else 0
            total_written += written
            if i % 50 == 0 or written:
                logger.info("[%d/%d] %s +%d (from %s)", i, len(symbols), symbol, written, start)
        except Exception as exc:  # noqa: BLE001 - one bad symbol must not abort a 12h run
            failures += 1
            consecutive += 1
            logger.warning("[%d/%d] %s failed: %s", i, len(symbols), symbol, exc)
            if consecutive >= 20:
                logger.error("aborting after 20 consecutive failures")
                break
        else:
            consecutive = 0

    logger.info("backfill done: symbols=%d written=%d failures=%d", len(symbols), total_written, failures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
