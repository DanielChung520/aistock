"""Fubon Neo API market-data adapter.

Wraps ``fubon_neo``'s marketdata REST client:

* one process-wide, thread-safe login (reused by FastAPI and Celery),
* ``fetch_candles`` paginates the "< 1 year per request" limit, throttles to the
  60 req/min historical-data limit, and normalizes DESC → ASC plus field shapes.

Callers treat :class:`FubonUnavailable` as "fall back to yfinance".
"""

from __future__ import annotations

import logging
import math
import os
import threading
import time
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]

# Fubon/Fugle hard limit: one historical request may span < 1 year.
# 330 days leaves margin so leap years never trip the check.
_MAX_CHUNK_DAYS = 330
# 歷史行情 limit is 60 req/min; stay under it with headroom.
_RATE_PER_MIN = 55
_MAX_RETRIES = 4
_RETRY_SLEEP = 61  # a 429 clears after the 1-minute window

_DAILY_TIMEFRAMES = {"D", "W", "M"}

_env_loaded = False


class FubonUnavailable(Exception):
    """Raised when Fubon cannot serve data; callers should fall back to yfinance."""


# ── Thread-safe SDK singleton ──────────────────────────────────

_sdk_lock = threading.Lock()
_rest_client = None


def _load_env() -> None:
    global _env_loaded
    if not _env_loaded:
        load_dotenv(REPO_ROOT / ".env")
        _env_loaded = True


def _cert_path() -> str:
    raw = os.environ["FUBON_CERT_PATH"]
    path = Path(raw)
    return str(path if path.is_absolute() else (REPO_ROOT / path).resolve())


def get_rest_client():
    """Return a logged-in Fubon marketdata REST client (memoized, thread-safe)."""
    global _rest_client
    if _rest_client is not None:
        return _rest_client
    with _sdk_lock:
        if _rest_client is not None:
            return _rest_client
        _load_env()
        try:
            from fubon_neo.sdk import FubonSDK

            sdk = FubonSDK()
            # is_success is False until the API declaration is activated, but market
            # data works regardless — only a missing marketdata client is fatal.
            sdk.login(
                os.environ["FUBON_PERSONAL_ID"],
                os.environ["FUBON_PASSWORD"],
                _cert_path(),
                os.environ.get("FUBON_CERT_PASSWORD") or None,
            )
            sdk.init_realtime()
        except Exception as exc:
            raise FubonUnavailable(f"Fubon login/init failed: {exc}") from exc

        marketdata = getattr(sdk, "marketdata", None)
        if marketdata is None:
            raise FubonUnavailable("Fubon marketdata unavailable after init_realtime()")
        _rest_client = marketdata.rest_client.stock
        logger.info("Fubon marketdata client initialized")
        return _rest_client


def reset_client() -> None:
    """Drop the cached client (tests / reconnect)."""
    global _rest_client
    with _sdk_lock:
        _rest_client = None


# ── Rate limiting ──────────────────────────────────────────────

class _TokenBucket:
    """Simple monotonic-clock token bucket guaranteeing an average rate."""

    def __init__(self, rate_per_min: int) -> None:
        self._interval = 60.0 / rate_per_min
        self._lock = threading.Lock()
        self._next_at = 0.0

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = self._next_at - now
            if wait > 0:
                time.sleep(wait)
                now = time.monotonic()
            self._next_at = max(now, self._next_at) + self._interval


_bucket = _TokenBucket(_RATE_PER_MIN)


# ── Helpers ────────────────────────────────────────────────────

def _to_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(result) else result


def _normalize_date(raw: object, timeframe: str) -> str:
    if timeframe in _DAILY_TIMEFRAMES:
        return str(raw)[:10]  # YYYY-MM-DD
    try:
        return datetime.fromisoformat(str(raw)).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return str(raw).replace("T", " ")[:19]


def _normalize_row(item: dict, timeframe: str) -> dict | None:
    """Normalize one candle; None when it has no usable close (halted/no-trade day)."""
    raw_date = item.get("date")
    close = _to_float(item.get("close"))
    if raw_date is None or close is None:
        return None
    open_ = _to_float(item.get("open"))
    high_ = _to_float(item.get("high"))
    low_ = _to_float(item.get("low"))
    volume = _to_float(item.get("volume"))
    return {
        "date": _normalize_date(raw_date, timeframe),
        "open": open_ if open_ is not None else close,
        "high": high_ if high_ is not None else close,
        "low": low_ if low_ is not None else close,
        "close": close,
        "volume": int(volume) if volume is not None else 0,
    }


def _chunks(start: date, end: date, span_days: int) -> Iterator[tuple[date, date]]:
    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=span_days - 1), end)
        yield current, chunk_end
        current = chunk_end + timedelta(days=1)


def _request(rest, symbol: str, timeframe: str, frm: str, to: str) -> list[dict]:
    """One throttled historical-candles call, with 429 backoff.

    A "Resource Not Found" (no data in that window, e.g. deep minute history)
    yields an empty list rather than aborting the whole fetch.
    """
    last_exc: Exception | None = None
    for _ in range(_MAX_RETRIES):
        _bucket.acquire()
        try:
            response = rest.historical.candles(
                symbol=symbol, timeframe=timeframe, **{"from": frm, "to": to}
            )
        except Exception as exc:
            message = str(exc)
            if "429" in message or "Rate limit" in message:
                logger.warning("Fubon 429 for %s; sleeping %ss", symbol, _RETRY_SLEEP)
                last_exc = exc
                time.sleep(_RETRY_SLEEP)
                continue
            if "Not Found" in message or "404" in message:
                logger.debug("Fubon no data for %s %s %s~%s", symbol, timeframe, frm, to)
                return []
            raise FubonUnavailable(
                f"Fubon candles {symbol} {timeframe} {frm}~{to}: {exc}"
            ) from exc
        if isinstance(response, dict):
            return list(response.get("data") or [])
        return []

    raise FubonUnavailable(f"Fubon rate-limited after {_MAX_RETRIES} retries: {last_exc}")


# ── Public API ─────────────────────────────────────────────────

def fetch_candles(symbol: str, timeframe: str, start: str, end: str) -> list[dict]:
    """Fetch candles for ``symbol`` over ``[start, end]`` (inclusive), ASC by date.

    ``timeframe`` ∈ {"D","W","M","1","15","60"}. Handles the <1-year pagination,
    the per-request throttle, DESC→ASC reversal and field normalization.
    """
    tf = timeframe.upper()
    rest = get_rest_client()
    start_date = date.fromisoformat(start[:10])
    end_date = date.fromisoformat(end[:10])

    by_date: dict[str, dict] = {}
    for chunk_start, chunk_end in _chunks(start_date, end_date, _MAX_CHUNK_DAYS):
        for item in _request(rest, symbol, tf, chunk_start.isoformat(), chunk_end.isoformat()):
            row = _normalize_row(item, tf)
            if row is not None:
                by_date[row["date"]] = row
    return [by_date[key] for key in sorted(by_date)]


def fetch_daily(symbol: str, start: str, end: str) -> list[dict]:
    return fetch_candles(symbol, "D", start, end)


def fetch_15m(symbol: str, start: str, end: str) -> list[dict]:
    return fetch_candles(symbol, "15", start, end)


def fetch_1m(symbol: str, start: str, end: str) -> list[dict]:
    return fetch_candles(symbol, "1", start, end)
