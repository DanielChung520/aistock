import asyncio
import json
import time
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from src.data_fetcher import fetch_daily_history, fetch_minute_history
from src.db import get_db
from src.realtime.live_feed import get_live_feed
from src.routers.market import _compute_taiex_minute_indicators
from src.finmind import (
    fetch_day_trading,
    fetch_institutional_buy_sell,
    fetch_margin_short_sale,
    fetch_shareholding,
    fetch_short_sale_balances,
)
from src.indicators import (
    calculate_bollinger,
    calculate_kdj,
    calculate_ma_daniel,
    calculate_macd,
    calculate_rsi,
    calculate_signal_accuracy,
)

router = APIRouter(prefix="/stocks", tags=["stocks"])


def _subtract_months(input_date: date, months: int) -> date:
    month_index = input_date.month - 1 - months
    year = input_date.year + month_index // 12
    month = month_index % 12 + 1
    day = min(
        input_date.day,
        [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30,
         31, 31, 30, 31, 30, 31][month - 1],
    )
    return date(year, month, day)


@router.get("/search")
def search_stocks(q: str = Query(min_length=1)) -> list[dict[str, str]]:
    db = get_db()
    keyword = q.strip()
    if not keyword:
        return []

    aql = """
    FOR s IN stock_codes
      FILTER LIKE(s.stock_id, @pattern, true) OR LIKE(s.name, @pattern, true)
      SORT s.stock_id ASC
      LIMIT 20
      RETURN {
        stock_id: s.stock_id,
        name: s.name,
        isin_code: s.isin_code,
        market_type: s.market_type,
        industry: s.industry,
        listed_date: s.listed_date
      }
    """
    cursor = db.aql.execute(aql, bind_vars={"pattern": f"%{keyword}%"})
    return [item for item in cursor]


@router.get("/{stock_id}/history")
async def get_stock_history(
    stock_id: str,
    months: int = Query(default=6, ge=1, le=240),
) -> list[dict[str, object]]:
    return await run_in_threadpool(fetch_daily_history, stock_id, months=months, fail_fast=True)


