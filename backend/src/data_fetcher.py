import logging
from datetime import date, datetime, timedelta, timezone
from typing import Literal

import twstock
import yfinance as yf
from arango.exceptions import ArangoError

from src.db import get_db

logger = logging.getLogger(__name__)

DAILY_COLLECTION = "stock_daily"
MINUTE_COLLECTION = "stock_minute_1m"
MINUTE_15M_COLLECTION = "stock_minute_15m"
VP_COLLECTION = "stock_vp_daily"

# yfinance hard limit: 15m interval returns at most 60 days of history
YF_15M_MAX_DAYS = 60


def _twse_symbol(symbol: str) -> str:
    """Convert plain Taiwan stock symbol to yfinance format."""
    return f"{symbol}.TW"


def _yf_symbol(symbol: str) -> str:
    """yfinance ticker with correct exchange suffix (.TW vs .TWO).

    Unlike _twse_symbol, this picks the suffix from twstock, because
    TPEx (上櫃) stocks only return data under .TWO — .TW is silently empty.
    """
    info = twstock.codes.get(symbol)
    if info is not None and info.market == "上櫃":
        return f"{symbol}.TWO"
    return f"{symbol}.TW"


def _parse_yfinance_index(idx) -> str:
    ts = idx.tz_localize(None) if idx.tzinfo else idx
    return ts.strftime("%Y-%m-%d")


def _merge_sorted(cached: list[dict], incoming: list[dict], key: str) -> list[dict]:
    """Merge ``incoming`` bars into ``cached``, de-duplicated by ``key`` and sorted ascending.

    ``cached`` comes from ArangoDB already ordered; ``incoming`` is freshly fetched
    from yfinance. Blindly appending ``incoming`` onto ``cached`` leaves the result
    out of order whenever yfinance returns a bar older than a cached row (e.g. a
    real early bar such as 2007-12-31 inside a 200-month window). The frontend feeds
    this straight to lightweight-charts' ``setData``, which asserts strictly
    ascending time and throws otherwise — blanking the whole chart. Re-sorting here
    is what keeps the payload valid.
    """
    seen = {r[key] for r in cached}
    merged = list(cached)
    for r in incoming:
        if r[key] not in seen:
            seen.add(r[key])
            merged.append(r)
    merged.sort(key=lambda r: r[key])
    return merged


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

    for col_name in (MINUTE_COLLECTION, MINUTE_15M_COLLECTION):
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


def _store_minute(symbol: str, records: list[dict], collection: str = MINUTE_COLLECTION) -> None:
    """Upsert minute records (1m or 15m) into the given ArangoDB collection."""
    db = get_db()
    col = db.collection(collection)
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


def store_minute_15m(symbol: str, records: list[dict]) -> None:
    """Upsert 15m bars into ArangoDB stock_minute_15m (public: used by scripts/download_15m.py)."""
    if records:
        _store_minute(symbol, records, collection=MINUTE_15M_COLLECTION)


# ── Source adapters: Fubon first, yfinance fallback ───────────

def _fubon_daily(symbol: str, start: str, end: str) -> list[dict] | None:
    """Daily bars from Fubon; None means yfinance fallback."""
    try:
        from src import fubon_market

        records = fubon_market.fetch_daily(symbol, start, end)
        return records or None
    except fubon_market.FubonUnavailable as exc:
        logger.warning("Fubon daily unavailable for %s (%s); using yfinance", symbol, exc)
        return None


def _fubon_minute(symbol: str, timeframe: str, start: str, end: str) -> list[dict] | None:
    """Minute bars from Fubon (with a `datetime` key); None means yfinance fallback."""
    try:
        from src import fubon_market

        records = fubon_market.fetch_candles(symbol, timeframe, start, end)
        if not records:
            return None
        return [
            {
                "datetime": r["date"],
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
            }
            for r in records
        ]
    except fubon_market.FubonUnavailable as exc:
        logger.warning("Fubon %sm unavailable for %s (%s); using yfinance", timeframe, symbol, exc)
        return None


