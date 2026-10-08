from datetime import date, datetime, timedelta, timezone
from typing import Literal

import yfinance as yf
from arango.exceptions import ArangoError

from src.db import get_db

DAILY_COLLECTION = "stock_daily"
MINUTE_COLLECTION = "stock_minute_1m"
VP_COLLECTION = "stock_vp_daily"


def _twse_symbol(symbol: str) -> str:
    """Convert plain Taiwan stock symbol to yfinance format."""
    return f"{symbol}.TW"


def _parse_yfinance_index(idx) -> str:
    ts = idx.tz_localize(None) if idx.tzinfo else idx
    return ts.strftime("%Y-%m-%d")


# ── ArangoDB helpers ──────────────────────────────────────────

def _ensure_collections() -> None:
    """Ensure daily and minute collections exist with appropriate indexes."""
    db = get_db()
    for col_name in (DAILY_COLLECTION,):
        if not db.has_collection(col_name):
            col = db.create_collection(col_name)
        else:
            col = db.collection(col_name)
        existing = [idx["fields"] for idx in col.indexes() if idx["fields"] != ["_key"]]
        if ["stock_id", "date"] not in existing:
            col.add_index({"type": "hash", "fields": ["stock_id", "date"], "unique": True})

    for col_name in (MINUTE_COLLECTION,):
        if not db.has_collection(col_name):
            col = db.create_collection(col_name)
        else:
            col = db.collection(col_name)
        existing = [idx["fields"] for idx in col.indexes() if idx["fields"] != ["_key"]]
        if ["stock_id", "datetime"] not in existing:
            try:
                col.add_index({"type": "hash", "fields": ["stock_id", "datetime"], "unique": True})
            except Exception:
                pass  # index may already exist from previous run

    for col_name in (VP_COLLECTION,):
        if not db.has_collection(col_name):
            col = db.create_collection(col_name)
        else:
            col = db.collection(col_name)
        existing = [idx["fields"] for idx in col.indexes() if idx["fields"] != ["_key"]]
        if ["stock_id", "date"] not in existing:
            try:
                col.add_index({"type": "hash", "fields": ["stock_id", "date"], "unique": True})
            except Exception:
                pass


def _store_daily(symbol: str, records: list[dict]) -> None:
    """Upsert daily records into ArangoDB stock_daily collection.

    Preserves any existing o1/c1 fields on the doc: fetch_daily_history only
    knows OHLCV, but research_ohlcv stores O1/C1 on the same docs (方案A).
    """
    db = get_db()
    col = db.collection(DAILY_COLLECTION)
    for r in records:
        key = f"{symbol}_{r['date']}"
        doc = {
            "_key": key,
            "stock_id": symbol,
            "date": r["date"],
            "open": r["open"],
            "high": r["high"],
            "low": r["low"],
            "close": r["close"],
            "volume": r["volume"],
        }
        existing = col.get(key)
        if existing:
            if existing.get("o1") is not None:
                doc["o1"] = existing["o1"]
            if existing.get("c1") is not None:
                doc["c1"] = existing["c1"]
        try:
            col.insert(doc, overwrite=True)
        except ArangoError:
            pass


def _store_minute(symbol: str, records: list[dict]) -> None:
    """Upsert minute records into ArangoDB stock_minute_1m collection."""
    db = get_db()
    col = db.collection(MINUTE_COLLECTION)
    for r in records:
        key = f"{symbol}_{r['datetime'].replace(' ', '_').replace(':', '')}"
        doc = {
            "_key": key,
            "stock_id": symbol,
            "datetime": r["datetime"],
            "open": r["open"],
            "high": r["high"],
            "low": r["low"],
            "close": r["close"],
            "volume": r["volume"],
        }
        try:
            col.insert(doc, overwrite=True)
        except ArangoError:
            pass


# ── Daily history ─────────────────────────────────────────────

