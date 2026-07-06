import io
import logging

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.exceptions import ClientError

from src.config import get_settings

logger = logging.getLogger("parquet_writer")

DAILY_SCHEMA = pa.schema([
    ("date", pa.string()),
    ("open", pa.float64()),
    ("high", pa.float64()),
    ("low", pa.float64()),
    ("close", pa.float64()),
    ("volume", pa.int64()),
    ("turnover", pa.int64()),
    ("change", pa.float64()),
    ("transaction", pa.int64()),
])

MINUTE_SCHEMA = pa.schema([
    ("datetime", pa.string()),
    ("open", pa.float64()),
    ("high", pa.float64()),
    ("low", pa.float64()),
    ("close", pa.float64()),
    ("volume", pa.int64()),
])

BFP_SCHEMA = pa.schema([
    ("date", pa.string()),
    ("signal", pa.string()),
    ("reason", pa.string()),
    ("buy_triggered", pa.bool_()),
    ("buy_reason", pa.string()),
    ("sell_triggered", pa.bool_()),
    ("sell_reason", pa.string()),
])


def _get_s3_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.SEAWEEDFS_ENDPOINT,
        aws_access_key_id=settings.SEAWEEDFS_ACCESS_KEY,
        aws_secret_access_key=settings.SEAWEEDFS_SECRET_KEY,
        region_name="us-east-1",
    )


def _upload_parquet(table: pa.Table, s3_key: str) -> None:
    settings = get_settings()
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    buf.seek(0)
    s3 = _get_s3_client()
    s3.put_object(Bucket=settings.SEAWEEDFS_BUCKET, Key=s3_key, Body=buf.getvalue())


def _build_table(records: list[dict], schema: pa.Schema) -> pa.Table:
    if not records:
        return pa.table({field.name: pa.array([], type=field.type) for field in schema}, schema=schema)

    arrays = {}
    for field in schema:
        values = [r.get(field.name) for r in records]
        arrays[field.name] = pa.array(values, type=field.type)
    return pa.table(arrays, schema=schema)


def write_stock_daily(stock_id: str, records: list[dict]) -> None:
    if not records:
        logger.info("No records for %s, skipping daily write", stock_id)
        return
    table = _build_table(records, DAILY_SCHEMA)
    key = f"daily/stock_id={stock_id}/data.parquet"
    _upload_parquet(table, key)
    logger.info("Wrote %d daily rows for %s", len(records), stock_id)


def write_stock_minute(stock_id: str, records: list[dict]) -> None:
    if not records:
        logger.info("No records for %s, skipping minute write", stock_id)
        return
    table = _build_table(records, MINUTE_SCHEMA)
    key = f"minute/stock_id={stock_id}/data.parquet"
    _upload_parquet(table, key)
    logger.info("Wrote %d minute rows for %s", len(records), stock_id)


VALID_INTERVALS = ("1m", "2m", "5m", "15m", "30m", "60m")


def write_stock_minute_interval(stock_id: str, interval: str, records: list[dict]) -> None:
    if interval not in VALID_INTERVALS:
        raise ValueError(f"Invalid interval: {interval}. Must be one of {VALID_INTERVALS}")
    if not records:
        logger.info("No records for %s/%s, skipping", stock_id, interval)
        return
    table = _build_table(records, MINUTE_SCHEMA)
    key = f"minute/{interval}/stock_id={stock_id}/data.parquet"
    _upload_parquet(table, key)
    logger.info("Wrote %d %s rows for %s", len(records), interval, stock_id)


def write_bfp(stock_id: str, bfp_data: dict) -> None:
    records = [bfp_data] if bfp_data else []
    if not records:
        logger.info("No BFP data for %s, skipping", stock_id)
        return
    table = _build_table(records, BFP_SCHEMA)
    key = f"analysis/stock_id={stock_id}/bfp.parquet"
    _upload_parquet(table, key)
    logger.info("Wrote BFP for %s", stock_id)


def stock_parquet_exists(stock_id: str, data_type: str = "daily") -> bool:
    settings = get_settings()
    s3 = _get_s3_client()

    if data_type == "daily":
        key = f"daily/stock_id={stock_id}/data.parquet"
    elif data_type == "minute":
        key = f"minute/stock_id={stock_id}/data.parquet"
    elif data_type == "bfp":
        key = f"analysis/stock_id={stock_id}/bfp.parquet"
    else:
        return False

    try:
        s3.head_object(Bucket=settings.SEAWEEDFS_BUCKET, Key=key)
        return True
    except ClientError:
        return False
