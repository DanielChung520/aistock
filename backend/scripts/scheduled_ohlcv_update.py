"""Scheduled OHLCV update — runs daily at 3:00 PM.

Downloads and maintains:
- Daily K-line: 10-year moving window from TWSE
- Minute K-line:
  - 1m, 5m: 7 days (yfinance primary, TWSE fallback)
  - 10m, 15m, 30m, 60m: 30 days (yfinance)

Usage:
  # Run manually:
  python scripts/scheduled_ohlcv_update.py

  # Add to crontab (run daily at 3:00 PM):
  0 15 * * * cd /path/to/aiStock/backend && source .venv/bin/activate && python scripts/scheduled_ohlcv_update.py >> logs/scheduled_ohlcv.log 2>&1
"""

import argparse
import logging
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import get_db
from src.duckdb_client import query_stock_daily, query_stock_minute_interval
from src.parquet_writer import write_stock_daily, write_stock_minute_interval
from src.rate_limiter import twse_rate_limiter

SCHEDULE_KEY = "ohlcv_update"


def _update_schedule_status(
    daily_success: int,
    daily_failed: int,
    minute_success: int,
    minute_failed: int,
    skip_daily: bool = False,
    skip_minute: bool = False,
) -> None:
    db = get_db()

    try:
        collection = db.collection("schedule_settings")
    except Exception:
        logger.warning("schedule_settings collection does not exist, skipping status update")
        return

    now = datetime.now().isoformat()

    daily_status: str | None = None
    if not skip_daily:
        if daily_failed == 0 and daily_success > 0:
            daily_status = "completed"
        elif daily_success > 0:
            daily_status = "partial"
        elif daily_failed > 0:
            daily_status = "failed"

    minute_status: str | None = None
    if not skip_minute:
        if minute_failed == 0 and minute_success > 0:
            minute_status = "completed"
        elif minute_success > 0:
            minute_status = "partial"
        elif minute_failed > 0:
            minute_status = "failed"

    overall_status: str | None = None
    if not skip_daily and not skip_minute:
        if daily_status == "completed" and minute_status == "completed":
            overall_status = "completed"
        elif daily_status == "failed" and minute_status == "failed":
            overall_status = "failed"
        else:
            overall_status = "partial"
    elif not skip_daily:
        overall_status = daily_status
    elif not skip_minute:
        overall_status = minute_status

    try:
        doc = {"lastRun": now,
               "lastStatus": overall_status,
               "lastRunDaily": now if not skip_daily else None,
               "lastStatusDaily": daily_status,
               "lastRunMinute": now if not skip_minute else None,
               "lastStatusMinute": minute_status,
               "updatedAt": now}
        collection.update(doc, check_rev=False)  # type: ignore[call-arg]
        logger.info("Updated schedule status: daily=%s, minute=%s, overall=%s", daily_status, minute_status, overall_status)
    except Exception as exc:
        logger.warning("Failed to update schedule status: %s", exc)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("scheduled_ohlcv")

# TWSE daily data retention: ~10+ years (we'll use 10 years as the moving window)
DAILY_YEARS = 10

# Minute K-line retention periods (in days)
MINUTE_RETENTION: dict[str, int] = {
    "1m": 7,
    "5m": 7,
    "10m": 30,
    "15m": 30,
    "30m": 30,
    "60m": 30,
}

# Intervals to download (grouped by retention period)
MINUTE_INTERVALS_7D = ["1m", "5m"]
MINUTE_INTERVALS_30D = ["10m", "15m", "30m", "60m"]


def _subtract_years(input_date: date, years: int) -> date:
    """Subtract years from a date, handling leap years."""
    year = input_date.year - years
    # Handle Feb 29 -> Feb 28 for non-leap years
    try:
        return date(year, input_date.month, input_date.day)
    except ValueError:
        return date(year, 2, 28)