def fetch_daily_history(
    symbol: str,
    months: int = 6,
) -> list[dict]:
    _ensure_collections()
    db = get_db()

    end = date.today() + timedelta(days=1)
    start = end - timedelta(days=months * 35)
    start_str = start.isoformat()

    # Try ArangoDB first
    aql = """
    FOR d IN stock_daily
      FILTER d.stock_id == @symbol AND d.date >= @start
      SORT d.date ASC
      RETURN { date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }
    """
    cursor = db.aql.execute(aql, bind_vars={"symbol": symbol, "start": start_str})
    cached = list(cursor)

    # Check if we have the full range (latest record is recent enough)
    if cached:
        latest = cached[-1]["date"]
        if latest >= (date.today() - timedelta(days=1)).isoformat():
            return cached

    # Fallback to yfinance, then store
    ticker = yf.Ticker(_twse_symbol(symbol))
    # auto_adjust=False keeps RAW (actual traded) prices consistent with the
    # bulk backfill (backfill_daily.py) and 60m o1/c1; the yfinance default
    # (True) back-adjusts dividends, mixing scales inside stock_daily.
    hist = ticker.history(start=start.isoformat(), end=end.isoformat(), auto_adjust=False)
    if hist.empty:
        return cached if cached else []

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

    # Merge with cached (avoid duplicates)
    cached_dates = {r["date"] for r in cached}
    merged = list(cached)
    for r in records:
        if r["date"] not in cached_dates:
            merged.append(r)

    # Store new records back to ArangoDB
    new_records = [r for r in records if r["date"] not in cached_dates]
    if new_records:
        _store_daily(symbol, new_records)

    return merged


# ── Minute history (always stored as 1m raw) ──────────────────

