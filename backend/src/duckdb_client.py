import logging

import duckdb

from src.config import get_settings

logger = logging.getLogger("duckdb_client")

_connection: duckdb.DuckDBPyConnection | None = None


def get_duckdb_connection() -> duckdb.DuckDBPyConnection:
    global _connection
    if _connection is not None:
        return _connection

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")

    settings = get_settings()
    endpoint = settings.SEAWEEDFS_ENDPOINT.replace("http://", "").replace("https://", "")

    con.execute("""
        CREATE OR REPLACE SECRET seaweedfs (
            TYPE S3,
            PROVIDER config,
            KEY_ID $key_id,
            SECRET $secret,
            ENDPOINT $endpoint,
            USE_SSL false,
            URL_STYLE 'path'
        )
    """, {
        "key_id": settings.SEAWEEDFS_ACCESS_KEY,
        "secret": settings.SEAWEEDFS_SECRET_KEY,
        "endpoint": endpoint,
    })
    _connection = con
    return _connection


def _parquet_path(data_type: str, stock_id: str, interval: str | None = None) -> str:
    settings = get_settings()
    bucket = settings.SEAWEEDFS_BUCKET
    if data_type == "daily":
        return f"s3://{bucket}/daily/stock_id={stock_id}/data.parquet"
    elif data_type == "minute" and interval:
        return f"s3://{bucket}/minute/{interval}/stock_id={stock_id}/data.parquet"
    elif data_type == "minute":
        return f"s3://{bucket}/minute/stock_id={stock_id}/data.parquet"
    elif data_type == "bfp":
        return f"s3://{bucket}/analysis/stock_id={stock_id}/bfp.parquet"
    raise ValueError(f"Unknown data_type: {data_type}")


def query_stock_daily(
    stock_id: str, start_date: str, end_date: str | None = None
) -> list[dict]:
    con = get_duckdb_connection()
    path = _parquet_path("daily", stock_id)

    try:
        if end_date:
            result = con.execute(
                "SELECT * FROM read_parquet($path) WHERE date >= $start AND date <= $end ORDER BY date ASC",
                {"path": path, "start": start_date, "end": end_date},
            )
        else:
            result = con.execute(
                "SELECT * FROM read_parquet($path) WHERE date >= $start ORDER BY date ASC",
                {"path": path, "start": start_date},
            )
        columns = [desc[0] for desc in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]
    except duckdb.IOException:
        return []
    except duckdb.CatalogException:
        return []


def query_stock_minute(
    stock_id: str, start_date: str, end_date: str | None = None
) -> list[dict]:
    con = get_duckdb_connection()
    path = _parquet_path("minute", stock_id)

    try:
        if end_date:
            result = con.execute(
                "SELECT * FROM read_parquet($path) WHERE datetime >= $start AND datetime <= $end ORDER BY datetime ASC",
                {"path": path, "start": start_date, "end": end_date},
            )
        else:
            result = con.execute(
                "SELECT * FROM read_parquet($path) WHERE datetime >= $start ORDER BY datetime ASC",
                {"path": path, "start": start_date},
            )
        columns = [desc[0] for desc in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]
    except duckdb.IOException:
        return []
    except duckdb.CatalogException:
        return []


def query_bfp(stock_id: str) -> dict | None:
    con = get_duckdb_connection()
    path = _parquet_path("bfp", stock_id)

    try:
        result = con.execute(
            "SELECT * FROM read_parquet($path) ORDER BY date DESC LIMIT 1",
            {"path": path},
        )
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        if not rows:
            return None
        return dict(zip(columns, rows[0]))
    except duckdb.IOException:
        return None
    except duckdb.CatalogException:
        return None


STORED_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m"}
AGGREGATED_INTERVALS = {"10m": "5m"}  # 10m is built from 5m data


def query_stock_minute_interval(
    stock_id: str, interval: str, start_date: str, end_date: str | None = None
) -> list[dict]:
    """Query minute K data for a specific interval.

    Intervals 1m/2m/5m/15m/30m/60m are read directly from Parquet.
    Interval 10m is aggregated from 5m data using DuckDB SQL.
    """
    con = get_duckdb_connection()

    if interval in STORED_INTERVALS:
        path = _parquet_path("minute", stock_id, interval)
        try:
            if end_date:
                result = con.execute(
                    "SELECT * FROM read_parquet($path) WHERE datetime >= $start AND datetime <= $end ORDER BY datetime ASC",
                    {"path": path, "start": start_date, "end": end_date},
                )
            else:
                result = con.execute(
                    "SELECT * FROM read_parquet($path) WHERE datetime >= $start ORDER BY datetime ASC",
                    {"path": path, "start": start_date},
                )
            columns = [desc[0] for desc in result.description]
            return [dict(zip(columns, row)) for row in result.fetchall()]
        except duckdb.IOException:
            return []
        except duckdb.CatalogException:
            return []

    elif interval in AGGREGATED_INTERVALS:
        source_interval = AGGREGATED_INTERVALS[interval]
        path = _parquet_path("minute", stock_id, source_interval)
        # Aggregate 5m bars into 10m bars: group every 2 consecutive 5m bars
        # Use time_bucket of 10 minutes on the datetime column
        agg_sql = """
            SELECT
                strftime(
                    time_bucket(INTERVAL '10 minutes', CAST(datetime AS TIMESTAMP)),
                    '%Y-%m-%d %H:%M:%S'
                ) AS datetime,
                FIRST(open) AS open,
                MAX(high) AS high,
                MIN(low) AS low,
                LAST(close) AS close,
                SUM(volume)::BIGINT AS volume
            FROM read_parquet($path)
            WHERE datetime >= $start {end_clause}
            GROUP BY time_bucket(INTERVAL '10 minutes', CAST(datetime AS TIMESTAMP))
            ORDER BY 1 ASC
        """
        end_clause = "AND datetime <= $end" if end_date else ""
        agg_sql = agg_sql.replace("{end_clause}", end_clause)
        try:
            params: dict = {"path": path, "start": start_date}
            if end_date:
                params["end"] = end_date
            result = con.execute(agg_sql, params)
            columns = [desc[0] for desc in result.description]
            return [dict(zip(columns, row)) for row in result.fetchall()]
        except duckdb.IOException:
            return []
        except duckdb.CatalogException:
            return []

    return []
