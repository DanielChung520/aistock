import asyncio
import json
import logging
import ssl
from datetime import date, datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from src import fubon_market
from src.realtime.live_feed import TAIEX_INDEX_SYMBOL, get_live_feed
from src.indicators import (
    calculate_bollinger,
    calculate_kdj,
    calculate_ma_daniel,
    calculate_macd,
    calculate_rsi,
    calculate_signal_accuracy,
)

router = APIRouter(prefix="/market", tags=["market"])

logger = logging.getLogger(__name__)

# TWSE 的 SSL 憑證缺少 Subject Key Identifier，Python 3.14+ 預設會拒絕
# 建立寬鬆的 SSL context 來繞過此問題
_twse_ssl_ctx: ssl.SSLContext | None = None

# taiex 資料記憶體快取：TWSE 外部 API 延遲高（實測 ~5s），
# 且盤中資料每 5 分鐘內變化極小，比照 basics.py 的 cache pattern 避免每次打外部 API
_TAIEX_CACHE_TTL_SECONDS = 300
_taiex_cache: dict[int, dict[str, object]] = {}


def _is_taiex_cache_valid(cached_at: float) -> bool:
    return (datetime.now(timezone.utc).timestamp() - cached_at) < _TAIEX_CACHE_TTL_SECONDS


async def _get_taiex_cached(months: int) -> dict[str, object]:
    entry = _taiex_cache.get(months)
    if entry:
        cached_at_raw = entry.get("cached_at")
        cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float) else 0.0
        if _is_taiex_cache_valid(cached_at):
            data = entry.get("data")
            if isinstance(data, dict):
                return data

    data = await _fetch_taiex_data(months=months)
    # 失敗時不回存（避免把 error 塞進 cache 讓使用者看 5 分鐘錯誤）
    if "error" not in data:
        _taiex_cache[months] = {
            "cached_at": datetime.now(timezone.utc).timestamp(),
            "data": data,
        }
    return data


def _get_twse_ssl_context() -> ssl.SSLContext:
    global _twse_ssl_ctx
    if _twse_ssl_ctx is None:
        _twse_ssl_ctx = ssl.create_default_context()
        _twse_ssl_ctx.check_hostname = False
        _twse_ssl_ctx.verify_mode = ssl.CERT_NONE
    return _twse_ssl_ctx


def _parse_number(value: str) -> float:
    return float(value.replace(",", "").strip())


def _gen_month_dates(months: int) -> list[str]:
    today = datetime.now()
    seen: set[str] = set()
    result: list[str] = []
    for i in range(months * 2):
        m = (today.replace(day=1) - timedelta(days=30 * i)).strftime("%Y%m01")
        if m not in seen:
            seen.add(m)
            result.append(m)
        if len(result) >= months:
            break
    return result


async def _fetch_taiex_data(months: int = 2) -> dict[str, object]:
    dates = _gen_month_dates(months)
    all_rows: list[dict[str, object]] = []
    title = "加權指數"

    try:
        async with httpx.AsyncClient(verify=_get_twse_ssl_context()) as client:
            for d in dates:
                url = f"https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date={d}"
                response = await client.get(
                    url,
                    timeout=10.0,
                    headers={
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "application/json",
                    },
                )
                response.raise_for_status()
                payload = response.json()
                if payload.get("stat") == "OK":
                    title = str(payload.get("title", "加權指數"))
                    for row in payload.get("data", []):
                        if isinstance(row, list) and len(row) >= 5:
                            try:
                                date_parts = str(row[0]).strip().split("/")
                                year = int(date_parts[0]) + 1911
                                month = int(date_parts[1])
                                day = int(date_parts[2])
                                all_rows.append(
                                    {
                                        "date": f"{year:04d}-{month:02d}-{day:02d}",
                                        "open": _parse_number(str(row[1])),
                                        "high": _parse_number(str(row[2])),
                                        "low": _parse_number(str(row[3])),
                                        "close": _parse_number(str(row[4])),
                                        "volume": 0,
                                    }
                                )
                            except (ValueError, IndexError):
                                continue
    except (httpx.HTTPError, ValueError, httpx.TimeoutException) as exc:
        return {"title": "加權指數", "data": [], "error": str(exc)}
    except Exception as exc:
        return {"title": "加權指數", "data": [], "error": f"Unexpected error: {str(exc)}"}

    all_rows.sort(key=lambda x: x["date"])  # type: ignore[arg-type]

    # Deduplicate by date (TWSE monthly queries may overlap)
    seen_dates: set[str] = set()
    deduped: list[dict[str, object]] = []
    for row in all_rows:
        d = str(row["date"])
        if d not in seen_dates:
            seen_dates.add(d)
            deduped.append(row)
    all_rows = deduped

    return {
        "title": title,
        "data": all_rows,
    }


