from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query

from src.data_fetcher import fetch_daily_history, fetch_minute_history, fetch_volume_profile, DAILY_COLLECTION, MINUTE_COLLECTION
from src.db import get_db

router = APIRouter(prefix="/stocks", tags=["bars"])

VALID_RESOLUTIONS = ("1", "5", "10", "15", "30", "60", "D", "W", "M")
VALID_MINUTE_RESOLUTIONS = ("1", "5", "10", "15", "30", "60")


def _aggregate_daily_to_weekly(daily: list[dict]) -> list[dict]:
    """Aggregate daily bars into weekly OHLCV (ISO week)."""
    if not daily:
        return []
    grouped: dict[str, dict] = {}
    for r in daily:
        d = date.fromisoformat(r["date"])
        iso = d.isocalendar()
        week_key = f"{iso[0]}-W{iso[1]:02d}"
        if week_key not in grouped:
            grouped[week_key] = {
                "date": week_key,
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
            }
        else:
            g = grouped[week_key]
            g["high"] = max(g["high"], r["high"])
            g["low"] = min(g["low"], r["low"])
            g["close"] = r["close"]
            g["volume"] += r["volume"]
    return sorted(grouped.values(), key=lambda x: x["date"])


def _aggregate_daily_to_monthly(daily: list[dict]) -> list[dict]:
    """Aggregate daily bars into monthly OHLCV."""
    if not daily:
        return []
    grouped: dict[str, dict] = {}
    for r in daily:
        month_key = r["date"][:7]  # "2024-01"
        if month_key not in grouped:
            grouped[month_key] = {
                "date": month_key,
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
            }
        else:
            g = grouped[month_key]
            g["high"] = max(g["high"], r["high"])
            g["low"] = min(g["low"], r["low"])
            g["close"] = r["close"]
            g["volume"] += r["volume"]
    return sorted(grouped.values(), key=lambda x: x["date"])


@router.get("/{stock_id}/bars")
async def get_bars(
    stock_id: str,
    resolution: str = Query(default="D", description="Bar resolution: 1/5/15/30/60/D/W/M"),
    from_date: str = Query(default=None, alias="from"),
    to_date: str = Query(default=None, alias="to"),
    months: int = Query(default=None, ge=1, le=240),
    days: int = Query(default=None, ge=1, le=60),
):
    """
    Get OHLCV bars for a stock, aggregated by resolution.

    - resolution=D  → daily bars (from stock_daily)
    - resolution=W  → weekly bars (aggregated from daily)
    - resolution=M  → monthly bars (aggregated from daily)
    - resolution=1/5/15/30/60 → minute bars (aggregated from 1m raw)

    Supports either:
      - from/to: explicit date range (ISO format)
      - months: number of months back (daily resolutions only)
      - days: number of days back (minute resolutions only)
    """
    # ── Resolve time range ──
    if resolution in ("D", "W", "M"):
        if from_date and to_date:
            start = from_date
            end_date = date.fromisoformat(to_date)
        elif months:
            end_date = date.today()
            start = (end_date - timedelta(days=months * 35)).isoformat()
        else:
            end_date = date.today()
            start = (end_date - timedelta(days=365)).isoformat()

        # Fetch daily data from ArangoDB (with yfinance fallback)
        req_months = months if months else 12
        daily = fetch_daily_history(stock_id, months=req_months)

        if not daily:
            return []

        # Filter by date range
        daily = [r for r in daily if r["date"] >= start]

        if resolution == "W":
            return _aggregate_daily_to_weekly(daily)
        elif resolution == "M":
            return _aggregate_daily_to_monthly(daily)
        else:
            return daily

    # ── Minute resolutions ──
    if resolution in VALID_MINUTE_RESOLUTIONS:
        req_days = days if days else 7
        interval = f"{resolution}m"

        minute_data = fetch_minute_history(stock_id, interval=interval, days=req_days)

        if from_date and to_date:
            minute_data = [
                r for r in minute_data
                if from_date <= r["datetime"][:10] <= to_date
            ]

        return minute_data

    raise HTTPException(
        status_code=400,
        detail=f"Invalid resolution: {resolution}. Must be one of {VALID_RESOLUTIONS}",
    )


@router.get("/{symbol}/volume-profile")
async def get_volume_profile(
    symbol: str,
    date: str = Query(..., description="Date in YYYY-MM-DD format", pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """
    Get volume profile (market profile) for a stock on a given date.

    Volume profile buckets intraday minute bars by price levels to show
    where trading activity was concentrated.
    """
    return fetch_volume_profile(symbol, date)


@router.get("/{symbol}/data-status")
async def get_data_status(symbol: str):
    """Return daily and minute data status for a stock."""
    db = get_db()

    daily_aql = """
    FOR d IN stock_daily
      FILTER d.stock_id == @symbol
      COLLECT AGGREGATE first = MIN(d.date), last = MAX(d.date), cnt = COUNT(1)
      RETURN { first, last, cnt }
    """
    daily = list(db.aql.execute(daily_aql, bind_vars={"symbol": symbol}))

    minute_aql = """
    FOR d IN stock_minute_1m
      FILTER d.stock_id == @symbol
      COLLECT AGGREGATE first = MIN(d.datetime), last = MAX(d.datetime), cnt = COUNT(1)
      RETURN { first, last, cnt }
    """
    minute = list(db.aql.execute(minute_aql, bind_vars={"symbol": symbol}))

    return {
        "stock_id": symbol,
        "daily": daily[0] if daily else {"first": None, "last": None, "cnt": 0},
        "minute": minute[0] if minute else {"first": None, "last": None, "cnt": 0},
    }
