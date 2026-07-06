import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path

import boto3
import twstock
from twstock.analytics import Analytics

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import get_settings
from src.duckdb_client import query_stock_daily
from src.parquet_writer import write_bfp


logger = logging.getLogger("compute_bfp")


class StockData(Analytics):
    def __init__(self, price: list[float], high: list[float], low: list[float],
                 close: list[float], open: list[float], capacity: list[int],
                 date: list[date]) -> None:
        self.price = price
        self.high = high
        self.low = low
        self.close = close
        self.open = open
        self.capacity = capacity
        self.date = date


def normalize(result: object) -> tuple[bool | None, str]:
    if isinstance(result, tuple) and len(result) >= 2:
        signal = result[0] if isinstance(result[0], bool) else None
        reason = str(result[1]) if result[1] else ""
        return signal, reason
    return None, ""


def _get_s3_client() -> boto3.client:
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.SEAWEEDFS_ENDPOINT,
        aws_access_key_id=settings.SEAWEEDFS_ACCESS_KEY,
        aws_secret_access_key=settings.SEAWEEDFS_SECRET_KEY,
        region_name="us-east-1",
    )


def _list_daily_stock_ids() -> list[str]:
    settings = get_settings()
    s3 = _get_s3_client()
    stock_ids: set[str] = set()

    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(
        Bucket=settings.SEAWEEDFS_BUCKET, Prefix="daily/stock_id=", Delimiter="/"
    ):
        for prefix_data in page.get("CommonPrefixes", []):
            prefix = str(prefix_data.get("Prefix", ""))
            if prefix.startswith("daily/stock_id=") and prefix.endswith("/"):
                stock_id = prefix[len("daily/stock_id="):-1]
                if stock_id:
                    stock_ids.add(stock_id)

    return sorted(stock_ids)


def _as_date(value: object) -> date:
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def _compute_for_stock(stock_id: str) -> bool:
    data = query_stock_daily(stock_id, "1900-01-01")
    if len(data) < 30:
        logger.warning("%s has only %d daily rows, need at least 30", stock_id, len(data))
        return False

    stock_data = StockData(
        price=[float(row["close"]) for row in data],
        high=[float(row["high"]) for row in data],
        low=[float(row["low"]) for row in data],
        close=[float(row["close"]) for row in data],
        open=[float(row["open"]) for row in data],
        capacity=[int(row["volume"]) for row in data],
        date=[_as_date(row["date"]) for row in data],
    )

    bfp = twstock.BestFourPoint(stock_data)
    overall_signal, overall_reason = normalize(bfp.best_four_point())
    buy_triggered, buy_reason = normalize(bfp.best_four_point_to_buy())
    sell_triggered, sell_reason = normalize(bfp.best_four_point_to_sell())

    signal = "neutral"
    if overall_signal is True:
        signal = "buy"
    elif overall_signal is False:
        signal = "sell"

    bfp_data = {
        "date": str(data[-1]["date"]),
        "signal": signal,
        "reason": overall_reason,
        "buy_triggered": bool(buy_triggered),
        "buy_reason": buy_reason,
        "sell_triggered": bool(sell_triggered),
        "sell_reason": sell_reason,
    }
    write_bfp(stock_id, bfp_data)
    logger.info("%s BFP computed: signal=%s", stock_id, signal)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-id", type=str, default=None)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    if args.all and args.stock_id:
        raise ValueError("Use either --stock-id or --all, not both")
    if not args.all and not args.stock_id:
        raise ValueError("Provide --stock-id or --all")

    stock_ids = [args.stock_id] if args.stock_id else _list_daily_stock_ids()
    if not stock_ids:
        logger.warning("No stock IDs found to process")
        return

    total = len(stock_ids)
    success = 0
    failed = 0
    skipped = 0

    for idx, stock_id in enumerate(stock_ids, start=1):
        try:
            processed = _compute_for_stock(stock_id)
            if processed:
                success += 1
            else:
                skipped += 1
        except Exception:
            failed += 1
            logger.exception("[%d/%d] %s failed", idx, total, stock_id)

    logger.info("compute_bfp complete: success=%d skipped=%d failed=%d", success, skipped, failed)


if __name__ == "__main__":
    main()
