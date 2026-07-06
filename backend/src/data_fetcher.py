from datetime import date, datetime, timedelta, timezone
from typing import Literal

import yfinance as yf


def _twse_symbol(symbol: str) -> str:
    """Convert plain Taiwan stock symbol to yfinance format."""
    return f"{symbol}.TW"


def _parse_yfinance_index(idx) -> str:
    ts = idx.tz_localize(None) if idx.tzinfo else idx
    return ts.strftime("%Y-%m-%d")


def fetch_daily_history(
    symbol: str,
    months: int = 6,
) -> list[dict]:
    ticker = yf.Ticker(_twse_symbol(symbol))
    end = date.today()
    start = end - timedelta(days=months * 35)
    hist = ticker.history(start=start.isoformat(), end=end.isoformat())
    if hist.empty:
        return []
    records = []
    for dt, row in hist.iterrows():
        close_val = float(row["Close"])
        if close_val != close_val:
            continue
        records.append({
            "date": _parse_yfinance_index(dt),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(close_val, 2),
            "volume": int(row["Volume"]),
        })
    return records


def fetch_minute_history(
    symbol: str,
    interval: Literal["1m", "5m", "10m", "15m", "30m", "60m"] = "5m",
    days: int = 30,
) -> list[dict]:
    ticker = yf.Ticker(_twse_symbol(symbol))
    hist = ticker.history(period=f"{days}d", interval=interval)
    if hist.empty:
        return []
    records = []
    for dt, row in hist.iterrows():
        close_val = float(row["Close"])
        if close_val != close_val:
            continue
        records.append({
            "datetime": dt.strftime("%Y-%m-%d %H:%M:%S"),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(close_val, 2),
            "volume": int(row["Volume"]),
        })
    return records
