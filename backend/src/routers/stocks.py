from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query, status

from src.data_fetcher import fetch_daily_history, fetch_minute_history
from src.db import get_db
from src.finmind import (
    fetch_day_trading,
    fetch_institutional_buy_sell,
    fetch_margin_short_sale,
    fetch_shareholding,
    fetch_short_sale_balances,
)
from src.indicators import calculate_bollinger, calculate_kdj, calculate_ma, calculate_macd, calculate_rsi

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
    return fetch_daily_history(stock_id, months=months)


@router.get("/{stock_id}/indicators")
async def get_indicators(
    stock_id: str,
    months: int = Query(default=6, ge=1, le=240),
    ma_periods: str = Query(default="5,10,20,60"),
    ma_type: str = Query(default="sma"),
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
            parsed_periods = [5, 10, 20, 60]
    except ValueError:
        parsed_periods = [5, 10, 20, 60]

    all_periods = parsed_periods + [kdj_period, rsi_period, macd_slow, bb_period]
    warmup_months = min(max(max(all_periods) * 2 // 20, 3), 24)
    try:
        data = fetch_daily_history(stock_id, months=months + warmup_months)
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

    ma_all = calculate_ma(dates, closes, parsed_periods, ma_type=ma_type)
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

    return {"ma": ma, "kdj": kdj, "rsi": rsi, "macd": macd, "bollinger": bollinger}


@router.get("/{stock_id}/minute-indicators")
async def get_minute_indicators(
    stock_id: str,
    interval: str = Query(default="5m"),
    days: int = Query(default=30, ge=1, le=60),
    ma_periods: str = Query(default="5,10,20,60"),
    ma_type: str = Query(default="sma"),
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
            parsed_periods = [5, 10, 20, 60]
    except ValueError:
        parsed_periods = [5, 10, 20, 60]

    if interval == "1m" and days > 7:
        days = 7
    try:
        data = fetch_minute_history(stock_id, interval=interval, days=days)
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

    ma_all = calculate_ma(dates, closes, parsed_periods, ma_type=ma_type)
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

    return {"ma": ma, "kdj": kdj, "rsi": rsi, "macd": macd, "bollinger": bollinger}

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
        inst_raw = fetch_institutional_buy_sell(stock_id, days=days)
        margin_raw = fetch_margin_short_sale(stock_id, days=days)
        shareholding = fetch_shareholding(stock_id)
        day_trading_raw = fetch_day_trading(stock_id, days=days)
        short_sale_raw = fetch_short_sale_balances(stock_id, days=days)
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
        minute_data = fetch_minute_history(stock_id, interval=interval, days=days)
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