def fetch_minute_history(
    symbol: str,
    interval: Literal["1m", "5m", "10m", "15m", "30m", "60m"] = "5m",
    days: int = 30,
) -> list[dict]:
    # Always fetch 1m raw and aggregate on-the-fly
    _ensure_collections()
    db = get_db()

    end = date.today()
    start = end - timedelta(days=days)
    start_str = start.isoformat()

    # Try ArangoDB for 1m raw data
    aql = """
    FOR d IN stock_minute_1m
      FILTER d.stock_id == @symbol AND d.datetime >= @start
      SORT d.datetime ASC
      RETURN { datetime: d.datetime, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }
    """
    cursor = db.aql.execute(aql, bind_vars={"symbol": symbol, "start": start_str})
    cached_1m = list(cursor)

    if not cached_1m or (cached_1m and cached_1m[-1]["datetime"] < (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")):
        # Fallback to yfinance for 1m data, then store
        ticker = yf.Ticker(_twse_symbol(symbol))
        period = f"{min(days, 7)}d"  # yfinance max for 1m is 7 days
        hist = ticker.history(period=period, interval="1m")
        if not hist.empty:
            yf_records = []
            for dt, row in hist.iterrows():
                close_val = float(row["Close"])
                if close_val != close_val:
                    continue
                yf_records.append({
                    "datetime": dt.strftime("%Y-%m-%d %H:%M:%S"),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(close_val, 2),
                    "volume": int(row["Volume"]),
                })

            cached_dts = {r["datetime"] for r in cached_1m}
            new_records = [r for r in yf_records if r["datetime"] not in cached_dts]
            if new_records:
                _store_minute(symbol, new_records)

            merged_1m = list(cached_1m)
            for r in yf_records:
                if r["datetime"] not in cached_dts:
                    merged_1m.append(r)

            cached_1m = merged_1m

    # Aggregate from 1m to requested interval
    if interval == "1m":
        return cached_1m

    interval_minutes = int(interval.replace("m", ""))
    grouped: dict[str, dict] = {}
    for r in cached_1m:
        dt = datetime.strptime(r["datetime"], "%Y-%m-%d %H:%M:%S")
        # Round down to interval boundary
        total_minutes = dt.hour * 60 + dt.minute
        rounded = total_minutes - (total_minutes % interval_minutes)
        group_key = dt.strftime("%Y-%m-%d") + f" {rounded // 60:02d}:{rounded % 60:02d}:00"

        if group_key not in grouped:
            grouped[group_key] = {
                "datetime": group_key,
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
            }
        else:
            g = grouped[group_key]
            g["high"] = max(g["high"], r["high"])
            g["low"] = min(g["low"], r["low"])
            g["close"] = r["close"]  # last close in the interval
            g["volume"] += r["volume"]

    result = sorted(grouped.values(), key=lambda x: x["datetime"])

    # Apply day-range filter
    range_start = start_str
    result = [r for r in result if r["datetime"] >= range_start]

    return result


# ── Minute indicator data (1m raw, for indicator calculation) ──

def fetch_minute_raw(symbol: str, days: int = 7) -> list[dict]:
    """Fetch raw 1m data (for indicator calculations)."""
    return fetch_minute_history(symbol, interval="1m", days=days)


# ── History cleanup (for scheduled maintenance tasks) ─────────

def purge_old_minute_data(retain_days: int = 14) -> int:
    """Delete minute data older than retain_days. Returns count of deleted docs."""
    db = get_db()
    cutoff = (datetime.now() - timedelta(days=retain_days)).isoformat()
    # Two passes on purpose: ArangoDB drops loop-variable scope after COLLECT,
    # so REMOVE must run in a separate query.
    count_aql = """
    FOR d IN stock_minute_1m
      FILTER d.datetime < @cutoff
      COLLECT WITH COUNT INTO cnt
      RETURN cnt
    """
    delete_aql = """
    FOR d IN stock_minute_1m
      FILTER d.datetime < @cutoff
      REMOVE d IN stock_minute_1m OPTIONS { ignoreErrors: true }
    """
    cursor = db.aql.execute(count_aql, bind_vars={"cutoff": cutoff})
    rows = list(cursor)
    expired = rows[0] if rows else 0
    if expired:
        db.aql.execute(delete_aql, bind_vars={"cutoff": cutoff})
    return expired


# ── Volume Profile ──────────────────────────────────────────


def _auto_bucket_size(price: float) -> float:
    if price < 10:
        return 0.1
    if price < 50:
        return 0.5
    if price < 200:
        return 1.0
    if price < 500:
        return 5.0
    return 10.0


def _round_to_bucket(price: float, bucket: float) -> float:
    return round(round(price / bucket) * bucket, 2)


def fetch_volume_profile(symbol: str, date: str) -> dict:
    db = get_db()

    dt_date = datetime.strptime(date, "%Y-%m-%d")
    start_dt = f"{date} 00:00:00"
    end_dt = (dt_date + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")

    aql = """
    FOR d IN stock_minute_1m
      FILTER d.stock_id == @symbol AND d.datetime >= @start AND d.datetime < @end
      SORT d.datetime ASC
      RETURN { datetime: d.datetime, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }
    """
    cursor = db.aql.execute(aql, bind_vars={"symbol": symbol, "start": start_dt, "end": end_dt})
    bars = list(cursor)

    if not bars:
        return {
            "date": date,
            "bucket_size": 0,
            "price_volume": [],
            "vpoc": None,
            "max_volume": 0,
            "total_volume": 0,
        }

    avg_price = sum((b["high"] + b["low"]) / 2 for b in bars) / len(bars)
    bucket_size = _auto_bucket_size(avg_price)

    price_volume: dict[float, float] = {}

    for bar in bars:
        bar_low = bar["low"]
        bar_high = bar["high"]
        bar_volume = bar["volume"]
        bar_range = bar_high - bar_low

        if bar_range == 0:
            bucket = _round_to_bucket(bar_low, bucket_size)
            price_volume[bucket] = price_volume.get(bucket, 0) + bar_volume
            continue

        start_idx = int(bar_low / bucket_size)
        end_idx = int(bar_high / bucket_size)

        for idx in range(start_idx, end_idx + 1):
            bucket_bottom = round(idx * bucket_size, 2)
            bucket_top = round((idx + 1) * bucket_size, 2)

            overlap_low = max(bar_low, bucket_bottom)
            overlap_high = min(bar_high, bucket_top)
            overlap_height = max(0.0, overlap_high - overlap_low)

            if overlap_height > 0:
                volume_share = bar_volume * (overlap_height / bar_range)
                price_volume[bucket_bottom] = price_volume.get(bucket_bottom, 0) + volume_share

    result = sorted(
        [{"price": p, "volume": round(v, 2)} for p, v in price_volume.items()],
        key=lambda x: x["price"],
    )

    max_vol = max(item["volume"] for item in result) if result else 0
    vpoc = next((item["price"] for item in result if item["volume"] == max_vol), None)
    total_vol = sum(item["volume"] for item in result)

    output = {
        "date": date,
        "bucket_size": bucket_size,
        "price_volume": result,
        "vpoc": vpoc,
        "max_volume": round(max_vol, 2),
        "total_volume": round(total_vol, 2),
    }

    # Write-through to ArangoDB stock_vp_daily
    try:
        vp_col = db.collection(VP_COLLECTION)
        vp_doc = {
            "_key": f"{symbol}_{date}",
            "stock_id": symbol,
            "date": date,
            "bucket_size": output["bucket_size"],
            "price_volume": output["price_volume"],
            "vpoc": output["vpoc"],
            "max_volume": output["max_volume"],
            "total_volume": output["total_volume"],
            "status": "done",
            "calculated_at": int(datetime.now(timezone.utc).timestamp()),
        }
        vp_col.insert(vp_doc, overwrite=True)
    except Exception:
        pass  # non-blocking; computation result is still returned

    return output
