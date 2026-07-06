import argparse
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
import twstock
from twstock import stock as twstock_stock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import get_db
from src.parquet_writer import stock_parquet_exists, write_stock_daily
from src.rate_limiter import twse_rate_limiter


logger = logging.getLogger("backfill_daily")

_original_get = requests.get
_original_make_datatuple = twstock_stock.TWSEFetcher._make_datatuple


def _get_with_rate_limit(*args: Any, **kwargs: Any) -> requests.Response:
    twse_rate_limiter.wait()
    request_kwargs = dict(kwargs)
    request_kwargs["verify"] = False
    return _original_get(*args, **request_kwargs)


def _safe_make_datatuple(self: twstock_stock.TWSEFetcher, raw_data: list[str]) -> Any:
    data = list(raw_data)
    if len(data) >= 10 and data[7] in {"+", "-", "X", " "}:
        data[8] = f"{data[7]}{data[8]}"
        data.pop(7)
    if len(data) > 9:
        data = data[:9]
    return _original_make_datatuple(self, data)


def _install_patches() -> None:
    requests.get = _get_with_rate_limit
    twstock_stock.TWSEFetcher._make_datatuple = _safe_make_datatuple


def _uninstall_patches() -> None:
    requests.get = _original_get
    twstock_stock.TWSEFetcher._make_datatuple = _original_make_datatuple


def _fetch_one_month(stock_id: str, year: int, month: int, max_retries: int = 3) -> list[dict[str, object]]:
    raw_data: list[Any] = []
    for attempt in range(max_retries):
        try:
            fetcher = twstock_stock.TWSEFetcher()
            result = fetcher.fetch(year, month, stock_id)
            raw_data = result.get("data", []) if isinstance(result, dict) else []
            break
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout, ConnectionResetError) as e:
            if attempt < max_retries - 1:
                wait = 10 * (attempt + 1)
                logger.warning("%s %d-%02d attempt %d failed: %s, retrying in %ds", stock_id, year, month, attempt + 1, type(e).__name__, wait)
                time.sleep(wait)
            else:
                logger.error("%s %d-%02d failed after %d retries: %s", stock_id, year, month, max_retries, e)
                return []

    records: list[dict[str, object]] = []
    for row in raw_data:
        try:
            row_date = row.date
            if isinstance(row_date, datetime):
                row_date = row_date.date()

            records.append(
                {
                    "date": row_date.strftime("%Y-%m-%d"),
                    "open": float(row.open) if row.open else 0.0,
                    "high": float(row.high) if row.high else 0.0,
                    "low": float(row.low) if row.low else 0.0,
                    "close": float(row.close) if row.close else 0.0,
                    "volume": int(row.capacity) if row.capacity else 0,
                    "turnover": int(row.turnover) if row.turnover else 0,
                    "change": float(row.change) if row.change else 0.0,
                    "transaction": int(row.transaction) if row.transaction else 0,
                }
            )
        except (AttributeError, TypeError, ValueError):
            continue

    return records


def _month_range(start_year: int) -> list[tuple[int, int]]:
    now = datetime.now()
    months: list[tuple[int, int]] = []
    year = start_year
    month = 1
    while year < now.year or (year == now.year and month <= now.month):
        months.append((year, month))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return months


def _get_stock_ids(stock_id: str | None, limit: int | None) -> list[str]:
    if stock_id:
        return [stock_id]

    db = get_db()
    cursor = db.aql.execute("FOR s IN stock_codes RETURN s.stock_id")
    stock_ids = [str(item) for item in cursor if item]
    if limit is not None:
        return stock_ids[:limit]
    return stock_ids


def _backfill_stock(stock_id: str, start_year: int) -> int:
    all_records: list[dict[str, object]] = []
    months = _month_range(start_year)
    for i, (year, month) in enumerate(months):
        monthly_records = _fetch_one_month(stock_id, year, month)
        if monthly_records:
            all_records.extend(monthly_records)
        if i > 0 and i % 6 == 0:
            logger.info("  %s progress: %d/%d months fetched, %d rows so far", stock_id, i, len(months), len(all_records))
    write_stock_daily(stock_id, all_records)
    return len(all_records)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-id", type=str, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--start-year", type=int, default=2006)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    _install_patches()
    try:
        stock_ids = _get_stock_ids(args.stock_id, args.limit)
        total = len(stock_ids)

        for idx, stock_id in enumerate(stock_ids, start=1):
            try:
                if stock_parquet_exists(stock_id, "daily"):
                    logger.info("[%d/%d] %s already exists, skipping", idx, total, stock_id)
                    continue
                row_count = _backfill_stock(stock_id, args.start_year)
                logger.info("[%d/%d] %s done, %d rows", idx, total, stock_id, row_count)
            except Exception:
                logger.exception("[%d/%d] %s failed", idx, total, stock_id)
    finally:
        _uninstall_patches()


if __name__ == "__main__":
    main()