@router.get("/taiex")
async def get_taiex(
    months: int = Query(default=2, ge=1, le=120),
) -> dict[str, object]:
    return await _get_taiex_cached(months=months)


@router.get("/taiex/indicators")
async def get_taiex_indicators(
    months: int = Query(default=6, ge=1, le=120),
    ma_periods: str = Query(default="8,21,55,89"),
    ma_type: str = Query(default="sma"),
    ma_lookback: int = Query(default=8, ge=1, le=250),
    ma_cooldown: int = Query(default=1, ge=0, le=50),
    ma_buy_slope_min: float = Query(default=0.05, ge=0.0, le=10.0),
    ma_sell_slope_max: float = Query(default=0.02, ge=0.0, le=10.0),
    kdj_period: int = Query(default=9, ge=2, le=250),
    rsi_period: int = Query(default=14, ge=2, le=250),
    macd_fast: int = Query(default=12, ge=2, le=250),
    macd_slow: int = Query(default=26, ge=2, le=250),
    macd_signal: int = Query(default=9, ge=2, le=250),
    bb_period: int = Query(default=20, ge=2, le=250),
    bb_std: float = Query(default=2.0, ge=0.5, le=5.0),
) -> dict[str, object]:
    if ma_type not in ("sma", "ema"):
        return {"error": "ma_type must be 'sma' or 'ema'"}

    result = await _get_taiex_cached(months=months)
    data = result.get("data", [])
    if not isinstance(data, list) or len(data) == 0:
        return {"ma": [], "kdj": [], "rsi": [], "macd": [], "bollinger": []}

    dates = [str(item["date"]) for item in data]
    closes = [float(item["close"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    periods = [int(p.strip()) for p in ma_periods.split(",") if p.strip().isdigit()]
    if not periods:
        periods = [8, 21, 55, 89]

    ma_all = calculate_ma_daniel(
        dates,
        highs,
        lows,
        closes,
        volumes,
        periods=periods,
        lookback=ma_lookback,
        ma_type=ma_type,
        cooldown=ma_cooldown,
        buy_slope_min=ma_buy_slope_min,
        sell_slope_max=ma_sell_slope_max,
    )

    return {
        "ma": ma_all,
        "kdj": calculate_kdj(dates, highs, lows, closes, kdj_period),
        "rsi": calculate_rsi(dates, closes, rsi_period),
        "macd": calculate_macd(dates, closes, macd_fast, macd_slow, macd_signal),
        "bollinger": calculate_bollinger(dates, closes, bb_period, bb_std),
        "ma_accuracy": calculate_signal_accuracy(ma_all, highs, lows, closes),
    }


# 指數分K 一律走富邦 IX0001（TSE 加權指數）：historical.candles 的 timeframe
# 支援 "10"，而 yfinance 無 10m 原生解析度；富邦不可用時回傳空陣列（前端顯示暫無資料）。
TAIEX_INDEX_SYMBOL = "IX0001"
VALID_INDEX_RESOLUTIONS = ("1", "5", "10", "15", "30", "60")
VALID_INDEX_INTERVALS = ("1m", "5m", "10m", "15m", "30m", "60m")

_TAIEX_INTRADAY_CACHE_TTL_SECONDS = 60
_taiex_intraday_cache: dict[tuple[str, int], dict[str, object]] = {}


def _fetch_taiex_intraday_sync(resolution: str, days: int) -> list[dict[str, object]]:
    end = date.today()
    start = end - timedelta(days=days)
    records = fubon_market.fetch_candles(
        TAIEX_INDEX_SYMBOL, resolution, start.isoformat(), end.isoformat()
    )
    return [
        {
            "date": str(r["date"]),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r.get("volume") or 0),
        }
        for r in records
    ]


async def _get_taiex_intraday_historical(resolution: str, days: int) -> list[dict[str, object]]:
    """Completed-session bars from Fubon's historical REST (memoized, 60s TTL)."""
    key = (resolution, days)
    entry = _taiex_intraday_cache.get(key)
    if entry:
        cached_at_raw = entry.get("cached_at")
        cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float) else 0.0
        if (datetime.now(timezone.utc).timestamp() - cached_at) < _TAIEX_INTRADAY_CACHE_TTL_SECONDS:
            cached = entry.get("data")
            if isinstance(cached, list):
                return cached

    try:
        data = await run_in_threadpool(_fetch_taiex_intraday_sync, resolution, days)
    except fubon_market.FubonUnavailable as exc:
        logger.warning("Fubon index intraday unavailable (%s %s): %s", resolution, days, exc)
        return []

    _taiex_intraday_cache[key] = {
        "cached_at": datetime.now(timezone.utc).timestamp(),
        "data": data,
    }
    return data


def _merge_bars(
    historical: list[dict[str, object]], live: list[dict[str, object]]
) -> list[dict[str, object]]:
    """Merge completed-session bars with today's live bars (live wins on collision)."""
    if not live:
        return historical
    merged: dict[str, dict[str, object]] = {str(bar["date"]): bar for bar in historical}
    for bar in live:
        merged[str(bar["date"])] = bar
    return [merged[key] for key in sorted(merged)]


async def _get_taiex_intraday(resolution: str, days: int) -> list[dict[str, object]]:
    """Historical completed sessions + today's live session (from the realtime feed).

    Fubon's ``historical.candles`` omits the in-progress session, so during market
    hours the live feed supplies today's bars. Outside market hours (or before the
    feed's first tick) this degrades to the historical data alone.
    """
    historical = await _get_taiex_intraday_historical(resolution, days)
    try:
        minutes = int(resolution)
    except ValueError:
        return historical
    feed = get_live_feed()
    feed.ensure(TAIEX_INDEX_SYMBOL)
    live = feed.get_bars(TAIEX_INDEX_SYMBOL, minutes)
    return _merge_bars(historical, live)


@router.get("/taiex/bars")
async def get_taiex_bars(
    resolution: str = Query(default="10", description="分K 解析度: 1/5/10/15/30/60"),
    days: int = Query(default=30, ge=1, le=60, description="回推日曆日數（預設 30＝約一個月）"),
) -> dict[str, object]:
    if resolution not in VALID_INDEX_RESOLUTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid resolution: {resolution}. Must be one of {VALID_INDEX_RESOLUTIONS}",
        )
    return {"title": "加權指數", "data": await _get_taiex_intraday(resolution, days)}


