"""Live intraday feed — Fubon Neo realtime WebSocket, shared by index + stocks.

Fubon's ``candles`` channel streams **1-minute** bars for any symbol (index or
stock) regardless of the requested timeframe (verified 2026-10: ``timeframe`` is
ignored and the snapshot always reports ``"timeframe": "1"``). This module keeps
today's 1m bars per subscribed symbol and aggregates on read.

Subscriptions are **interest-driven**: a symbol is subscribed only while it has an
open SSE listener or a recent HTTP read, so just the symbols actually being
watched consume the upstream realtime feed. ``TAIEX_INDEX_SYMBOL`` is permanent.

The FastAPI lifespan (``src/main.py``) owns :meth:`start` / :meth:`stop`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from typing import Any

from src import fubon_market

logger = logging.getLogger(__name__)

# Asia/Taipei is fixed UTC+8 (no DST), so a static offset is safe here.
TW_TZ = timezone(timedelta(hours=8))

_SESSION_START_MIN = 9 * 60  # 09:00
_SESSION_END_MIN = 13 * 60 + 35  # 13:35 (a few minutes past the 13:30 close)
_SUPERVISE_INTERVAL_SECONDS = 5
_AUTH_TIMEOUT_SECONDS = 10
_SILENCE_RECONNECT_SECONDS = 300  # reconnect if nothing arrives mid-session

TAIEX_INDEX_SYMBOL = "IX0001"
DEFAULT_HTTP_INTEREST_SECONDS = 120


def is_tw_market_open(now: datetime | None = None) -> bool:
    """True during the TW continuous session (Mon–Fri 09:00–13:35 Taipei)."""
    current = (now or datetime.now(TW_TZ)).astimezone(TW_TZ)
    if current.weekday() >= 5:  # Sat / Sun
        return False
    minutes = current.hour * 60 + current.minute
    return _SESSION_START_MIN <= minutes <= _SESSION_END_MIN


def _parse_bar_datetime(raw: Any) -> datetime | None:
    if raw is None:
        return None
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TW_TZ)
    return parsed.astimezone(TW_TZ)


def _bucket_start(moment: datetime, minutes: int) -> datetime:
    """Floor a minute-stamp to the start of its ``minutes`` bucket from the 09:00 open."""
    if minutes <= 1:
        return moment.replace(second=0, microsecond=0)
    offset = moment.hour * 60 + moment.minute - _SESSION_START_MIN
    if offset < 0:
        offset = 0
    bucket = (offset // minutes) * minutes
    total = _SESSION_START_MIN + bucket
    return moment.replace(hour=total // 60, minute=total % 60, second=0, microsecond=0)


def aggregate_bars(bars_1m: dict[str, dict[str, Any]], minutes: int) -> list[dict[str, Any]]:
    """Aggregate 1-minute bars into ``minutes``-sized OHLCV bars (ascending).

    Buckets align to the 09:00 open; open = first bar, close = last, high/low =
    extremes, volume = sum.
    """
    if minutes <= 1:
        return [bars_1m[key] for key in sorted(bars_1m)]

    buckets: dict[str, dict[str, Any]] = {}
    for key in sorted(bars_1m):
        bar = bars_1m[key]
        moment = _parse_bar_datetime(bar.get("date"))
        if moment is None:
            continue
        bucket_key = _bucket_start(moment, minutes).strftime("%Y-%m-%d %H:%M:%S")
        existing = buckets.get(bucket_key)
        if existing is None:
            buckets[bucket_key] = {
                "date": bucket_key,
                "open": float(bar["open"]),
                "high": float(bar["high"]),
                "low": float(bar["low"]),
                "close": float(bar["close"]),
                "volume": int(bar.get("volume") or 0),
            }
        else:
            existing["high"] = max(existing["high"], float(bar["high"]))
            existing["low"] = min(existing["low"], float(bar["low"]))
            existing["close"] = float(bar["close"])
            existing["volume"] += int(bar.get("volume") or 0)

    return [buckets[key] for key in sorted(buckets)]


def _to_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


class LiveCandleFeed:
    """Per-symbol keeper of today's live 1m bars, sourced from the Fubon WS.

    Thread model: SDK callbacks fire on the SDK's thread, so feed state is guarded
    by ``_lock`` and SSE subscribers are woken via ``loop.call_soon_threadsafe``.
    ``start``/``stop`` must run on the app's asyncio loop (FastAPI lifespan does).
    """

    def __init__(self, permanent_symbols: Iterable[str] = ()) -> None:
        self._permanent = {str(s) for s in permanent_symbols}
        self._bars: dict[str, dict[str, dict[str, Any]]] = {}
        self._last_update: dict[str, float] = {}
        self._interest: dict[str, float] = {}
        self._listeners: dict[str, set[asyncio.Queue[None]]] = {}
        self._subscribed: set[str] = set()
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task[None] | None = None
        self._ws: Any = None
        self._connected = False
        self._auth_event = threading.Event()
        self._running = False
        self._last_message_ts: float = 0.0

    def start(self) -> None:
        if self._running:
            return
        self._loop = asyncio.get_running_loop()
        self._running = True
        self._task = self._loop.create_task(self._supervise())
        logger.info("LiveCandleFeed started (permanent=%s)", sorted(self._permanent))

    def stop(self) -> None:
        self._running = False
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
        self._close_ws(drop_client=True)
        logger.info("LiveCandleFeed stopped")

    # ── reads ──────────────────────────────────────────────────

    def get_bars(self, symbol: str, minutes: int = 10) -> list[dict[str, Any]]:
        with self._lock:
            snapshot = dict(self._bars.get(symbol, {}))
        return aggregate_bars(snapshot, minutes)

    def last_bar(self, symbol: str) -> dict[str, Any] | None:
        with self._lock:
            bars = self._bars.get(symbol)
        if not bars:
            return None
        return bars[max(bars)]

    def day_volume(self, symbol: str) -> int:
        with self._lock:
            bars = self._bars.get(symbol)
        if not bars:
            return 0
        return sum(int(b.get("volume") or 0) for b in bars.values())

    def today_daily_bar(self, symbol: str) -> dict[str, Any] | None:
        """Today's live daily bar, aggregated from the session's 1m bars."""
        with self._lock:
            bars = self._bars.get(symbol)
        if not bars:
            return None
        keys = sorted(bars)
        return {
            "date": keys[0][:10],
            "open": bars[keys[0]]["open"],
            "high": max(b["high"] for b in bars.values()),
            "low": min(b["low"] for b in bars.values()),
            "close": bars[keys[-1]]["close"],
            "volume": sum(int(b.get("volume") or 0) for b in bars.values()),
        }

    def is_streaming(self, symbol: str | None = None) -> bool:
        if symbol is None:
            return bool(self._subscribed)
        return symbol in self._subscribed

    # ── interest / listeners ───────────────────────────────────

    def ensure(self, symbol: str, ttl: int = DEFAULT_HTTP_INTEREST_SECONDS) -> None:
        """Mark ``symbol`` as wanted for ``ttl`` seconds (HTTP reads / fallback)."""
        with self._lock:
            self._interest[symbol] = time.time() + ttl

    def add_listener(self, symbol: str, queue: asyncio.Queue[None]) -> None:
        with self._lock:
            self._listeners.setdefault(symbol, set()).add(queue)

    def remove_listener(self, symbol: str, queue: asyncio.Queue[None]) -> None:
        with self._lock:
            queues = self._listeners.get(symbol)
            if queues is not None:
                queues.discard(queue)
                if not queues:
                    self._listeners.pop(symbol, None)

    def _desired_symbols(self) -> set[str]:
        if not is_tw_market_open():
            return set()
        now = time.time()
        with self._lock:
            desired = set(self._permanent)
            desired |= {sym for sym, exp in self._interest.items() if exp > now}
            desired |= set(self._listeners)
        return desired

    def _notify(self, symbol: str) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        with self._lock:
            queues = list(self._listeners.get(symbol, ()))
        for queue in queues:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, None)
            except (asyncio.QueueFull, RuntimeError):
                pass

    # ── websocket callbacks (SDK thread) ───────────────────────

    def _on_message(self, message: Any) -> None:
        self._last_message_ts = time.time()
        try:
            payload = json.loads(message) if isinstance(message, str) else message
        except (TypeError, ValueError):
            return
        if not isinstance(payload, dict):
            return
        event = payload.get("event")
        if event == "authenticated":
            self._auth_event.set()
            return
        data = payload.get("data")
        if not isinstance(data, dict):
            return
        symbol = data.get("symbol")
        if not isinstance(symbol, str):
            return
        if event == "snapshot":
            self._ingest_snapshot(symbol, data)
        elif event == "data":
            self._ingest_bar(symbol, data)

    def _ingest_snapshot(self, symbol: str, data: dict[str, Any]) -> None:
        rows = data.get("data")
        if not isinstance(rows, list):
            return
        bars: dict[str, dict[str, Any]] = {}
        for row in rows:
            bar = self._normalize(row)
            if bar is not None:
                bars[bar["date"]] = bar
        with self._lock:
            self._bars[symbol] = bars
        self._last_update[symbol] = time.time()
        self._notify(symbol)

    def _ingest_bar(self, symbol: str, data: dict[str, Any]) -> None:
        bar = self._normalize(data)
        if bar is None:
            return
        with self._lock:
            self._bars.setdefault(symbol, {})[bar["date"]] = bar
        self._last_update[symbol] = time.time()
        self._notify(symbol)

    @staticmethod
    def _normalize(row: Any) -> dict[str, Any] | None:
        if not isinstance(row, dict):
            return None
        moment = _parse_bar_datetime(row.get("date"))
        if moment is None or row.get("close") is None:
            return None
        close = _to_float(row.get("close"), float("nan"))
        if close != close:  # NaN guard
            return None
        return {
            "date": moment.strftime("%Y-%m-%d %H:%M:%S"),
            "open": _to_float(row.get("open"), close),
            "high": _to_float(row.get("high"), close),
            "low": _to_float(row.get("low"), close),
            "close": close,
            "volume": int(_to_float(row.get("volume"), 0)),
        }

    # ── supervision loop ───────────────────────────────────────

    async def _supervise(self) -> None:
        try:
            while self._running:
                try:
                    await asyncio.to_thread(self._sync)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.warning("LiveCandleFeed sync error: %s", exc)
                await asyncio.sleep(_SUPERVISE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            self._close_ws(drop_client=True)
            raise

    def _sync(self) -> None:
        desired = self._desired_symbols()
        if not desired:
            if self._subscribed:
                self._close_ws(drop_client=False)
            return

        silent = time.time() - self._last_message_ts > _SILENCE_RECONNECT_SECONDS
        if self._subscribed and silent:
            self._close_ws(drop_client=False)

        ws = self._ensure_ws()
        if ws is None:
            return

        for symbol in sorted(self._subscribed - desired):
            try:
                ws.unsubscribe({"channel": "candles", "symbol": symbol, "timeframe": "1"})
            except Exception as exc:  # best effort
                logger.debug("unsubscribe %s failed: %s", symbol, exc)
            self._subscribed.discard(symbol)
            with self._lock:
                self._bars.pop(symbol, None)
                self._last_update.pop(symbol, None)

        for symbol in sorted(desired - self._subscribed):
            try:
                ws.subscribe({"channel": "candles", "symbol": symbol, "timeframe": "1"})
                self._subscribed.add(symbol)
            except Exception as exc:
                logger.warning("subscribe %s failed: %s", symbol, exc)

    def _ensure_ws(self) -> Any:
        if self._ws is None:
            try:
                ws = fubon_market.get_realtime_stock_ws()
            except fubon_market.FubonUnavailable as exc:
                logger.warning("LiveCandleFeed unavailable: %s", exc)
                return None
            ws.on("message", self._on_message)
            self._ws = ws
            self._connected = False
        if not self._connected:
            self._auth_event.clear()
            try:
                self._ws.connect()
            except Exception as exc:  # tolerate "already connected" style errors
                logger.debug("ws.connect() raised (continuing): %s", exc)
            self._auth_event.wait(timeout=_AUTH_TIMEOUT_SECONDS)
            self._connected = True
        return self._ws

    def _close_ws(self, drop_client: bool) -> None:
        ws = self._ws
        self._subscribed.clear()
        self._connected = False
        self._auth_event.clear()
        if ws is not None:
            try:
                ws.disconnect()
            except Exception as exc:  # best effort
                logger.debug("ws.disconnect() error: %s", exc)
        if drop_client:
            self._ws = None


_feed: LiveCandleFeed | None = None


def get_live_feed() -> LiveCandleFeed:
    """Return the process-wide :class:`LiveCandleFeed` (index permanent)."""
    global _feed
    if _feed is None:
        _feed = LiveCandleFeed(permanent_symbols={TAIEX_INDEX_SYMBOL})
    return _feed
