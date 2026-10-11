"""Download 15m bars from yfinance into ArangoDB stock_minute_15m (batch, resumable).

Usage:
  # All stocks (~1,945)
  python scripts/download_15m.py

  # Specific stocks
  python scripts/download_15m.py --symbols 2330,2317,2412

  # Throttled / custom range (max 60 days — yfinance 15m hard limit)
  python scripts/download_15m.py --batch-size 10 --sleep 2 --days 60

Freshness: stocks whose latest 15m bar is already recent are skipped, so the
script can be rerun after a partial failure without redownloading everything.
"""

import argparse
import logging
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import twstock
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.data_fetcher import YF_15M_MAX_DAYS, _ensure_collections, store_minute_15m
from src.db import get_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("download_15m")


def _yf_suffix(stock_id: str) -> str:
    info = twstock.codes.get(stock_id)
    if info is not None and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def _get_stock_ids(symbols: str | None) -> list[str]:
    if symbols:
        return [s.strip() for s in symbols.split(",") if s.strip()]
    db = get_db()
    cursor = db.aql.execute("FOR s IN stock_codes SORT s.stock_id ASC RETURN s.stock_id")
    return [str(x) for x in cursor]


def _is_fresh(last: str, now: datetime) -> bool:
    if last >= (now - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S"):
        return True
    market_closed = now >= now.replace(hour=14, minute=30, second=0, microsecond=0)
    if not market_closed or last[:10] != now.strftime("%Y-%m-%d"):
        return False
    # 收盤後只有當日最後一根 15m（13:15）才算新鮮，早盤 partial bar 仍需補抓
    return last[11:16] >= "13:15"


def _fresh_ids(ids: list[str], now: datetime) -> set[str]:
    if not ids:
        return set()
    db = get_db()
    aql = """
    FOR d IN stock_minute_15m
      FILTER d.stock_id IN @ids
      COLLECT stock_id = d.stock_id AGGREGATE last = MAX(d.datetime)
      RETURN { stock_id, last }
    """
    rows = db.aql.execute(aql, bind_vars={"ids": ids})
    return {r["stock_id"] for r in rows if _is_fresh(r["last"], now)}


def _to_records(stock_df: pd.DataFrame) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for dt, row in stock_df.iterrows():
        close_val = float(row["Close"])
        if close_val != close_val:
            continue
        ts = dt.tz_localize(None) if getattr(dt, "tzinfo", None) else dt
        records.append({
            "datetime": ts.strftime("%Y-%m-%d %H:%M:%S"),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(close_val, 2),
            "volume": int(row["Volume"]),
        })
    return records


def _download_batch(
    batch: list[str],
    start_str: str,
    end_str: str,
    retries: int,
) -> dict[str, list[dict[str, Any]]]:
    tickers = {sid: f"{sid}{_yf_suffix(sid)}" for sid in batch}
    ticker_to_sid = {v: k for k, v in tickers.items()}

    data = pd.DataFrame()
    for attempt in range(1, retries + 1):
        try:
            data = yf.download(
                " ".join(tickers.values()),
                start=start_str,
                end=end_str,
                interval="15m",
                auto_adjust=False,
                progress=False,
                threads=True,
            )
            break
        except Exception as exc:
            wait = 2**attempt
            logger.warning(
                "yfinance download failed (attempt %d/%d): %s — retry in %ds",
                attempt, retries, exc, wait,
            )
            time.sleep(wait)
    else:
        return {}

    if data.empty:
        return {}

    results: dict[str, list[dict[str, Any]]] = {}
    for ticker, sid in ticker_to_sid.items():
        try:
            stock_df = (
                data.xs(ticker, level="Ticker", axis=1)
                if isinstance(data.columns, pd.MultiIndex)
                else data
            )
        except KeyError:
            continue
        records = _to_records(stock_df)
        if records:
            results[sid] = records
    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download 15m bars from yfinance into ArangoDB stock_minute_15m",
    )
    parser.add_argument("--symbols", type=str, default=None,
                        help="Comma-separated stock ids (default: all in stock_codes)")
    parser.add_argument("--days", type=int, default=YF_15M_MAX_DAYS,
                        help=f"Days of history, max {YF_15M_MAX_DAYS} (default {YF_15M_MAX_DAYS})")
    parser.add_argument("--batch-size", type=int, default=10,
                        help="Stocks per yfinance request (default 10)")
    parser.add_argument("--sleep", type=float, default=1.0,
                        help="Seconds between batches (default 1.0)")
    parser.add_argument("--retries", type=int, default=3,
                        help="Retries per batch (default 3)")
    parser.add_argument("--force", action="store_true",
                        help="Ignore freshness and redownload everything")
    args = parser.parse_args()

    days = max(1, min(args.days, YF_15M_MAX_DAYS))
    # end is exclusive (today+1); start = today-(days-1) keeps range ≤ 60 days
    start_str = (date.today() - timedelta(days=days - 1)).isoformat()
    end_str = (date.today() + timedelta(days=1)).isoformat()

    logger.info("=== 15m download: days=%d batch_size=%d sleep=%.1fs ===",
                days, args.batch_size, args.sleep)
    _ensure_collections()

    all_ids = _get_stock_ids(args.symbols)
    now = datetime.now()
    fresh = set() if args.force else _fresh_ids(all_ids, now)
    pending = [sid for sid in all_ids if sid not in fresh]
    logger.info("total=%d fresh(skip)=%d pending=%d", len(all_ids), len(fresh), len(pending))

    done = failed = bars_written = 0
    start_time = time.time()
    total = len(pending)
    n_batches = (total + args.batch_size - 1) // args.batch_size if total else 0

    for i in range(0, total, args.batch_size):
        batch = pending[i:i + args.batch_size]
        batch_num = i // args.batch_size + 1
        results = _download_batch(batch, start_str, end_str, args.retries)
        for sid in batch:
            records = results.get(sid, [])
            if not records:
                failed += 1
                logger.warning("no 15m data for %s", sid)
                continue
            try:
                store_minute_15m(sid, records)
                done += 1
                bars_written += len(records)
            except Exception as exc:
                failed += 1
                logger.warning("store failed %s: %s", sid, exc)
        logger.info("[%d/%d] batch %d/%d: ok=%d failed=%d bars=%d",
                    min(i + args.batch_size, total), total, batch_num, n_batches,
                    done, failed, bars_written)
        time.sleep(args.sleep)

    elapsed = time.time() - start_time
    logger.info("=== Done: ok=%d failed=%d bars=%d elapsed=%.0fs ===",
                done, failed, bars_written, elapsed)


if __name__ == "__main__":
    main()
