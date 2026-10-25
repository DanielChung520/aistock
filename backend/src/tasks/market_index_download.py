"""Celery tasks: market index daily OHLCV download.

Two jobs (see scheduler.py PREDEFINED_JOBS):
  1. market_index_backfill — one-shot 2y backfill for all enabled indices
  2. market_index_daily    — daily incremental (last 10 days, idempotent)

The index list lives in the `market_index_list` collection, maintained from
the frontend 功能設置 (指數清單) via /api/market-indices. Only indices with
enabled=true are downloaded. Data is upserted into `market_index_daily`
with key `{symbol}_{date}`.
"""
from __future__ import annotations

import logging
import traceback
from datetime import date, datetime, timedelta, timezone

from src.celery_app import celery_app

logger = logging.getLogger(__name__)

INDEX_LIST_COLLECTION = "market_index_list"
INDEX_DAILY_COLLECTION = "market_index_daily"

BACKFILL_DAYS = 730  # 2y model-training window (user decision)
INCREMENT_DAYS = 10  # refetch last 10 days (covers today + holidays)

# Default index list (mirrors frontend /api/market-indices seed).
DEFAULT_INDICES = [
    {"symbol": "TWII", "yfSymbol": "^TWII", "name": "加權指數", "category": "台股"},
    {"symbol": "TWO", "yfSymbol": "0051.TW", "name": "櫃買指數", "category": "台股"},
    {"symbol": "N225", "yfSymbol": "^N225", "name": "日經 225", "category": "亞股"},
    {"symbol": "HSI", "yfSymbol": "^HSI", "name": "恆生指數", "category": "亞股"},
    {"symbol": "SSE", "yfSymbol": "000001.SS", "name": "上證指數", "category": "亞股"},
    {"symbol": "KS11", "yfSymbol": "^KS11", "name": "韓國 KOSPI", "category": "亞股"},
    {"symbol": "SOX", "yfSymbol": "^SOX", "name": "費城半導體", "category": "美股"},
    {"symbol": "IXIC", "yfSymbol": "^IXIC", "name": "那斯達克指數", "category": "美股"},
    {"symbol": "GSPC", "yfSymbol": "^GSPC", "name": "標普 500", "category": "美股"},
    {"symbol": "DJI", "yfSymbol": "^DJI", "name": "道瓊工業指數", "category": "美股"},
]


def _seed_default_indices() -> None:
    from src.db import get_db

    db = get_db()
    col = db.collection(INDEX_LIST_COLLECTION)
    if col.count() == 0:
        now = datetime.now(timezone.utc).timestamp()
        for i, idx in enumerate(DEFAULT_INDICES):
            col.insert({
                "_key": idx["symbol"],
                "symbol": idx["symbol"],
                "yfSymbol": idx["yfSymbol"],
                "name": idx["name"],
                "category": idx["category"],
                "enabled": True,
                "sortOrder": i,
                "createdAt": now,
                "updatedAt": now,
            })
        return

    # 修正已知失效代號（^TWO 於 yfinance 已 delisted，改用 0051.TW 追蹤櫃買指數）
    doc = col.get("TWO")
    if doc and doc.get("yfSymbol") == "^TWO":
        col.update({
            "_key": "TWO",
            "yfSymbol": "0051.TW",
            "updatedAt": datetime.now(timezone.utc).timestamp(),
        })


def _enabled_indices() -> list[dict]:
    from src.db import get_db

    db = get_db()
    cursor = db.aql.execute(
        f"""
        FOR i IN {INDEX_LIST_COLLECTION}
          FILTER i.enabled == true
          SORT i.sortOrder ASC
          RETURN i
        """
    )
    return list(cursor)


# TW indices that Fubon serves; foreign indices stay on yfinance (not offered).
FUBON_INDEX_MAP = {"TWII": "IX0001", "TWO": "IX0043"}


def _fetch_index_rows(symbol: str, yf_symbol: str, start: date, end: date) -> list[dict]:
    """Fetch daily OHLCV rows: Fubon for TW indices, yfinance otherwise."""
    fubon_symbol = FUBON_INDEX_MAP.get(symbol)
    if fubon_symbol:
        try:
            from src import fubon_market

            rows = fubon_market.fetch_daily(fubon_symbol, start.isoformat(), end.isoformat())
            if rows:
                return rows
        except fubon_market.FubonUnavailable as exc:
            logger.warning("Fubon index %s unavailable (%s); using yfinance", symbol, exc)

    import yfinance as yf

    ticker = yf.Ticker(yf_symbol)
    hist = ticker.history(start=start.isoformat(), end=end.isoformat(), auto_adjust=False)
    if hist.empty:
        return []

    rows: list[dict] = []
    for dt, r in hist.iterrows():
        try:
            close_val = float(r["Close"])
            if close_val != close_val:
                continue
            rows.append({
                "date": dt.strftime("%Y-%m-%d"),
                "open": round(float(r["Open"]), 2),
                "high": round(float(r["High"]), 2),
                "low": round(float(r["Low"]), 2),
                "close": round(close_val, 2),
                "volume": int(r["Volume"]),
            })
        except Exception:
            continue
    return rows


def _upsert_index_rows(symbol: str, name: str, yf_symbol: str, rows: list[dict]) -> int:
    from arango.exceptions import ArangoError

    from src.db import get_db

    if not rows:
        return 0
    db = get_db()
    col = db.collection(INDEX_DAILY_COLLECTION)
    written = 0
    for r in rows:
        doc = {
            "_key": f"{symbol}_{r['date']}",
            "symbol": symbol,
            "name": name,
            "yf_symbol": yf_symbol,
            **r,
        }
        try:
            col.insert(doc, overwrite=True)
            written += 1
        except ArangoError:
            pass
    return written


def _run_index_job(days: int) -> dict:
    from src.db import ensure_collection, get_db

    ensure_collection(INDEX_LIST_COLLECTION)
    ensure_collection(INDEX_DAILY_COLLECTION)
    _seed_default_indices()

    end = date.today()
    start = end - timedelta(days=days)

    indices = _enabled_indices()
    if not indices:
        logger.warning("market_index: no enabled indices in %s", INDEX_LIST_COLLECTION)
        return {"indices": 0, "written": 0, "ok": 0}

    results = []
    for idx in indices:
        symbol = idx.get("symbol") or idx.get("_key")
        yf_symbol = idx.get("yfSymbol") or symbol
        name = idx.get("name") or symbol
        try:
            rows = _fetch_index_rows(symbol, yf_symbol, start, end)
            written = _upsert_index_rows(symbol, name, yf_symbol, rows)
            results.append({"symbol": symbol, "written": written})
            logger.info("market_index %s: written=%s", symbol, written)
        except Exception as exc:
            logger.error("market_index %s failed: %s\n%s", symbol, exc, traceback.format_exc())
            results.append({"symbol": symbol, "error": str(exc)})

    return {
        "indices": len(results),
        "written": sum(r.get("written", 0) for r in results),
        "ok": sum(1 for r in results if "error" not in r),
        "results": results,
    }


@celery_app.task
def market_index_backfill() -> dict:
    """One-shot 2y backfill of daily OHLCV for all enabled indices."""
    return _run_index_job(BACKFILL_DAYS)


@celery_app.task
def market_index_daily() -> dict:
    """Daily incremental download for all enabled indices (idempotent)."""
    return _run_index_job(INCREMENT_DAYS)