@router.get("/taiex/minute-indicators")
async def get_taiex_minute_indicators(
    interval: str = Query(default="10m"),
    days: int = Query(default=30, ge=1, le=60),
    ma_periods: str = Query(default="8,21,55,89"),
    ma_type: str = Query(default="sma"),
    ma_lookback: int = Query(default=8, ge=1, le=250),
    ma_cooldown: int = Query(default=1, ge=0, le=50),
    ma_buy_slope_min: float = Query(default=0.05, ge=0.0, le=10.0),
    ma_sell_slope_max: float = Query(default=0.02, ge=0.0, le=10.0),
    kdj_period: int = Query(default=9, ge=2, le=250),
    kdj_k_smooth: int = Query(default=3, ge=1, le=50),
    kdj_d_smooth: int = Query(default=3, ge=1, le=50),
    rsi_period: int = Query(default=14, ge=2, le=250),
    macd_fast: int = Query(default=12, ge=2, le=250),
    macd_slow: int = Query(default=26, ge=2, le=250),
    macd_signal: int = Query(default=9, ge=2, le=250),
    bb_period: int = Query(default=20, ge=2, le=250),
    bb_std: float = Query(default=2.0, ge=0.5, le=5.0),
) -> dict[str, object]:
    if interval not in VALID_INDEX_INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid interval: {interval}. Must be one of {VALID_INDEX_INTERVALS}",
        )
    _validate_index_indicator_params(ma_type, macd_fast, macd_slow)

    resolution = interval.removesuffix("m")
    data = await _get_taiex_intraday(resolution, days)
    return _compute_taiex_minute_indicators(
        data,
        ma_periods=ma_periods,
        ma_type=ma_type,
        ma_lookback=ma_lookback,
        ma_cooldown=ma_cooldown,
        ma_buy_slope_min=ma_buy_slope_min,
        ma_sell_slope_max=ma_sell_slope_max,
        kdj_period=kdj_period,
        kdj_k_smooth=kdj_k_smooth,
        kdj_d_smooth=kdj_d_smooth,
        rsi_period=rsi_period,
        macd_fast=macd_fast,
        macd_slow=macd_slow,
        macd_signal=macd_signal,
        bb_period=bb_period,
        bb_std=bb_std,
    )