def _previous_business_day(input_date: date) -> date:
    """Get the previous business day (skip weekends)."""
    previous = date.fromordinal(input_date.toordinal() - 1)
    while previous.weekday() >= 5:  # 5=Saturday, 6=Sunday
        previous = date.fromordinal(previous.toordinal() - 1)
    return previous


def _get_watchlist(db: Any) -> list[dict[str, str]]:
    """Get stock list from watchlist collection."""
    aql = """
    FOR w IN watchlist
      RETURN { stock_id: w.stock_id, name: w.name }
    """
    cursor = db.aql.execute(aql)
    return [item for item in cursor if item.get("stock_id")]


def _get_all_stock_ids(db: Any) -> list[str]:
    """Get all stock codes from stock_codes collection."""
    aql = """
    FOR s IN stock_codes
      RETURN s.stock_id
    """
    cursor = db.aql.execute(aql)
    return [str(item).strip() for item in cursor if str(item).strip()]


def _fetch_twse_daily_month(stock_id: str, year: int, month: int, max_retries: int = 3) -> list[dict[str, Any]]:
    import httpx
    
    date_str = f"{year}{month:02d}01"
    url = f"https://www.twse.com.tw/exchangeReport/STOCK_DAY"
    params = {"response": "json", "date": date_str, "stockNo": stock_id}

    for attempt in range(max_retries):
        try:
            twse_rate_limiter.wait()
            
            with httpx.Client(verify=False, timeout=15.0) as client:
                response = client.get(url, params=params)
                response.raise_for_status()
                result = response.json()
            
            if result.get("stat") != "OK":
                logger.warning("%s %d-%02d: TWSE API returned status: %s", stock_id, year, month, result.get("stat", "Unknown"))
                return []
            
            raw_data = result.get("data", [])
            if not raw_data:
                logger.warning("%s %d-%02d: TWSE API returned no data", stock_id, year, month)
                return []
            
            records: list[dict[str, Any]] = []
            for row in raw_data:
                try:
                    date_parts = str(row[0]).strip().split("/")
                    year_tw = int(date_parts[0]) + 1911
                    month_tw = int(date_parts[1])
                    day_tw = int(date_parts[2])
                    
                    records.append({
                        "date": f"{year_tw:04d}-{month_tw:02d}-{day_tw:02d}",
                        "open": float(str(row[3]).replace(",", "")),
                        "high": float(str(row[4]).replace(",", "")),
                        "low": float(str(row[5]).replace(",", "")),
                        "close": float(str(row[6]).replace(",", "")),
                        "volume": int(str(row[1]).replace(",", "")),
                        "turnover": int(str(row[2]).replace(",", "")),
                        "change": float(str(row[7]).replace(",", "")),
                        "transaction": int(str(row[8]).replace(",", "")),
                    })
                except (ValueError, IndexError, TypeError) as e:
                    logger.debug(f"Skip row {row}: {e}")
                    continue
            
            logger.info("%s %d-%02d: Fetched %d records from TWSE API", stock_id, year, month, len(records))
            return records
            
        except (httpx.HTTPError, httpx.TimeoutException, ConnectionResetError) as exc:
            if attempt < max_retries - 1:
                wait = 10 * (attempt + 1)
                logger.warning("%s %d-%02d TWSE fetch failed (attempt %d): %s, retry in %ds", stock_id, year, month, attempt + 1, type(exc).__name__, wait)
                time.sleep(wait)
            else:
                logger.error("%s %d-%02d TWSE fetch failed after %d attempts: %s", stock_id, year, month, max_retries, exc)
                return []
        except Exception as exc:
            logger.error("%s %d-%02d Unexpected error: %s", stock_id, year, month, exc)
            return []
    
    return []


def _month_sequence(start: date, end: date) -> list[tuple[int, int]]:
    """Generate (year, month) tuples from start to end date."""
    months: list[tuple[int, int]] = []
    year = start.year
    month = start.month
    while year < end.year or (year == end.year and month <= end.month):
        months.append((year, month))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return months