@router.get("/{stock_id}/indicators")
async def get_indicators(
    stock_id: str,
    months: int = Query(default=6, ge=1, le=240),
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
    if ma_type not in ("sma", "ema"):
        raise HTTPException(status_code=400, detail="ma_type must be 'sma' or 'ema'")
    if macd_fast >= macd_slow:
        raise HTTPException(status_code=400, detail="macd_fast must be less than macd_slow")
    try:
        parsed_periods = [int(p.strip()) for p in ma_periods.split(",") if p.strip()]
        parsed_periods = [p for p in parsed_periods if 2 <= p <= 250]
        if not parsed_periods:
            parsed_periods = [8, 21, 55, 89]
    except ValueError:
        parsed_periods = [8, 21, 55, 89]

    all_periods = parsed_periods + [kdj_period, rsi_period, macd_slow, bb_period]
    warmup_months = min(max(max(all_periods) * 2 // 20, 3), 24)
    try:
        data = await run_in_threadpool(
            fetch_daily_history, stock_id, months=months + warmup_months, fail_fast=True
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to fetch stock data for indicators",
        ) from exc

    if not data:
        return {"ma": [], "kdj": [], "rsi": [], "macd": [], "bollinger": []}

    dates = [str(item["date"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    ma_all = calculate_ma_daniel(
        dates,
        highs,
        lows,
        closes,
        volumes,
        periods=parsed_periods,
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
    rsi_all = calculate_rsi(dates, closes, period=rsi_period)
    macd_all = calculate_macd(dates, closes, fast=macd_fast, slow=macd_slow, signal=macd_signal)
    bollinger_all = calculate_bollinger(dates, closes, period=bb_period, std_dev=bb_std)

    range_start = _subtract_months(date.today(), months).isoformat()
    ma = [item for item in ma_all if str(item["date"]) >= range_start]
    kdj = [item for item in kdj_all if str(item["date"]) >= range_start]
    rsi = [item for item in rsi_all if str(item["date"]) >= range_start]
    macd = [item for item in macd_all if str(item["date"]) >= range_start]
    bollinger = [item for item in bollinger_all if str(item["date"]) >= range_start]

    ma_accuracy = calculate_signal_accuracy(ma_all, highs, lows, closes)

    return {
        "ma": ma,
        "kdj": kdj,
        "rsi": rsi,
        "macd": macd,
        "bollinger": bollinger,
        "ma_accuracy": ma_accuracy,
    }


@router.get("/{stock_id}/minute-indicators")
async def get_minute_indicators(
    stock_id: str,
    interval: str = Query(default="5m"),
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
    if interval not in VALID_MINUTE_INTERVALS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid interval: {interval}. Must be one of {VALID_MINUTE_INTERVALS}",
        )
    if ma_type not in ("sma", "ema"):
        raise HTTPException(status_code=400, detail="ma_type must be 'sma' or 'ema'")
    if macd_fast >= macd_slow:
        raise HTTPException(status_code=400, detail="macd_fast must be less than macd_slow")
    try:
        parsed_periods = [int(p.strip()) for p in ma_periods.split(",") if p.strip()]
        parsed_periods = [p for p in parsed_periods if 2 <= p <= 250]
        if not parsed_periods:
            parsed_periods = [8, 21, 55, 89]
    except ValueError:
        parsed_periods = [8, 21, 55, 89]

    if interval == "1m" and days > 7:
        days = 7
    try:
        data = await run_in_threadpool(
            fetch_minute_history, stock_id, interval=interval, days=days, fail_fast=True
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to fetch minute data for indicators",
        ) from exc

    if not data:
        return {"ma": [], "kdj": [], "rsi": [], "macd": [], "bollinger": []}

    dates = [str(item["datetime"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    ma_all = calculate_ma_daniel(
        dates,
        highs,
        lows,
        closes,
        volumes,
        periods=parsed_periods,
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
    rsi_all = calculate_rsi(dates, closes, period=rsi_period)
    macd_all = calculate_macd(dates, closes, fast=macd_fast, slow=macd_slow, signal=macd_signal)
    bollinger_all = calculate_bollinger(dates, closes, period=bb_period, std_dev=bb_std)

    range_start = (date.today() - timedelta(days=days)).isoformat()
    ma = [item for item in ma_all if str(item["date"]) >= range_start]
    kdj = [item for item in kdj_all if str(item["date"]) >= range_start]
    rsi = [item for item in rsi_all if str(item["date"]) >= range_start]
    macd = [item for item in macd_all if str(item["date"]) >= range_start]
    bollinger = [item for item in bollinger_all if str(item["date"]) >= range_start]

    ma_accuracy = calculate_signal_accuracy(ma_all, highs, lows, closes)

    return {
        "ma": ma,
        "kdj": kdj,
        "rsi": rsi,
        "macd": macd,
        "bollinger": bollinger,
        "ma_accuracy": ma_accuracy,
    }

@router.get("/{stock_id}/analysis/best-four-point")
async def get_best_four_point(stock_id: str) -> dict[str, object]:
    return {
        "stock_id": stock_id,
        "best_four_point": {"signal": "neutral", "reason": "四大買賣點分析待實作"},
        "buy_analysis": {"triggered": False, "reason": "四大買賣點分析待實作"},
        "sell_analysis": {"triggered": False, "reason": "四大買賣點分析待實作"},
    }


@router.get("/{stock_id}/chips")
async def get_stock_chips(
    stock_id: str,
    days: int = Query(default=20, ge=5, le=60),
) -> dict[str, object]:
    try:
        inst_raw, margin_raw, shareholding, day_trading_raw, short_sale_raw = await asyncio.gather(
            run_in_threadpool(fetch_institutional_buy_sell, stock_id, days=days),
            run_in_threadpool(fetch_margin_short_sale, stock_id, days=days),
            run_in_threadpool(fetch_shareholding, stock_id),
            run_in_threadpool(fetch_day_trading, stock_id, days=days),
            run_in_threadpool(fetch_short_sale_balances, stock_id, days=days),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"failed to fetch chips data: {exc}",
        ) from exc

    name_map = {
        "Foreign_Investor": "外資",
        "Investment_Trust": "投信",
        "Dealer_self": "自營商(自)",
        "Dealer_Hedging": "自營商(避)",
        "Foreign_Dealer_Self": "外商自營",
    }
    inst_by_date: dict[str, dict[str, dict[str, int]]] = {}
    for row in inst_raw:
        d = row.date
        if d not in inst_by_date:
            inst_by_date[d] = {}
        key = name_map.get(row.name, row.name)
        if key not in inst_by_date[d]:
            inst_by_date[d][key] = {"buy": 0, "sell": 0}
        inst_by_date[d][key]["buy"] += row.buy
        inst_by_date[d][key]["sell"] += row.sell

    inst_dates = sorted(inst_by_date.keys(), reverse=True)[:days]
    institutional = []
    for d in reversed(inst_dates):
        entry: dict[str, str | int] = {"date": d}
        total_buy = 0
        total_sell = 0
        for key in ["外資", "投信", "自營商(自)", "自營商(避)", "外商自營"]:
            v = inst_by_date.get(d, {}).get(key, {"buy": 0, "sell": 0})
            net = v["buy"] - v["sell"]
            entry[key] = net
            total_buy += v["buy"]
            total_sell += v["sell"]
        entry["total"] = total_buy - total_sell
        institutional.append(entry)

    # 主力 = 外資 + 投信 + 自營商(避)
    for entry in institutional:
        entry["主力"] = (
            entry.get("外資", 0) + entry.get("投信", 0) + entry.get("自營商(避)", 0)
        )

    margin_by_date = {r.date: r.model_dump() for r in margin_raw}
    margin_dates = sorted(margin_by_date.keys(), reverse=True)[:days]
    margin_short_sale = [
        {**margin_by_date[d], "date": d} for d in reversed(margin_dates)
    ]

    ss_by_date = {r.date: r.model_dump() for r in short_sale_raw}
    ss_dates = sorted(ss_by_date.keys(), reverse=True)[:days]
    short_sale_balances = [{**ss_by_date[d], "date": d} for d in reversed(ss_dates)]

    dt_by_date = {r.date: r.model_dump() for r in day_trading_raw}
    dt_dates = sorted(dt_by_date.keys(), reverse=True)[:days]
    day_trading = [{**dt_by_date[d], "date": d} for d in reversed(dt_dates)]

    return {
        "stock_id": stock_id,
        "institutional": institutional,
        "margin_short_sale": margin_short_sale,
        "shareholding": shareholding.model_dump() if shareholding else None,
        "day_trading": day_trading,
        "short_sale_balances": short_sale_balances,
    }


VALID_MINUTE_INTERVALS = ("1m", "5m", "10m", "15m", "30m", "60m")


@router.get("/{stock_id}/minute-history")
async def get_minute_history(
    stock_id: str,
    days: int = Query(default=30, ge=1, le=60),
    interval: str = Query(default="5m"),
) -> list[dict[str, object]]:
    if interval not in VALID_MINUTE_INTERVALS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid interval: {interval}. Must be one of {VALID_MINUTE_INTERVALS}",
        )
    if interval == "1m" and days > 7:
        days = 7
    try:
        minute_data = await run_in_threadpool(
            fetch_minute_history, stock_id, interval=interval, days=days, fail_fast=True
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to query minute history",
        ) from exc
    return [
        {
            "datetime": item["datetime"],
            "open": item["open"],
            "high": item["high"],
            "low": item["low"],
            "close": item["close"],
            "volume": item["volume"],
        }
        for item in minute_data
    ]


# ── Live stream (Server-Sent Events) ───────────────────────────

_STOCK_STREAM_HEARTBEAT_SECONDS = 20


def _sse_line(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _merge_minute_bars(
    historical: list[dict[str, object]], live: list[dict[str, object]], cap: int
) -> list[dict[str, object]]:
    merged: dict[str, dict[str, object]] = {str(b["datetime"]): b for b in historical}
    for bar in live:
        merged[str(bar["datetime"])] = bar
    ordered = [merged[key] for key in sorted(merged)]
    return ordered[-cap:] if cap and len(ordered) > cap else ordered


def _live_minute_bars(stock_id: str, minutes: int) -> list[dict[str, object]]:
    return [
        {
            "datetime": bar["date"],
            "open": bar["open"],
            "high": bar["high"],
            "low": bar["low"],
            "close": bar["close"],
            "volume": bar["volume"],
        }
        for bar in get_live_feed().get_bars(stock_id, minutes)
    ]


_DAILY_STREAM_CACHE_TTL_SECONDS = 60.0
_daily_stream_cache: dict[tuple[str, int], tuple[float, list[dict[str, object]]]] = {}


def _daily_window_start(months: int) -> str:
    return ((date.today() + timedelta(days=1)) - timedelta(days=months * 35)).isoformat()


async def _get_daily_history_cached(stock_id: str, months: int) -> list[dict[str, object]]:
    key = (stock_id, months)
    entry = _daily_stream_cache.get(key)
    now = time.time()
    if entry is not None and now - entry[0] < _DAILY_STREAM_CACHE_TTL_SECONDS:
        return entry[1]
    try:
        rows: list[dict[str, object]] = list(
            await run_in_threadpool(fetch_daily_history, stock_id, months=months, fail_fast=True)
        )
    except Exception:
        rows = []
    _daily_stream_cache[key] = (now, rows)
    return rows


def _merge_daily_bars(
    historical: list[dict[str, object]], live: dict[str, object] | None
) -> list[dict[str, object]]:
    merged: dict[str, dict[str, object]] = {str(b["date"]): b for b in historical}
    if live is not None:
        merged[str(live["date"])] = live
    return [merged[key] for key in sorted(merged)]


async def _build_stock_daily_stream_payload(
    stock_id: str,
    months: int,
    indicator_params: dict[str, object],
) -> dict[str, object]:
    parsed = [int(p) for p in str(indicator_params["ma_periods"]).split(",") if p.strip().isdigit()]
    periods = parsed or [8, 21, 55, 89]
    all_periods = periods + [
        int(indicator_params["kdj_period"]),
        int(indicator_params["rsi_period"]),
        int(indicator_params["macd_slow"]),
        int(indicator_params["bb_period"]),
    ]
    warmup_months = min(max(max(all_periods) * 2 // 20, 3), 24)
    historical = await _get_daily_history_cached(stock_id, months + warmup_months)
    merged = _merge_daily_bars(historical, get_live_feed().today_daily_bar(stock_id))
    computed = _compute_taiex_minute_indicators(merged, **indicator_params)  # type: ignore[arg-type]
    start = _daily_window_start(months)
    data = [bar for bar in merged if str(bar["date"]) >= start]
    indicators: dict[str, object] = {}
    for key, value in computed.items():
        if isinstance(value, list):
            indicators[key] = [item for item in value if str(item.get("date", "")) >= start]
        else:
            indicators[key] = value
    return {"symbol": stock_id, "interval": "D", "data": data, "indicators": indicators}


async def _build_stock_stream_payload(
    stock_id: str,
    interval: str,
    days: int,
    months: int,
    cap: int,
    indicator_params: dict[str, object],
) -> dict[str, object]:
    feed = get_live_feed()
    feed.ensure(stock_id)
    if interval in ("D", "W", "M"):
        return await _build_stock_daily_stream_payload(stock_id, months, indicator_params)
    minutes = int(interval.removesuffix("m"))
    try:
        historical = await run_in_threadpool(
            fetch_minute_history, stock_id, interval=interval, days=days, fail_fast=True
        )
    except Exception:
        historical = []
    bars = _merge_minute_bars(historical, _live_minute_bars(stock_id, minutes), cap)
    dated = [{**bar, "date": str(bar["datetime"])} for bar in bars]
    indicators = _compute_taiex_minute_indicators(dated, **indicator_params)  # type: ignore[arg-type]
    return {"symbol": stock_id, "interval": interval, "data": bars, "indicators": indicators}


@router.get("/{stock_id}/stream")
async def get_stock_stream(
    request: Request,
    stock_id: str,
    interval: str = Query(default="60m", description="1m/5m/10m/15m/30m/60m 或 D（日K）"),
    days: int = Query(default=30, ge=1, le=60),
    months: int = Query(default=6, ge=1, le=240),
    cap: int = Query(default=200, ge=20, le=1000),
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
    """SSE: push a stock's bars + indicators in real time, updating only the live bar."""
    if interval not in VALID_MINUTE_INTERVALS and interval != "D":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid interval: {interval}. Must be one of {VALID_MINUTE_INTERVALS}",
        )
    if ma_type not in ("sma", "ema"):
        raise HTTPException(status_code=400, detail="ma_type must be 'sma' or 'ema'")
    if macd_fast >= macd_slow:
        raise HTTPException(status_code=400, detail="macd_fast must be less than macd_slow")

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
        feed.ensure(stock_id)
        queue: asyncio.Queue[None] = asyncio.Queue(maxsize=1)
        feed.add_listener(stock_id, queue)
        try:
            yield _sse_line(
                await _build_stock_stream_payload(stock_id, interval, days, months, cap, indicator_params)
            )
            while True:
                try:
                    await asyncio.wait_for(queue.get(), timeout=_STOCK_STREAM_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": keep-alive\n\n"
                    continue
                if await request.is_disconnected():
                    break
                yield _sse_line(
                    await _build_stock_stream_payload(stock_id, interval, days, months, cap, indicator_params)
                )
        except asyncio.CancelledError:
            raise
        finally:
            feed.remove_listener(stock_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
