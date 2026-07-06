import logging
import sys
import importlib
import subprocess
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import get_db
from src.duckdb_client import query_stock_daily
from src.parquet_writer import stock_parquet_exists, write_stock_daily
from src.rate_limiter import twse_rate_limiter


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

twstock_stock = importlib.import_module("twstock.stock")

_original_get = requests.get
_original_make_datatuple = twstock_stock.TWSEFetcher._make_datatuple


def _subtract_months(input_date: date, months: int) -> date:
    month_index = input_date.month - 1 - months
    year = input_date.year + month_index // 12
    month = month_index % 12 + 1
    day = min(
        input_date.day,
        [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30,
         31, 31, 30, 31, 30, 31][month - 1],
    )
    return date(year, month, day)


def _previous_business_day(input_date: date) -> date:
    previous = date.fromordinal(input_date.toordinal() - 1)
    while previous.weekday() >= 5:
        previous = date.fromordinal(previous.toordinal() - 1)
    return previous


def _get_with_rate_limit(*args: Any, **kwargs: Any) -> requests.Response:
    twse_rate_limiter.wait()
    request_kwargs = dict(kwargs)
    request_kwargs["verify"] = False
    return _original_get(*args, **request_kwargs)


def _safe_make_datatuple(self: Any, raw_data: list[str]) -> Any:
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


def _month_sequence(start: date, end: date) -> list[tuple[int, int]]:
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


def _fetch_one_month(stock_id: str, year: int, month: int, max_retries: int = 3) -> list[dict[str, object]]:
    raw_data: list[Any] = []
    for attempt in range(max_retries):
        try:
            fetcher = twstock_stock.TWSEFetcher()
            result = fetcher.fetch(year, month, stock_id)
            raw_data = result.get("data", []) if isinstance(result, dict) else []
            break
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout, ConnectionResetError) as exc:
            if attempt < max_retries - 1:
                wait = 10 * (attempt + 1)
                logger.warning("%s %d-%02d 第 %d 次失敗: %s，%d 秒後重試", stock_id, year, month, attempt + 1, type(exc).__name__, wait)
                time.sleep(wait)
            else:
                logger.error("%s %d-%02d 重試 %d 次後失敗: %s", stock_id, year, month, max_retries, exc)
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


def _get_watchlist(db: Any) -> list[dict[str, str]]:
    aql = """
    FOR w IN watchlist
      RETURN { stock_id: w.stock_id, name: w.name }
    """
    cursor = db.aql.execute(aql)
    return [item for item in cursor if item.get("stock_id")]


def _get_stock_code_ids(db: Any) -> list[str]:
    aql = """
    FOR s IN stock_codes
      RETURN s.stock_id
    """
    cursor = db.aql.execute(aql)
    return [str(item).strip() for item in cursor if str(item).strip()]


def _latest_date_from_records(records: list[dict[str, Any]]) -> date | None:
    if not records:
        return None
    last = records[-1].get("date")
    if not isinstance(last, str):
        return None
    try:
        return date.fromisoformat(last)
    except ValueError:
        return None


def _merge_records(existing: list[dict[str, Any]], incoming: list[dict[str, object]]) -> list[dict[str, object]]:
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

    merged: dict[str, dict[str, object]] = {}
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
    return [merged[row_date] for row_date in sorted(merged)]


def _run_bfp_for_stock(script_dir: Path, stock_id: str) -> None:
    command = [sys.executable, str(script_dir / "compute_bfp.py"), "--stock-id", stock_id]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode == 0:
        logger.info("%s BFP 預計算完成", stock_id)
    else:
        logger.warning("%s BFP 預計算失敗: %s", stock_id, (result.stderr or result.stdout).strip())


def _run_minute_update_for_stock(script_dir: Path, stock_id: str) -> None:
    command = [sys.executable, str(script_dir / "backfill_minute.py"), "--stock-id", stock_id]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode == 0:
        logger.info("%s 分鐘 K 更新完成", stock_id)
    else:
        logger.warning("%s 分鐘 K 更新失敗: %s", stock_id, (result.stderr or result.stdout).strip())


def main() -> None:
    db = get_db()
    watchlist = _get_watchlist(db)
    all_stock_ids = _get_stock_code_ids(db)
    newly_listed = [stock_id for stock_id in all_stock_ids if not stock_parquet_exists(stock_id, "daily")]
    if newly_listed:
        logger.info("偵測到尚無日線 Parquet 的股票 %s 檔（僅記錄，不自動回補）", len(newly_listed))

    if not watchlist:
        logger.info("自選股清單為空，無需更新")
        return

    logger.info("開始每日更新，自選股數量: %s", len(watchlist))

    reference_date = _previous_business_day(date.today())
    start_date = _subtract_months(date.today(), 1)
    end_date = date.today()
    script_dir = Path(__file__).resolve().parent

    success = 0
    skipped = 0
    failed = 0

    _install_patches()
    try:
        for item in watchlist:
            stock_id = str(item.get("stock_id", "")).strip()
            name = str(item.get("name", "")).strip()

            if not stock_id:
                failed += 1
                logger.error("更新 %s %s... 失敗: 缺少 stock_id", stock_id, name)
                continue

            try:
                existing_records = query_stock_daily(stock_id, "1900-01-01")
                latest_date = _latest_date_from_records(existing_records)

                if latest_date is not None and latest_date >= reference_date:
                    skipped += 1
                    logger.info("%s %s 資料已是最新，略過", stock_id, name)
                    continue

                months = _month_sequence(start_date, end_date)
                incoming_records: list[dict[str, object]] = []
                for year, month in months:
                    monthly_records = _fetch_one_month(stock_id, year, month)
                    if monthly_records:
                        incoming_records.extend(monthly_records)

                merged_records = _merge_records(existing_records, incoming_records)
                if not merged_records:
                    skipped += 1
                    logger.info("%s %s 無可寫入資料，略過", stock_id, name)
                    continue

                write_stock_daily(stock_id, merged_records)
                _run_bfp_for_stock(script_dir, stock_id)
                _run_minute_update_for_stock(script_dir, stock_id)

                success += 1
                logger.info("更新 %s %s... 完成 (%s -> %s 筆)", stock_id, name, len(existing_records), len(merged_records))
            except (
                requests.RequestException,
                ValueError,
                TypeError,
                RuntimeError,
                KeyError,
            ) as exc:
                failed += 1
                logger.error("更新 %s %s... 失敗: %s", stock_id, name, exc)
            except Exception as exc:
                failed += 1
                logger.error("更新 %s %s... 失敗: %s", stock_id, name, exc)
    finally:
        _uninstall_patches()

    logger.info("每日更新完成。成功: %s, 略過: %s, 失敗: %s", success, skipped, failed)


if __name__ == "__main__":
    main()
