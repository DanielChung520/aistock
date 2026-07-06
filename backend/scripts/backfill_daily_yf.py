"""yfinance daily K backfill (2010-2025). Resume-safe, batch download, .TW/.TWO aware."""

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
from src.duckdb_client import query_stock_daily
from src.parquet_writer import stock_parquet_exists, write_stock_daily

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("backfill_daily_yf")


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


def _filter_existing(stock_ids: list[str]) -> list[str]:
    pending: list[str] = []
    for sid in stock_ids:
        if stock_parquet_exists(sid, "daily"):
            logger.info("  %s already exists, skipping", sid)
        else:
            pending.append(sid)
    return pending


def _download_batch(stock_ids: list[str], start: str, end: str) -> dict[str, list[dict[str, Any]]]:
    tickers = {sid: f"{sid}{_get_yf_suffix(sid)}" for sid in stock_ids}
    ticker_str = " ".join(tickers.values())
    ticker_to_id = {v: k for k, v in tickers.items()}

    try:
        data = yf.download(
            ticker_str,
            start=start,
            end=end,
            auto_adjust=False,
            progress=False,
            threads=True,
        )
    except Exception as exc:
        logger.error("yfinance download failed for batch: %s", exc)
        return {}

    if data.empty:
        return {}

    results: dict[str, list[dict[str, Any]]] = {}

    for ticker, sid in ticker_to_id.items():
        try:
            if isinstance(data.columns, __import__("pandas").MultiIndex):
                stock_df = data.xs(ticker, level="Ticker", axis=1)
            else:
                stock_df = data
            records = _dataframe_to_records(stock_df, sid)
            if records:
                results[sid] = records
        except (KeyError, ValueError):
            logger.warning("  %s (%s) no data in batch result", sid, ticker)
            continue

    return results


def _dataframe_to_records(
    df: Any, stock_id: str
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    prev_close: float | None = None

    for timestamp, row in df.iterrows():
        ts = timestamp
        if getattr(ts, "tzinfo", None) is not None:
            ts = ts.tz_localize(None)

        close_val = _safe_float(row.get("Close"))
        open_val = _safe_float(row.get("Open"))
        high_val = _safe_float(row.get("High"))
        low_val = _safe_float(row.get("Low"))
        volume_val = _safe_int(row.get("Volume"))

        if close_val is None or close_val == 0:
            continue

        change = 0.0
        if prev_close is not None and prev_close != 0:
            change = round(close_val - prev_close, 2)
        prev_close = close_val

        records.append({
            "date": ts.strftime("%Y-%m-%d"),
            "open": round(open_val, 2) if open_val else 0.0,
            "high": round(high_val, 2) if high_val else 0.0,
            "low": round(low_val, 2) if low_val else 0.0,
            "close": round(close_val, 2),
            "volume": volume_val or 0,
            "turnover": 0,
            "change": change,
            "transaction": 0,
        })

    return records


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v:
        return None
    return v


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    return v


def _merge_records(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in existing:
        d = row.get("date")
        if isinstance(d, str) and d:
            merged[d] = row
    for row in incoming:
        d = row.get("date")
        if isinstance(d, str) and d:
            merged[d] = row
    return [merged[k] for k in sorted(merged)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill daily K data via yfinance")
    parser.add_argument("--stock-id", type=str, default=None, help="Single stock to backfill")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of stocks")
    parser.add_argument("--batch-size", type=int, default=10, help="Stocks per yfinance batch")
    parser.add_argument("--start", type=str, default="2010-01-01", help="Start date")
    parser.add_argument("--end", type=str, default="2026-01-01", help="End date (exclusive)")
    parser.add_argument("--append", action="store_true", help="Append to existing data instead of skipping")
    args = parser.parse_args()

    logger.info("=== yfinance Daily K Backfill ===")
    logger.info("Range: %s ~ %s, batch_size=%d", args.start, args.end, args.batch_size)

    all_ids = _get_stock_ids(args.stock_id, args.limit)
    logger.info("Total stocks in scope: %d", len(all_ids))

    if args.append:
        pending_ids = all_ids
        logger.info("Append mode: will merge new data into all %d stocks", len(pending_ids))
    else:
        pending_ids = _filter_existing(all_ids)
        logger.info("Stocks to download: %d (skipped %d existing)", len(pending_ids), len(all_ids) - len(pending_ids))

    if not pending_ids:
        logger.info("Nothing to do — all stocks already backfilled!")
        return

    done = 0
    failed = 0
    total = len(pending_ids)
    start_time = time.time()

    for batch_start in range(0, total, args.batch_size):
        batch = pending_ids[batch_start: batch_start + args.batch_size]
        batch_num = batch_start // args.batch_size + 1
        total_batches = (total + args.batch_size - 1) // args.batch_size
        logger.info("[Batch %d/%d] Downloading %d stocks: %s", batch_num, total_batches, len(batch), ", ".join(batch))

        batch_results = _download_batch(batch, args.start, args.end)

        for sid in batch:
            records = batch_results.get(sid, [])
            if records:
                try:
                    if args.append:
                        existing = query_stock_daily(sid, "1900-01-01")
                        records = _merge_records(existing, records)
                    write_stock_daily(sid, records)
                    done += 1
                    logger.info("  ✓ %s: %d rows written", sid, len(records))
                except Exception as exc:
                    failed += 1
                    logger.error("  ✗ %s: write failed: %s", sid, exc)
            else:
                failed += 1
                logger.warning("  ✗ %s: no data returned by yfinance", sid)

        elapsed = time.time() - start_time
        rate = done / elapsed * 3600 if elapsed > 0 else 0
        logger.info("[Progress] done=%d, failed=%d, remaining=%d, elapsed=%.0fs, rate=%.0f stocks/hr",
                    done, failed, total - done - failed, elapsed, rate)

        time.sleep(1)

    elapsed = time.time() - start_time
    logger.info("=== Backfill Complete ===")
    logger.info("Total: %d, Success: %d, Failed: %d, Time: %.0fs (%.1f min)",
                total, done, failed, elapsed, elapsed / 60)


if __name__ == "__main__":
    main()
