"""Celery task: precompute the latest technical indicators for watchlist stocks.

For each watchlist stock we fetch daily history, compute the latest MA/KDJ/
RSI/MACD/Bollinger values with src.indicators (G9 — all indicator math lives
in the backend) and UPSERT the snapshot into the stock_indicators collection
keyed by stock_id.
"""

import logging
from datetime import datetime, timezone

from src.celery_app import celery_app
from src.data_fetcher import fetch_daily_history
from src.db import ensure_collection, get_db
from src.indicators import (
    calculate_bollinger,
    calculate_kdj,
    calculate_ma,
    calculate_macd,
    calculate_rsi,
)

logger = logging.getLogger(__name__)

INDICATORS_COLLECTION = "stock_indicators"
MA_PERIODS = (5, 10, 20, 60)
HISTORY_MONTHS = 12  # warmup for MA60 / MACD(26, 9) / Bollinger(20)


def _compute_latest_snapshot(stock_id: str) -> dict | None:
    """Fetch daily history and build the latest indicator snapshot document."""
    data = fetch_daily_history(stock_id, months=HISTORY_MONTHS)
    if not data:
        logger.warning("No daily data for %s; skipping indicators", stock_id)
        return None

    dates = [str(item["date"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]

    ma_all = calculate_ma(dates, closes, list(MA_PERIODS))
    kdj_all = calculate_kdj(dates, highs, lows, closes)
    rsi_all = calculate_rsi(dates, closes)
    macd_all = calculate_macd(dates, closes)
    bollinger_all = calculate_bollinger(dates, closes)

    return {
        "_key": stock_id,
        "stock_id": stock_id,
        "date": dates[-1],
        "close": closes[-1],
        "ma": ma_all[-1],
        "kdj": kdj_all[-1],
        "rsi": rsi_all[-1],
        "macd": macd_all[-1],
        "bollinger": bollinger_all[-1],
        "calculated_at": int(datetime.now(timezone.utc).timestamp()),
    }


@celery_app.task
def precompute_stock_indicators(stock_id: str) -> dict | None:
    """Celery task: compute and store the latest indicator snapshot for a stock."""
    ensure_collection(INDICATORS_COLLECTION)
    try:
        snapshot = _compute_latest_snapshot(stock_id)
    except Exception as exc:
        logger.error("precompute_stock_indicators failed: stock_id=%s, error=%s", stock_id, exc)
        return None
    if snapshot is None:
        return None

    get_db().aql.execute(
        """
        UPSERT { _key: @key }
        INSERT @snapshot
        UPDATE {
            stock_id: @snapshot.stock_id,
            date: @snapshot.date,
            close: @snapshot.close,
            ma: @snapshot.ma,
            kdj: @snapshot.kdj,
            rsi: @snapshot.rsi,
            macd: @snapshot.macd,
            bollinger: @snapshot.bollinger,
            calculated_at: @snapshot.calculated_at
        }
        IN stock_indicators
        """,
        bind_vars={"key": stock_id, "snapshot": snapshot},
    )
    logger.info("Indicators stored: stock_id=%s, date=%s", stock_id, snapshot["date"])
    return snapshot


@celery_app.task
def precompute_watchlist_indicators() -> int:
    """Celery task: dispatch a per-stock precompute for every watchlist stock."""
    db = get_db()
    cursor = db.aql.execute("FOR w IN watchlist RETURN w.stock_id")
    stock_ids = list(cursor)
    for stock_id in stock_ids:
        precompute_stock_indicators.delay(stock_id=stock_id)
    logger.info("Dispatched indicator precompute for %d watchlist stock(s)", len(stock_ids))
    return len(stock_ids)