def _merge_daily_records(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge existing and incoming daily records, keeping the latest for each date."""
    def _to_float(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def _to_int(value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    merged: dict[str, dict[str, Any]] = {}
    for row in existing:
        row_date = row.get("date")
        if not isinstance(row_date, str) or not row_date:
            continue
        merged[row_date] = {
            "date": row_date,
            "open": _to_float(row.get("open")),
            "high": _to_float(row.get("high")),
            "low": _to_float(row.get("low")),
            "close": _to_float(row.get("close")),
            "volume": _to_int(row.get("volume")),
            "turnover": _to_int(row.get("turnover")),
            "change": _to_float(row.get("change")),
            "transaction": _to_int(row.get("transaction")),
        }
    for row in incoming:
        row_date = row.get("date")
        if not isinstance(row_date, str) or not row_date:
            continue
        merged[row_date] = {
            "date": row_date,
            "open": _to_float(row.get("open")),
            "high": _to_float(row.get("high")),
            "low": _to_float(row.get("low")),
            "close": _to_float(row.get("close")),
            "volume": _to_int(row.get("volume")),
            "turnover": _to_int(row.get("turnover")),
            "change": _to_float(row.get("change")),
            "transaction": _to_int(row.get("transaction")),
        }
    return [merged[d] for d in sorted(merged.keys())]


def _get_yf_suffix(stock_id: str) -> str:
    """Get yfinance ticker suffix for Taiwan stocks."""
    import twstock
    info = twstock.codes.get(stock_id)
    if info and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def _safe_float(value: Any) -> float | None:
    """Safely convert value to float."""
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
    """Safely convert value to int."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _download_yf_minute(stock_id: str, interval: str, days: int) -> list[dict[str, Any]]:
    """Download minute K-line data from yfinance."""
    import pandas as pd

    ticker = f"{stock_id}{_get_yf_suffix(stock_id)}"

    # yfinance period mapping
    if days <= 7:
        period = "7d"
    else:
        period = "1mo"  # 30 days max for minute data

    try:
        data: pd.DataFrame = yf.download(  # type: ignore[assignment]
            ticker,
            period=period,
            interval=interval,
            auto_adjust=False,
            progress=False,
            threads=True,
        )
    except Exception as exc:
        logger.error("yfinance download failed for %s/%s: %s", stock_id, interval, exc)
        return []

    if data.empty:
        logger.warning("yfinance returned no data for %s/%s", stock_id, interval)
        return []

    records: list[dict[str, Any]] = []

    for timestamp, row in data.iterrows():  # type: ignore[union-attr]
        ts = timestamp  # type: ignore[union-attr]
        if getattr(ts, "tzinfo", None) is not None:
            ts = ts.tz_localize(None)  # type: ignore[union-attr]

        close_val = _safe_float(row.get("Close"))
        if close_val is None or close_val == 0:
            continue

        records.append({
            "datetime": ts.strftime("%Y-%m-%d %H:%M:%S"),  # type: ignore[union-attr]
            "open": _safe_float(row.get("Open")) or 0.0,
            "high": _safe_float(row.get("High")) or 0.0,
            "low": _safe_float(row.get("Low")) or 0.0,
            "close": close_val,
            "volume": _safe_int(row.get("Volume")) or 0,
        })

    return records


def _prune_old_data(records: list[dict[str, Any]], days: int, is_daily: bool = False) -> list[dict[str, Any]]:
    """Remove records older than the retention period."""
    cutoff_date = date.today() - timedelta(days=days)

    if is_daily:
        # For daily data, filter by date string
        pruned = []
        for row in records:
            date_str = row.get("date")
            if not date_str:
                continue
            try:
                row_date = date.fromisoformat(date_str)
                if row_date >= cutoff_date:
                    pruned.append(row)
            except ValueError:
                continue
        return pruned
    else:
        # For minute data, filter by datetime string
        cutoff_dt = datetime.combine(cutoff_date, datetime.min.time())
        pruned = []
        for row in records:
            dt_str = row.get("datetime")
            if not dt_str:
                continue
            try:
                row_dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
                if row_dt >= cutoff_dt:
                    pruned.append(row)
            except ValueError:
                continue
        return pruned


def _update_daily_kline(db: Any, stock_id: str, stock_name: str) -> bool:
    """Update daily K-line data with 10-year moving window."""
    today = date.today()
    end_date = today
    start_date = _subtract_years(today, DAILY_YEARS)

    # Get existing records
    existing_records = query_stock_daily(stock_id, "1900-01-01")

    # Determine which months we need to fetch
    reference_date = _previous_business_day(today)
    if existing_records:
        # Find the latest date in existing records
        latest_date = None
        for row in reversed(existing_records):
            if row.get("date"):
                try:
                    latest_date = date.fromisoformat(row["date"])
                    break
                except ValueError:
                    continue

        if latest_date and latest_date >= reference_date:
            logger.info("%s %s daily: already up to date (latest: %s)", stock_id, stock_name, latest_date)
            # Still need to prune old data if needed
            if latest_date > _subtract_years(today, DAILY_YEARS):
                return True
        else:
            # Update from the last existing date
            if latest_date:
                start_date = latest_date + timedelta(days=1)
            else:
                start_date = _subtract_years(today, DAILY_YEARS)

    # Fetch new data from TWSE
    months = _month_sequence(start_date, end_date)
    incoming_records: list[dict[str, Any]] = []

    for year, month in months:
        monthly_records = _fetch_twse_daily_month(stock_id, year, month)
        if monthly_records:
            incoming_records.extend(monthly_records)
            logger.debug("%s %d-%02d: fetched %d records", stock_id, year, month, len(monthly_records))

    if not incoming_records:
        logger.warning("%s %s daily: no new data fetched", stock_id, stock_name)
        return False

    # Merge with existing
    merged_records = _merge_daily_records(existing_records, incoming_records)

    # Prune to 10-year window
    pruned_records = _prune_old_data(merged_records, DAILY_YEARS * 365, is_daily=True)

    if not pruned_records:
        logger.warning("%s %s daily: no valid records after merge", stock_id, stock_name)
        return False

    # Write to parquet
    write_stock_daily(stock_id, pruned_records)
    logger.info("%s %s daily: wrote %d records (%s -> %s)", stock_id, stock_name, len(pruned_records),
                pruned_records[0].get("date") if pruned_records else "N/A",
                pruned_records[-1].get("date") if pruned_records else "N/A")
    return True


def _update_minute_kline(db: Any, stock_id: str, stock_name: str, intervals: list[str], days: int) -> bool:
    """Update minute K-line data with specified retention period."""
    success = False

    for interval in intervals:
        # Get existing records to merge
        try:
            existing_records = query_stock_minute_interval(stock_id, interval, "1900-01-01")
        except Exception:
            existing_records = []

        # Download new data from yfinance
        new_records = _download_yf_minute(stock_id, interval, days)

        if not new_records:
            logger.warning("%s %s %s: no data from yfinance", stock_id, stock_name, interval)
            # If no existing data and no new data, skip
            if not existing_records:
                continue

        # Merge and deduplicate
        merged: dict[str, dict[str, Any]] = {}
        for row in existing_records:
            dt = row.get("datetime")
            if dt:
                merged[dt] = row
        for row in new_records:
            dt = row.get("datetime")
            if dt:
                merged[dt] = row

        # Sort by datetime
        all_records = [merged[dt] for dt in sorted(merged.keys())]

        # Prune to retention period
        pruned_records = _prune_old_data(all_records, days, is_daily=False)

        if not pruned_records:
            logger.warning("%s %s %s: no valid records after merge", stock_id, stock_name, interval)
            continue

        # Write to parquet
        try:
            write_stock_minute_interval(stock_id, interval, pruned_records)
            logger.info("%s %s %s: wrote %d records", stock_id, stock_name, interval, len(pruned_records))
            success = True
        except Exception as exc:
            logger.error("%s %s %s: write failed: %s", stock_id, stock_name, interval, exc)

    return success


def main() -> None:
    parser = argparse.ArgumentParser(description="Scheduled OHLCV update - daily at 3:00 PM")
    parser.add_argument("--stock-id", type=str, default=None, help="Single stock to update (default: all watchlist stocks)")
    parser.add_argument("--dry-run", action="store_true", help="Dry run without writing data")
    parser.add_argument("--skip-daily", action="store_true", help="Skip daily K-line update")
    parser.add_argument("--skip-minute", action="store_true", help="Skip minute K-line update")
    args = parser.parse_args()

    logger.info("=== Scheduled OHLCV Update Started at %s ===", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    logger.info("Daily retention: %d years", DAILY_YEARS)
    logger.info("Minute retention: 1m/5m: 7 days, 10m/15m/30m/60m: 30 days")

    if args.dry_run:
        logger.info("DRY RUN MODE - no data will be written")

    db = get_db()

    # Determine which stocks to update
    if args.stock_id:
        stocks = [{"stock_id": args.stock_id, "name": args.stock_id}]
    else:
        all_stock_ids = _get_all_stock_ids(db)
        stocks = [{"stock_id": sid, "name": sid} for sid in all_stock_ids]

    if not stocks:
        logger.info("No stocks to update (stock_codes is empty)")
        return

    logger.info("Updating %d stock(s)", len(stocks))

    daily_success = 0
    daily_failed = 0
    minute_success = 0
    minute_failed = 0

    for item in stocks:
        stock_id = str(item.get("stock_id", "")).strip()
        stock_name = str(item.get("name", "")).strip()

        if not stock_id:
            daily_failed += 1
            minute_failed += 1
            continue

        # Update daily K-line
        if not args.skip_daily:
            try:
                if args.dry_run:
                    logger.info("[DRY RUN] Would update daily K-line for %s %s", stock_id, stock_name)
                else:
                    if _update_daily_kline(db, stock_id, stock_name):
                        daily_success += 1
                    else:
                        daily_failed += 1
            except Exception as exc:
                daily_failed += 1
                logger.error("%s %s daily update failed: %s", stock_id, stock_name, exc)

        # Update minute K-line
        if not args.skip_minute:
            try:
                if args.dry_run:
                    logger.info("[DRY RUN] Would update minute K-line for %s %s", stock_id, stock_name)
                else:
                    # Update 1m and 5m (7 days)
                    if _update_minute_kline(db, stock_id, stock_name, MINUTE_INTERVALS_7D, 7):
                        minute_success += 1
                    else:
                        minute_failed += 1

                    # Update 10m, 15m, 30m, 60m (30 days)
                    if _update_minute_kline(db, stock_id, stock_name, MINUTE_INTERVALS_30D, 30):
                        minute_success += 1
                    else:
                        minute_failed += 1
            except Exception as exc:
                minute_failed += 1
                logger.error("%s %s minute update failed: %s", stock_id, stock_name, exc)

    logger.info("=== Scheduled OHLCV Update Complete ===")
    if not args.skip_daily:
        logger.info("Daily K-line: %d success, %d failed", daily_success, daily_failed)
    if not args.skip_minute:
        logger.info("Minute K-line: %d success, %d failed", minute_success, minute_failed)

    if not args.dry_run:
        _update_schedule_status(
            daily_success,
            daily_failed,
            minute_success,
            minute_failed,
            skip_daily=args.skip_daily,
            skip_minute=args.skip_minute,
        )


if __name__ == "__main__":
    main()