def _validate_index_indicator_params(ma_type: str, macd_fast: int, macd_slow: int) -> None:
    if ma_type not in ("sma", "ema"):
        raise HTTPException(status_code=400, detail="ma_type must be 'sma' or 'ema'")
    if macd_fast >= macd_slow:
        raise HTTPException(status_code=400, detail="macd_fast must be less than macd_slow")


def _compute_taiex_minute_indicators(
    data: list[dict[str, object]],
    *,
    ma_periods: str,
    ma_type: str,
    ma_lookback: int,
    ma_cooldown: int,
    ma_buy_slope_min: float,
    ma_sell_slope_max: float,
    kdj_period: int,
    kdj_k_smooth: int,
    kdj_d_smooth: int,
    rsi_period: int,
    macd_fast: int,
    macd_slow: int,
    macd_signal: int,
    bb_period: int,
    bb_std: float,
) -> dict[str, object]:
    """Compute the index minute-bar indicator bundle (shared by REST + SSE)."""
    if not data:
        return {"ma": [], "kdj": [], "rsi": [], "macd": [], "bollinger": []}

    dates = [str(item["date"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    periods = [int(p.strip()) for p in ma_periods.split(",") if p.strip().isdigit()]
    if not periods:
        periods = [8, 21, 55, 89]

    ma_all = calculate_ma_daniel(
        dates,
        highs,
        lows,
        closes,
        volumes,
        periods=periods,
        lookback=ma_lookback,
        ma_type=ma_type,
        cooldown=ma_cooldown,
        buy_slope_min=ma_buy_slope_min,
        sell_slope_max=ma_sell_slope_max,
    )
    kdj_all = calculate_kdj(
        dates,
        highs,
        lows,
        closes,
        period=kdj_period,
        k_smooth=kdj_k_smooth,
        d_smooth=kdj_d_smooth,
    )
    rsi_all = calculate_rsi(dates, closes, rsi_period)
    macd_all = calculate_macd(dates, closes, macd_fast, macd_slow, macd_signal)
    bollinger_all = calculate_bollinger(dates, closes, bb_period, bb_std)

    return {
        "ma": ma_all,
        "kdj": kdj_all,
        "rsi": rsi_all,
        "macd": macd_all,
        "bollinger": bollinger_all,
        "ma_accuracy": calculate_signal_accuracy(ma_all, highs, lows, closes),
    }


# ── Live stream (Server-Sent Events) ───────────────────────────

_SSE_HEARTBEAT_SECONDS = 20


def _sse_event(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _build_taiex_stream_payload(
    days: int,
    interval: str,
    indicator_params: dict[str, object],
) -> dict[str, object]:
    resolution = interval.removesuffix("m")
    data = await _get_taiex_intraday(resolution, days)
    indicators = _compute_taiex_minute_indicators(data, **indicator_params)  # type: ignore[arg-type]
    return {"title": "加權指數", "data": data, "indicators": indicators}


@router.get("/taiex/stream")
async def get_taiex_stream(
    request: Request,
    interval: str = Query(default="10m"),
    days: int = Query(default=30, ge=1, le=60),
    ma_periods: str = Query(default="8,21,55,89"),
    ma_type: str = Query(default="sma"),
    ma_lookback: int = Query(default=8, ge=1, le=250),
    ma_cooldown: int = Query(default=1, ge=0, le=50),
    ma_buy_slope_min: float = Query(default=0.05, ge=0.0, le=10.0),
    ma_sell_slope_max: float = Query(default=0.02, ge=0.0, le=10.0),
    kdj_period: int = Query(default=9, ge=2, le=250),
    kdj_k_smooth: int = Query(default=3, ge=1, le=50),
    kdj_d_smooth: int = Query(default=3, ge=1, le=50),
    rsi_period: int = Query(default=14, ge=2, le=250),
    macd_fast: int = Query(default=12, ge=2, le=250),
    macd_slow: int = Query(default=26, ge=2, le=250),
    macd_signal: int = Query(default=9, ge=2, le=250),
    bb_period: int = Query(default=20, ge=2, le=250),
    bb_std: float = Query(default=2.0, ge=0.5, le=5.0),
) -> StreamingResponse:
    """SSE: push bars + indicators whenever the live index feed ticks.

    Emits an initial snapshot on connect, then a fresh payload per feed update
    (the subscriber queue coalesces bursts). Heartbeat comments keep the stream
    alive between ticks and while the market is closed.
    """
    if interval not in VALID_INDEX_INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid interval: {interval}. Must be one of {VALID_INDEX_INTERVALS}",
        )
    _validate_index_indicator_params(ma_type, macd_fast, macd_slow)

    indicator_params: dict[str, object] = {
        "ma_periods": ma_periods,
        "ma_type": ma_type,
        "ma_lookback": ma_lookback,
        "ma_cooldown": ma_cooldown,
        "ma_buy_slope_min": ma_buy_slope_min,
        "ma_sell_slope_max": ma_sell_slope_max,
        "kdj_period": kdj_period,
        "kdj_k_smooth": kdj_k_smooth,
        "kdj_d_smooth": kdj_d_smooth,
        "rsi_period": rsi_period,
        "macd_fast": macd_fast,
        "macd_slow": macd_slow,
        "macd_signal": macd_signal,
        "bb_period": bb_period,
        "bb_std": bb_std,
    }

    feed = get_live_feed()

    async def event_stream():
        feed.ensure(TAIEX_INDEX_SYMBOL)
        queue: asyncio.Queue[None] = asyncio.Queue(maxsize=1)
        feed.add_listener(TAIEX_INDEX_SYMBOL, queue)
        try:
            yield _sse_event(await _build_taiex_stream_payload(days, interval, indicator_params))
            while True:
                try:
                    await asyncio.wait_for(queue.get(), timeout=_SSE_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": keep-alive\n\n"
                    continue
                if await request.is_disconnected():
                    break
                yield _sse_event(
                    await _build_taiex_stream_payload(days, interval, indicator_params)
                )
        except asyncio.CancelledError:
            raise
        finally:
            feed.remove_listener(TAIEX_INDEX_SYMBOL, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
