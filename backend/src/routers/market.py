import ssl
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Query

from src.indicators import calculate_bollinger, calculate_kdj, calculate_ma, calculate_macd, calculate_rsi

router = APIRouter(prefix="/market", tags=["market"])

# TWSE 的 SSL 憑證缺少 Subject Key Identifier，Python 3.14+ 預設會拒絕
# 建立寬鬆的 SSL context 來繞過此問題
_twse_ssl_ctx: ssl.SSLContext | None = None


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
    return await _fetch_taiex_data(months=months)


@router.get("/taiex/indicators")
async def get_taiex_indicators(
    months: int = Query(default=6, ge=1, le=120),
    ma_periods: str = Query(default="5,10,20,60"),
    ma_type: str = Query(default="sma"),
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

    result = await _fetch_taiex_data(months=months)
    data = result.get("data", [])
    if not isinstance(data, list) or len(data) == 0:
        return {"ma": [], "kdj": [], "rsi": [], "macd": [], "bollinger": []}

    dates = [str(item["date"]) for item in data]
    closes = [float(item["close"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]

    periods = [int(p.strip()) for p in ma_periods.split(",") if p.strip().isdigit()]
    if not periods:
        periods = [5, 10, 20, 60]

    return {
        "ma": calculate_ma(dates, closes, periods, ma_type),
        "kdj": calculate_kdj(dates, highs, lows, closes, kdj_period),
        "rsi": calculate_rsi(dates, closes, rsi_period),
        "macd": calculate_macd(dates, closes, macd_fast, macd_slow, macd_signal),
        "bollinger": calculate_bollinger(dates, closes, bb_period, bb_std),
    }
