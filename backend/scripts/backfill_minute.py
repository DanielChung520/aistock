"""yfinance minute K backfill — all intervals, all stocks, batch download, nohup-ready.

Storage: minute/{interval}/stock_id=XXXX/data.parquet
Intervals downloaded: 1m (7d max), 2m, 5m, 15m, 30m, 60m (all 1mo)
10m is aggregated from 5m at query time — not stored separately.

Usage:
  # All stocks, all intervals
  nohup python scripts/backfill_minute.py > logs/backfill_minute.log 2>&1 &

  # Single stock
  python scripts/backfill_minute.py --stock-id 2330

  # Specific intervals only
  python scripts/backfill_minute.py --intervals 5m,15m,60m

  # Custom batch size
  python scripts/backfill_minute.py --batch-size 5
"""

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Any

import twstock
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import get_db
from src.parquet_writer import write_stock_minute_interval

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("backfill_minute")

# yfinance interval → (period to request, max days available)
INTERVAL_CONFIG: dict[str, tuple[str, int]] = {
    "1m":  ("7d",  7),
    "2m":  ("1mo", 60),
    "5m":  ("1mo", 60),
    "15m": ("1mo", 60),
    "30m": ("1mo", 60),
    "60m": ("1mo", 60),
}

ALL_INTERVALS = list(INTERVAL_CONFIG.keys())


def _get_yf_suffix(stock_id: str) -> str:
    info = twstock.codes.get(stock_id)
    if info and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def _get_stock_ids(stock_id: str | None, limit: int | None) -> list[str]:
    if stock_id:
        return [stock_id]
    db = get_db()
    cursor = db.aql.execute("FOR s IN stock_codes SORT s.stock_id ASC RETURN s.stock_id")
    stock_ids = [str(item) for item in cursor if item]
    if limit is not None:
        return stock_ids[:limit]
    return stock_ids


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN check
        return None
    return round(v, 2)


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _download_batch_interval(
    stock_ids: list[str], interval: str
) -> dict[str, list[dict[str, Any]]]:
    """Download minute data for a batch of stocks at a specific interval."""
    period = INTERVAL_CONFIG[interval][0]
    tickers = {sid: f"{sid}{_get_yf_suffix(sid)}" for sid in stock_ids}
    ticker_str = " ".join(tickers.values())
    ticker_to_id = {v: k for k, v in tickers.items()}

    try:
        data = yf.download(
            ticker_str,
            period=period,
            interval=interval,
            auto_adjust=False,
            progress=False,
            threads=True,
        )
    except Exception as exc:
        logger.error("yfinance download failed [%s]: %s", interval, exc)
        return {}

    if data.empty:
        return {}

    results: dict[str, list[dict[str, Any]]] = {}
    import pandas as pd

    for ticker, sid in ticker_to_id.items():
        try:
            if isinstance(data.columns, pd.MultiIndex):
                stock_df = data.xs(ticker, level="Ticker", axis=1)
            else:
                stock_df = data

            records = _dataframe_to_minute_records(stock_df)
            if records:
                results[sid] = records
        except (KeyError, ValueError):
            continue

    return results


def _dataframe_to_minute_records(df: Any) -> list[dict[str, Any]]:
    """Convert yfinance DataFrame to minute K records."""
    records: list[dict[str, Any]] = []

    for timestamp, row in df.iterrows():
        ts = timestamp
        if getattr(ts, "tzinfo", None) is not None:
            ts = ts.tz_localize(None)

        close_val = _safe_float(row.get("Close"))
        if close_val is None or close_val == 0:
            continue

        records.append({
            "datetime": ts.strftime("%Y-%m-%d %H:%M:%S"),
            "open": _safe_float(row.get("Open")) or 0.0,
            "high": _safe_float(row.get("High")) or 0.0,
            "low": _safe_float(row.get("Low")) or 0.0,
            "close": close_val,
            "volume": _safe_int(row.get("Volume")) or 0,
        })

    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill minute K data via yfinance")
    parser.add_argument("--stock-id", type=str, default=None, help="Single stock to backfill")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of stocks")
    parser.add_argument("--batch-size", type=int, default=10, help="Stocks per yfinance batch")
    parser.add_argument(
        "--intervals", type=str, default=",".join(ALL_INTERVALS),
        help="Comma-separated intervals to download (default: all)",
    )
    args = parser.parse_args()

    intervals = [i.strip() for i in args.intervals.split(",") if i.strip() in INTERVAL_CONFIG]
    if not intervals:
        logger.error("No valid intervals specified. Valid: %s", ALL_INTERVALS)
        return

    logger.info("=== yfinance Minute K Backfill ===")
    logger.info("Intervals: %s, batch_size=%d", intervals, args.batch_size)

    all_ids = _get_stock_ids(args.stock_id, args.limit)
    logger.info("Total stocks in scope: %d", len(all_ids))

    if not all_ids:
        logger.info("No stocks found.")
        return

    total = len(all_ids)
    start_time = time.time()

    for interval in intervals:
        logger.info("--- Starting interval: %s (period=%s) ---", interval, INTERVAL_CONFIG[interval][0])
        done = 0
        failed = 0

        for batch_start in range(0, total, args.batch_size):
            batch = all_ids[batch_start: batch_start + args.batch_size]
            batch_num = batch_start // args.batch_size + 1
            total_batches = (total + args.batch_size - 1) // args.batch_size
            logger.info("[%s] Batch %d/%d: %s", interval, batch_num, total_batches, ", ".join(batch))

            batch_results = _download_batch_interval(batch, interval)

            for sid in batch:
                records = batch_results.get(sid, [])
                if records:
                    try:
                        write_stock_minute_interval(sid, interval, records)
                        done += 1
                        logger.info("  ✓ %s/%s: %d rows", sid, interval, len(records))
                    except Exception as exc:
                        failed += 1
                        logger.error("  ✗ %s/%s: write failed: %s", sid, interval, exc)
                else:
                    failed += 1
                    logger.warning("  ✗ %s/%s: no data", sid, interval)

            elapsed = time.time() - start_time
            rate = done / elapsed * 3600 if elapsed > 0 else 0
            logger.info("[%s Progress] done=%d, failed=%d, remaining=%d, rate=%.0f/hr",
                        interval, done, failed, total - done - failed, rate)

            time.sleep(1)

        logger.info("--- %s complete: %d success, %d failed ---", interval, done, failed)

    elapsed = time.time() - start_time
    logger.info("=== Minute K Backfill Complete === Total time: %.0fs (%.1f min)", elapsed, elapsed / 60)


if __name__ == "__main__":
    main()
