"""Celery task: async daily-K backfill for a watchlist stock.

When a stock is added to the watchlist this task fetches its full daily
history back to 2010 via yfinance and merges it into ArangoDB stock_daily,
so the chart and Daniel MA span the whole range. Runs in the background so
the add-watchlist request returns immediately.
"""
from __future__ import annotations

import contextlib
import io
import logging

import yfinance as yf

from src.celery_app import celery_app
from src.db import get_db

logger = logging.getLogger(__name__)

BACKFILL_START = "2010-01-01"
BACKFILL_END = "2030-01-01"


def _suffix(stock_id: str) -> str:
    import twstock

    info = twstock.codes.get(stock_id)
    if info and info.market == "上櫃":
        return ".TWO"
    return ".TW"


def _fetch_daily(symbol: str, start: str, end: str) -> list[dict]:
    try:
        from src import fubon_market

        records = fubon_market.fetch_daily(symbol, start, end)
        if records:
            return records
    except fubon_market.FubonUnavailable as exc:
        logger.warning("Fubon backfill unavailable for %s (%s); using yfinance", symbol, exc)
    return _fetch_daily_yfinance(symbol, start, end)


def _fetch_daily_yfinance(symbol: str, start: str, end: str) -> list[dict]:
    # yfinance probes sys.stdout.readable(), which Celery replaces with a
    # LoggingProxy that has no readable() — silence stdout while fetching.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        ticker = yf.Ticker(f"{symbol}{_suffix(symbol)}")
        hist = ticker.history(start=start, end=end, auto_adjust=False)
    records: list[dict] = []
    for dt, row in hist.iterrows():
        close_val = float(row["Close"])
        if close_val != close_val:
            continue
        ts = dt
        if getattr(ts, "tzinfo", None) is not None:
            ts = ts.tz_localize(None)
        records.append(
            {
                "date": ts.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(close_val, 2),
                "volume": int(row["Volume"]),
            }
        )
    return records


def backfill_daily_history_sync(stock_id: str) -> dict:
    """Backfill one stock's daily history into ArangoDB. Returns stats."""
    db = get_db()
    col = db.collection("stock_daily")
    existing = {
        str(r)
        for r in db.aql.execute(
            "FOR d IN stock_daily FILTER d.stock_id == @s RETURN d.date",
            bind_vars={"s": stock_id},
        )
    }
    fetched = _fetch_daily(stock_id, BACKFILL_START, BACKFILL_END)
    added = 0
    for r in fetched:
        if r["date"] in existing:
            continue
        doc = {"_key": f"{stock_id}_{r['date']}", "stock_id": stock_id, **r}
        try:
            col.insert(doc, overwrite=False)
            added += 1
        except Exception:
            pass
    return {
        "stock_id": stock_id,
        "fetched": len(fetched),
        "existing": len(existing),
        "added": added,
    }


@celery_app.task
def backfill_daily_history(stock_id: str) -> dict:
    logger.info("backfill_daily_history start: %s", stock_id)
    try:
        result = backfill_daily_history_sync(stock_id)
    except Exception as exc:
        logger.error("backfill_daily_history failed: %s, error=%s", stock_id, exc)
        return {"stock_id": stock_id, "error": str(exc)}
    logger.info(
        "backfill_daily_history done: %s, fetched=%d, added=%d",
        stock_id,
        result["fetched"],
        result["added"],
    )
    return result