def _yf_daily_records(symbol: str, start: str, end: str) -> list[dict]:
    ticker = yf.Ticker(_twse_symbol(symbol))
    # auto_adjust=False keeps RAW prices consistent with Fubon and the bulk backfill.
    hist = ticker.history(start=start, end=end, auto_adjust=False)
    records: list[dict] = []
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

    # Prefer Fubon; fall back to yfinance only when Fubon is unavailable.
    records = _fubon_daily(symbol, start.isoformat(), end.isoformat())
    if records is None:
        records = _yf_daily_records(symbol, start.isoformat(), end.isoformat())
    if not records:
        return cached if cached else []

    # Merge with cached (avoid duplicates), keeping strict ascending date order
    cached_dates = {r["date"] for r in cached}
    merged = _merge_sorted(cached, records, "date")

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
        # Prefer Fubon 1m; fall back to yfinance (max 7 days for interval="1m").
        fresh = _fubon_minute(symbol, "1", start_str, end.isoformat())
        if fresh is None:
            ticker = yf.Ticker(_twse_symbol(symbol))
            period = f"{min(days, 7)}d"
            hist = ticker.history(period=period, interval="1m")
            fresh = []
            for dt, row in hist.iterrows():
                close_val = float(row["Close"])
                if close_val != close_val:
                    continue
                fresh.append({
                    "datetime": dt.strftime("%Y-%m-%d %H:%M:%S"),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(close_val, 2),
                    "volume": int(row["Volume"]),
                })

        if fresh:
            cached_dts = {r["datetime"] for r in cached_1m}
            new_records = [r for r in fresh if r["datetime"] not in cached_dts]
            if new_records:
                _store_minute(symbol, new_records)
            cached_1m = _merge_sorted(cached_1m, fresh, "datetime")

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


# ── 15m history (dedicated stock_minute_15m dataset) ───────────

def fetch_15m_history(symbol: str, days: int = YF_15M_MAX_DAYS) -> list[dict]:
    """Cache-through fetch of 15m bars into stock_minute_15m.

    days is clamped to YF_15M_MAX_DAYS (60) — yfinance returns nothing beyond that
    for interval="15m". Freshness rule mirrors fetch_minute_history: refetch when
    the latest cached bar is older than 1 hour.
    """
    _ensure_collections()
    db = get_db()
    days = max(1, min(days, YF_15M_MAX_DAYS))
    # yfinance rejects any 15m range > 60 days; end is exclusive (today+1),
    # so start must be today-(days-1) to keep the range within `days`.
    start_str = (date.today() - timedelta(days=days - 1)).isoformat()

    aql = """
    FOR d IN stock_minute_15m
      FILTER d.stock_id == @symbol AND d.datetime >= @start
      SORT d.datetime ASC
      RETURN { datetime: d.datetime, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }
    """
    cursor = db.aql.execute(aql, bind_vars={"symbol": symbol, "start": start_str})
    cached = list(cursor)

    stale_before = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    if cached and cached[-1]["datetime"] >= stale_before:
        return cached

    # Prefer Fubon 15m; fall back to yfinance (interval="15m").
    end_str = (date.today() + timedelta(days=1)).isoformat()
    yf_records = _fubon_minute(symbol, "15", start_str, end_str)
    if yf_records is None:
        ticker = yf.Ticker(_yf_symbol(symbol))
        hist = ticker.history(start=start_str, end=end_str, interval="15m", auto_adjust=False)
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

    if not yf_records:
        return cached

    cached_dts = {r["datetime"] for r in cached}
    new_records = [r for r in yf_records if r["datetime"] not in cached_dts]
    if new_records:
        store_minute_15m(symbol, new_records)

    return _merge_sorted(cached, yf_records, "datetime")


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
