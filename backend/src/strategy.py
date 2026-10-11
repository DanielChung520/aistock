"""Stock screener — LLM-generated technical condition evaluation.

Scans the whole universe (stock_codes) by computing a full indicator
snapshot per stock, then evaluating the structured conditions the LLM
generated from a natural-language description. Conditions reference a
whitelisted metric catalog (INDICATOR_CATALOG) with a fixed operator set, so
the backend remains the only place indicator math happens (G9) while the LLM
decides *which* metrics matter and *how* to combine them.

All indicator math goes through src.indicators (G9) — no reimplementation.
"""
from __future__ import annotations

from src.db import get_db
from src.indicators import (
    calculate_adx,
    calculate_atr,
    calculate_bollinger,
    calculate_breakout_high3,
    calculate_cci,
    calculate_kdj,
    calculate_ma_daniel,
    calculate_macd,
    calculate_max_n,
    calculate_min_n,
    calculate_new_high_n,
    calculate_obv,
    calculate_range3,
    calculate_rsi,
)
from datetime import date, timedelta, datetime

from src.indicators_ext import (
    calculate_adosc,
    calculate_apo,
    calculate_aroon,
    calculate_cmf,
    calculate_day_high,
    calculate_day_low,
    calculate_dema,
    calculate_dx,
    calculate_ema,
    calculate_hma,
    calculate_kama,
    calculate_linearreg,
    calculate_linearreg_slope,
    calculate_mfi,
    calculate_midprice,
    calculate_mom,
    calculate_natr,
    calculate_ppo,
    calculate_pvo,
    calculate_roc,
    calculate_sar,
    calculate_stddev,
    calculate_stochrsi,
    calculate_tema,
    calculate_trix,
    calculate_tsf,
    calculate_ultosc,
    calculate_vwma,
    calculate_willr,
    calculate_wma,
)

LOOKBACK_DAYS = 150  # enough for MA89 warm-up + indicator windows
WEEKLY_LOOKBACK_DAYS = 500  # ~71 ISO weeks → weekly MA55 + slope warm-up (≥65 weekly bars)
WEEKLY_MIN_BARS = 65  # below this the weekly tf cannot confirm MA55 → weekly conditions fail
MINUTE_15M_LOOKBACK_DAYS = 60  # yfinance serves at most ~60 days of 15m bars
MINUTE_15M_MIN_BARS = 60  # fewer 15m bars → tf unavailable → stock skipped when a 15m condition exists
MINUTE_15M_MAX_BARS = 120  # newest bars kept (covers ma89 + slope warm-up ≈90)

# 三大法人 metrics: source = institutional_daily (TWSE T86 + TPEx); look-back is trading days.
INSTITUTIONAL_COLLECTION = "institutional_daily"
INST_LOOKBACK_DAYS = 15
INST_METRICS = ("inst_active", "inst_net_15d")
FILTER_METRICS = (
    "ma_bull",
    "slope8",
    "kdj_k",
    "kdj_d",
    "rsi",
    "macd_hist",
    "price",
    "close_offset",
    "vol_ratio",
    "inst_active",
)
_INST_GROSS_FIELDS = (
    "foreign_buy",
    "foreign_sell",
    "foreign_dealer_buy",
    "foreign_dealer_sell",
    "trust_buy",
    "trust_sell",
    "dealer_self_buy",
    "dealer_self_sell",
    "dealer_hedge_buy",
    "dealer_hedge_sell",
)

# Metrics the LLM may reference in conditions. `type` is "num" (numeric) or
# "bool" (boolean). This catalog text is embedded in the LLM prompt and is the
# only set of metrics the scan engine can evaluate.
INDICATOR_CATALOG: list[dict[str, str]] = [
    {"metric": "price", "type": "num", "name": "最新收盤價"},
    {"metric": "pct_change", "type": "num", "name": "最新漲跌幅(%)"},
    {"metric": "ma8", "type": "num", "name": "8日均線"},
    {"metric": "ma21", "type": "num", "name": "21日均線"},
    {"metric": "ma55", "type": "num", "name": "55日均線"},
    {"metric": "ma89", "type": "num", "name": "89日均線"},
    {"metric": "slope8", "type": "num", "name": "MA8 斜率(%)"},
    {"metric": "slope21", "type": "num", "name": "MA21 斜率(%)"},
    {"metric": "slope55", "type": "num", "name": "MA55 斜率(%)"},
    {"metric": "ma5", "type": "num", "name": "5日均線"},
    {"metric": "slope5", "type": "num", "name": "MA5 斜率(%)"},
    {"metric": "max_high_2d", "type": "num", "name": "前兩日最高價"},
    {"metric": "close_offset", "type": "num", "name": "扣抵值"},
    {"metric": "kdj_k", "type": "num", "name": "KDJ K 值"},
    {"metric": "kdj_d", "type": "num", "name": "KDJ D 值"},
    {"metric": "kdj_j", "type": "num", "name": "KDJ J 值"},
    {"metric": "rsi", "type": "num", "name": "RSI(14)"},
    {"metric": "macd_dif", "type": "num", "name": "MACD DIF"},
    {"metric": "macd_signal", "type": "num", "name": "MACD 訊號線"},
    {"metric": "macd_hist", "type": "num", "name": "MACD 柱"},
    {"metric": "bb_upper", "type": "num", "name": "布林上軌"},
    {"metric": "bb_middle", "type": "num", "name": "布林中軌"},
    {"metric": "bb_lower", "type": "num", "name": "布林下軌"},
    {"metric": "bb_width", "type": "num", "name": "布林帶寬(%)"},
    {"metric": "vol_ratio", "type": "num", "name": "量比(近5日均量/近20日均量)"},
    {"metric": "trend", "type": "num", "name": "趨勢權重(A=50/B=25/C=0)"},
    {"metric": "ma_bull", "type": "bool", "name": "MA8>MA21>MA55 多頭排列"},
    {"metric": "buy_signal", "type": "bool", "name": "MA Daniel 買進訊號"},
    {"metric": "sell_signal", "type": "bool", "name": "MA Daniel 賣出訊號"},
    {"metric": "atr", "type": "num", "name": "ATR(14) 平均真實波幅"},
    {"metric": "cci", "type": "num", "name": "CCI(20) 順勢指標"},
    {"metric": "obv", "type": "num", "name": "OBV 能量潮"},
    {"metric": "adx", "type": "num", "name": "ADX(14) 趨勢強度"},
    {"metric": "range3", "type": "num", "name": "三日振幅(%)"},
    {"metric": "breakout_high3", "type": "bool", "name": "突破前三日高點"},
    {"metric": "new_high_n", "type": "bool", "name": "創20日新高"},
    {"metric": "max_n", "type": "num", "name": "20日最高價"},
    {"metric": "min_n", "type": "num", "name": "20日最低價"},
    # --- indicators_ext.py 擴充指標（2026-08 接入）---
    {"metric": "ema", "type": "num", "name": "EMA 指數移動平均(12)"},
    {"metric": "wma", "type": "num", "name": "WMA 加權移動平均(30)"},
    {"metric": "hma", "type": "num", "name": "HMA 赫爾移動平均(16)"},
    {"metric": "kama", "type": "num", "name": "KAMA 自適應均線(10)"},
    {"metric": "dema", "type": "num", "name": "DEMA 雙重指數均線(30)"},
    {"metric": "tema", "type": "num", "name": "TEMA 三重指數均線(30)"},
    {"metric": "vwma", "type": "num", "name": "VWMA 量加權均線(30)"},
    {"metric": "midprice", "type": "num", "name": "週期中點價(14)"},
    {"metric": "sar", "type": "num", "name": "SAR 拋物線轉向"},
    {"metric": "apo", "type": "num", "name": "APO 絕對價格振盪(12/26)"},
    {"metric": "ppo", "type": "num", "name": "PPO 百分比價格振盪(12/26)"},
    {"metric": "pvo", "type": "num", "name": "PVO 百分比量振盪(12/26)"},
    {"metric": "roc", "type": "num", "name": "ROC 變動率(10)"},
    {"metric": "mom", "type": "num", "name": "MOM 動量(10)"},
    {"metric": "stochrsi_k", "type": "num", "name": "StochRSI %K(14/5/3)"},
    {"metric": "stochrsi_d", "type": "num", "name": "StochRSI %D(14/5/3)"},
    {"metric": "ultosc", "type": "num", "name": "ULTOSC 終極擺盪(7/14/28)"},
    {"metric": "willr", "type": "num", "name": "WILLR 威廉指標(14)"},
    {"metric": "mfi", "type": "num", "name": "MFI 資金流量指標(14)"},
    {"metric": "adosc", "type": "num", "name": "ADOSC 蔡金振盪(3/10)"},
    {"metric": "cmf", "type": "num", "name": "CMF 蔡金資金流(20)"},
    {"metric": "linearreg", "type": "num", "name": "LINEARREG 線性回歸值(14)"},
    {"metric": "linearreg_slope", "type": "num", "name": "LINEARREG 斜率(14)"},
    {"metric": "stddev", "type": "num", "name": "STDDEV 標準差(5)"},
    {"metric": "tsf", "type": "num", "name": "TSF 時間序列預測(14)"},
    {"metric": "aroon_up", "type": "num", "name": "AROON 上漲(25)"},
    {"metric": "aroon_down", "type": "num", "name": "AROON 下跌(25)"},
    {"metric": "dx", "type": "num", "name": "DX 趨向指標(14)"},
    {"metric": "natr", "type": "num", "name": "NATR 正規化ATR(14)"},
    {"metric": "day_high", "type": "num", "name": "當日最高價"},
    {"metric": "day_low", "type": "num", "name": "當日最低價"},
    {"metric": "trix", "type": "num", "name": "TRIX 三重指數平滑(15)"},
    {"metric": "inst_active", "type": "bool", "name": "近15交易日三大法人有交易(買或賣)"},
    {"metric": "inst_net_15d", "type": "num", "name": "近15交易日三大法人合計買賣超(股)"},
]

ALLOWED_OPS = (">", ">=", "<", "<=", "==", "is_true", "cross_above", "cross_below")

CATALOG_TEXT = "\n".join(
    f"- {m['metric']}: {m['name']}（{'數值' if m['type'] == 'num' else '布林'}）"
    for m in INDICATOR_CATALOG
)


def _safe_num(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _load_bars(stock_id: str, lookback_days: int = LOOKBACK_DAYS + 60) -> list[dict] | None:
    """Read daily bars for one stock directly from ArangoDB.

    Skips yfinance fallback so scanning the universe stays fast — stocks
    without data simply return None.
    """
    db = get_db()
    start = date.today() - timedelta(days=lookback_days)
    aql = """
    FOR d IN stock_daily
      FILTER d.stock_id == @s AND d.date >= @start
      SORT d.date ASC
      RETURN { date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }
    """
    cursor = db.aql.execute(aql, bind_vars={"s": stock_id, "start": start.isoformat()})
    rows = list(cursor)
    return rows if len(rows) >= 60 else None


def _aggregate_daily_to_weekly(daily: list[dict]) -> list[dict]:
    """Aggregate daily bars into weekly OHLCV keyed by ISO week (YYYY-Www).

    Mirrors src.routers.bars._aggregate_daily_to_weekly — duplicated here so
    the engine layer never imports from the router layer.
    """
    grouped: dict[str, dict] = {}
    for r in daily:
        d = date.fromisoformat(str(r["date"]))
        iso = d.isocalendar()
        week_key = f"{iso[0]}-W{iso[1]:02d}"
        if week_key not in grouped:
            grouped[week_key] = {
                "date": week_key,
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"] or 0,
            }
        else:
            g = grouped[week_key]
            g["high"] = max(g["high"], r["high"])
            g["low"] = min(g["low"], r["low"])
            g["close"] = r["close"]
            g["volume"] += r["volume"] or 0
    return sorted(grouped.values(), key=lambda x: x["date"])


def _load_weekly_bars(stock_id: str) -> list[dict] | None:
    """Load ~500 calendar days of daily bars aggregated to ISO weeks.

    Returns None when fewer than WEEKLY_MIN_BARS weekly bars exist —
    weekly MA55/slope conditions then fail naturally instead of being skipped.
    """
    daily = _load_bars(stock_id, lookback_days=WEEKLY_LOOKBACK_DAYS)
    if daily is None:
        return None
    weekly = _aggregate_daily_to_weekly(daily)
    return weekly if len(weekly) >= WEEKLY_MIN_BARS else None


def _load_15m_bars(stock_id: str) -> list[dict] | None:
    """Read the newest 15m bars within the 60-day yfinance window, ASC by datetime.

    Bars are mapped to the daily-bar shape (`datetime` → `date`) so
    compute_snapshot runs unchanged. Returns None when fewer than
    MINUTE_15M_MIN_BARS bars exist (caller skips the stock for 15m conditions).
    """
    db = get_db()
    start = (datetime.now() - timedelta(days=MINUTE_15M_LOOKBACK_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    aql = """
    FOR d IN stock_minute_15m
      FILTER d.stock_id == @s AND d.datetime >= @start
      SORT d.datetime DESC
      LIMIT @n
      RETURN { date: d.datetime, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }
    """
    cursor = db.aql.execute(
        aql, bind_vars={"s": stock_id, "start": start, "n": MINUTE_15M_MAX_BARS},
    )
    rows = list(cursor)
    rows.reverse()  # DESC from AQL → chronological ASC for indicator math
    return rows if len(rows) >= MINUTE_15M_MIN_BARS else None


def _num_or_metric(value, snapshot: dict) -> float | None:
    """Resolve a condition value: a literal number or a metric name."""
    if isinstance(value, (int, float)):
        return _safe_num(value)
    if isinstance(value, str) and value in snapshot:
        return snapshot[value]["value"]
    return None


def compute_snapshot(data: list[dict]) -> dict[str, dict]:
    """Compute the full indicator snapshot for the last two bars.

    Returns {metric: {"value": float | bool | None, "prev": ...}} where prev
    is the value one bar earlier (None when unavailable) — required for
    cross_above/cross_below and for comparing against another metric.
    """
    dates = [str(item["date"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    sig = calculate_ma_daniel(dates, highs, lows, closes, volumes)
    kdj = calculate_kdj(dates, highs, lows, closes)
    rsi = calculate_rsi(dates, closes)
    macd = calculate_macd(dates, closes)
    boll = calculate_bollinger(dates, closes)
    atr = calculate_atr(dates, highs, lows, closes)
    cci = calculate_cci(dates, highs, lows, closes)
    obv = calculate_obv(dates, closes, volumes)
    adx = calculate_adx(dates, highs, lows, closes)
    range3 = calculate_range3(dates, highs, lows, closes)
    breakout = calculate_breakout_high3(dates, highs, closes)
    new_high = calculate_new_high_n(dates, closes)
    max_n_series = calculate_max_n(dates, highs)
    min_n_series = calculate_min_n(dates, lows)

    ext_ema = calculate_ema(dates, closes)
    ext_wma = calculate_wma(dates, closes)
    ext_hma = calculate_hma(dates, closes)
    ext_kama = calculate_kama(dates, closes)
    ext_dema = calculate_dema(dates, closes)
    ext_tema = calculate_tema(dates, closes)
    ext_vwma = calculate_vwma(dates, closes, volumes)
    ext_midprice = calculate_midprice(dates, highs, lows)
    ext_sar = calculate_sar(dates, highs, lows)
    ext_apo = calculate_apo(dates, closes)
    ext_ppo = calculate_ppo(dates, closes)
    ext_pvo = calculate_pvo(dates, volumes)
    ext_roc = calculate_roc(dates, closes)
    ext_mom = calculate_mom(dates, closes)
    ext_stochrsi = calculate_stochrsi(dates, closes)
    ext_ultosc = calculate_ultosc(dates, highs, lows, closes)
    ext_willr = calculate_willr(dates, highs, lows, closes)
    ext_mfi = calculate_mfi(dates, highs, lows, closes, volumes)
    ext_adosc = calculate_adosc(dates, highs, lows, closes, volumes)
    ext_cmf = calculate_cmf(dates, highs, lows, closes, volumes)
    ext_linearreg = calculate_linearreg(dates, closes)
    ext_linearreg_slope = calculate_linearreg_slope(dates, closes)
    ext_stddev = calculate_stddev(dates, closes)
    ext_tsf = calculate_tsf(dates, closes)
    ext_aroon = calculate_aroon(dates, highs, lows)
    ext_dx = calculate_dx(dates, highs, lows, closes)
    ext_natr = calculate_natr(dates, highs, lows, closes)
    ext_day_high = calculate_day_high(dates, highs)
    ext_day_low = calculate_day_low(dates, lows)
    ext_trix = calculate_trix(dates, closes)

    i = len(closes) - 1
    j = max(i - 1, 0)

    def grab(series, idx, key):
        v = series[idx].get(key)
        return _safe_num(v) if v is not None else None

    def grab_bool(series, idx, key):
        v = series[idx].get(key)
        return bool(v) if v is not None else None

    prev_close = closes[j]
    prev_prev_close = closes[j - 1] if j >= 1 else None

    snapshot: dict[str, dict] = {
        "price": {"value": closes[i], "prev": prev_close},
        "pct_change": {
            "value": (closes[i] - prev_close) / prev_close * 100 if prev_close else None,
            "prev": (
                (prev_close - prev_prev_close) / prev_prev_close * 100
                if j >= 1 and prev_prev_close
                else None
            ),
        },
        "ma8": {"value": grab(sig, i, "ma8"), "prev": grab(sig, j, "ma8")},
        "ma21": {"value": grab(sig, i, "ma21"), "prev": grab(sig, j, "ma21")},
        "ma55": {"value": grab(sig, i, "ma55"), "prev": grab(sig, j, "ma55")},
        "ma89": {"value": grab(sig, i, "ma89"), "prev": grab(sig, j, "ma89")},
        "slope8": {"value": grab(sig, i, "slope8"), "prev": grab(sig, j, "slope8")},
        "slope21": {"value": grab(sig, i, "slope21"), "prev": grab(sig, j, "slope21")},
        "slope55": {"value": grab(sig, i, "slope55"), "prev": grab(sig, j, "slope55")},
        "ma5": {"value": grab(sig, i, "ma5"), "prev": grab(sig, j, "ma5")},
        "slope5": {"value": grab(sig, i, "slope5"), "prev": grab(sig, j, "slope5")},
        "close_offset": {"value": grab(sig, i, "close_offset"), "prev": grab(sig, j, "close_offset")},
        "kdj_k": {"value": grab(kdj, i, "k"), "prev": grab(kdj, j, "k")},
        "kdj_d": {"value": grab(kdj, i, "d"), "prev": grab(kdj, j, "d")},
        "kdj_j": {"value": grab(kdj, i, "j"), "prev": grab(kdj, j, "j")},
        "rsi": {"value": grab(rsi, i, "rsi"), "prev": grab(rsi, j, "rsi")},
        "macd_dif": {"value": grab(macd, i, "dif"), "prev": grab(macd, j, "dif")},
        "macd_signal": {"value": grab(macd, i, "signal"), "prev": grab(macd, j, "signal")},
        "macd_hist": {"value": grab(macd, i, "histogram"), "prev": grab(macd, j, "histogram")},
        "bb_upper": {"value": grab(boll, i, "upper"), "prev": grab(boll, j, "upper")},
        "bb_middle": {"value": grab(boll, i, "middle"), "prev": grab(boll, j, "middle")},
        "bb_lower": {"value": grab(boll, i, "lower"), "prev": grab(boll, j, "lower")},
        "bb_width": {"value": None, "prev": None},
        "vol_ratio": {"value": None, "prev": None},
        "trend": {"value": grab(sig, i, "weight"), "prev": grab(sig, j, "weight")},
        "ma_bull": {"value": None, "prev": None},
        "buy_signal": {"value": grab_bool(sig, i, "buy"), "prev": grab_bool(sig, j, "buy")},
        "sell_signal": {"value": grab_bool(sig, i, "sell"), "prev": grab_bool(sig, j, "sell")},
        "atr": {"value": grab(atr, i, "atr"), "prev": grab(atr, j, "atr")},
        "cci": {"value": grab(cci, i, "cci"), "prev": grab(cci, j, "cci")},
        "obv": {"value": grab(obv, i, "obv"), "prev": grab(obv, j, "obv")},
        "adx": {"value": grab(adx, i, "adx"), "prev": grab(adx, j, "adx")},
        "range3": {"value": grab(range3, i, "range3"), "prev": grab(range3, j, "range3")},
        "breakout_high3": {
            "value": grab_bool(breakout, i, "breakout_high3"),
            "prev": grab_bool(breakout, j, "breakout_high3"),
        },
        "new_high_n": {
            "value": grab_bool(new_high, i, "new_high_n"),
            "prev": grab_bool(new_high, j, "new_high_n"),
        },
        "max_n": {"value": grab(max_n_series, i, "max_n"), "prev": grab(max_n_series, j, "max_n")},
        "min_n": {"value": grab(min_n_series, i, "min_n"), "prev": grab(min_n_series, j, "min_n")},
        "ema": {"value": grab(ext_ema, i, "ema"), "prev": grab(ext_ema, j, "ema")},
        "wma": {"value": grab(ext_wma, i, "wma"), "prev": grab(ext_wma, j, "wma")},
        "hma": {"value": grab(ext_hma, i, "hma"), "prev": grab(ext_hma, j, "hma")},
        "kama": {"value": grab(ext_kama, i, "kama"), "prev": grab(ext_kama, j, "kama")},
        "dema": {"value": grab(ext_dema, i, "dema"), "prev": grab(ext_dema, j, "dema")},
        "tema": {"value": grab(ext_tema, i, "tema"), "prev": grab(ext_tema, j, "tema")},
        "vwma": {"value": grab(ext_vwma, i, "vwma"), "prev": grab(ext_vwma, j, "vwma")},
        "midprice": {"value": grab(ext_midprice, i, "midprice"), "prev": grab(ext_midprice, j, "midprice")},
        "sar": {"value": grab(ext_sar, i, "sar"), "prev": grab(ext_sar, j, "sar")},
        "apo": {"value": grab(ext_apo, i, "apo"), "prev": grab(ext_apo, j, "apo")},
        "ppo": {"value": grab(ext_ppo, i, "ppo"), "prev": grab(ext_ppo, j, "ppo")},
        "pvo": {"value": grab(ext_pvo, i, "pvo"), "prev": grab(ext_pvo, j, "pvo")},
        "roc": {"value": grab(ext_roc, i, "roc"), "prev": grab(ext_roc, j, "roc")},
        "mom": {"value": grab(ext_mom, i, "mom"), "prev": grab(ext_mom, j, "mom")},
        "stochrsi_k": {"value": grab(ext_stochrsi, i, "k"), "prev": grab(ext_stochrsi, j, "k")},
        "stochrsi_d": {"value": grab(ext_stochrsi, i, "d"), "prev": grab(ext_stochrsi, j, "d")},
        "ultosc": {"value": grab(ext_ultosc, i, "ultosc"), "prev": grab(ext_ultosc, j, "ultosc")},
        "willr": {"value": grab(ext_willr, i, "willr"), "prev": grab(ext_willr, j, "willr")},
        "mfi": {"value": grab(ext_mfi, i, "mfi"), "prev": grab(ext_mfi, j, "mfi")},
        "adosc": {"value": grab(ext_adosc, i, "adosc"), "prev": grab(ext_adosc, j, "adosc")},
        "cmf": {"value": grab(ext_cmf, i, "cmf"), "prev": grab(ext_cmf, j, "cmf")},
        "linearreg": {"value": grab(ext_linearreg, i, "linearreg"), "prev": grab(ext_linearreg, j, "linearreg")},
        "linearreg_slope": {
            "value": grab(ext_linearreg_slope, i, "linearreg_slope"),
            "prev": grab(ext_linearreg_slope, j, "linearreg_slope"),
        },
        "stddev": {"value": grab(ext_stddev, i, "stddev"), "prev": grab(ext_stddev, j, "stddev")},
        "tsf": {"value": grab(ext_tsf, i, "tsf"), "prev": grab(ext_tsf, j, "tsf")},
        "aroon_up": {"value": grab(ext_aroon, i, "aroon_up"), "prev": grab(ext_aroon, j, "aroon_up")},
        "aroon_down": {"value": grab(ext_aroon, i, "aroon_down"), "prev": grab(ext_aroon, j, "aroon_down")},
        "dx": {"value": grab(ext_dx, i, "dx"), "prev": grab(ext_dx, j, "dx")},
        "natr": {"value": grab(ext_natr, i, "natr"), "prev": grab(ext_natr, j, "natr")},
        "day_high": {"value": grab(ext_day_high, i, "day_high"), "prev": grab(ext_day_high, j, "day_high")},
        "day_low": {"value": grab(ext_day_low, i, "day_low"), "prev": grab(ext_day_low, j, "day_low")},
        "max_high_2d": {
            "value": max(highs[i - 2], highs[i - 1]) if i >= 2 else (highs[i - 1] if i == 1 else None),
            "prev": max(highs[j - 2], highs[j - 1]) if j >= 2 else (highs[j - 1] if j == 1 else None),
        },
        "trix": {"value": grab(ext_trix, i, "trix"), "prev": grab(ext_trix, j, "trix")},
    }

    # Volume ratios: 5-day vs 20-day average volume.
    def vol_avg(n: int) -> float | None:
        if len(volumes) >= n:
            return sum(volumes[-n:]) / n
        return None

    vol5, vol20 = vol_avg(5), vol_avg(20)
    snapshot["vol_ratio"]["value"] = vol5 / vol20 if vol5 and vol20 else None
    snapshot["vol_ratio"]["prev"] = None

    # Bollinger bandwidth: (upper - lower) / middle * 100
    mid = snapshot["bb_middle"]["value"]
    up = snapshot["bb_upper"]["value"]
    lo = snapshot["bb_lower"]["value"]
    if mid and up is not None and lo is not None and mid:
        snapshot["bb_width"]["value"] = (up - lo) / mid * 100

    # MA bull alignment: MA8 > MA21 > MA55
    ma8 = snapshot["ma8"]["value"]
    ma21 = snapshot["ma21"]["value"]
    ma55 = snapshot["ma55"]["value"]
    snapshot["ma_bull"]["value"] = bool(ma8 and ma21 and ma55 and ma8 > ma21 > ma55)
    snapshot["ma_bull"]["prev"] = None

    return snapshot


def evaluate_conditions(
    snapshot: dict[str, dict], conditions: list[dict]
) -> tuple[list[dict], int]:
    """Evaluate a list of conditions against one stock's snapshot.

    Each condition: {"metric", "op", "value", "note"}. Returns
    (results, passed_count) where results is a list of
    {"metric", "op", "value", "note", "actual", "passed"}.
    """
    results: list[dict] = []
    passed_count = 0
    for cond in conditions:
        metric = str(cond.get("metric", ""))
        op = str(cond.get("op", ""))
        target = cond.get("value")
        note = str(cond.get("note", "")) or metric

        entry = snapshot.get(metric)
        if entry is None or op not in ALLOWED_OPS:
            results.append(
                {
                    "metric": metric,
                    "op": op,
                    "value": target,
                    "note": note,
                    "actual": None,
                    "passed": False,
                }
            )
            continue

        actual = entry["value"]
        passed = False

        if op == "is_true":
            passed = bool(actual)
        elif actual is None:
            passed = False
        else:
            threshold = _num_or_metric(target, snapshot)
            if op in (">", ">=", "<", "<=", "=="):
                if threshold is not None:
                    try:
                        passed = {
                            ">": actual > threshold,
                            ">=": actual >= threshold,
                            "<": actual < threshold,
                            "<=": actual <= threshold,
                            "==": actual == threshold,
                        }[op]
                    except TypeError:
                        passed = False
            elif op in ("cross_above", "cross_below"):
                prev = entry["prev"]
                if threshold is not None and prev is not None:
                    if op == "cross_above":
                        passed = prev < threshold <= actual
                    else:
                        passed = prev > threshold >= actual

        if passed:
            passed_count += 1
        results.append(
            {
                "metric": metric,
                "op": op,
                "value": target,
                "note": note,
                "actual": actual,
                "passed": passed,
            }
        )
    return results, passed_count


def _load_institutional_window(stock_id: str, n: int = INST_LOOKBACK_DAYS) -> list[dict]:
    from src.db import get_db

    aql = """
    FOR d IN institutional_daily
      FILTER d.stock_id == @s
      SORT d.date DESC
      LIMIT @n
      RETURN d
    """
    cursor = get_db().aql.execute(aql, bind_vars={"s": stock_id, "n": n})
    return list(cursor)


def _institutional_metrics(stock_id: str) -> dict[str, dict]:
    """inst_active = 三大法人 traded at least once in the last N trading days;
    inst_net_15d = summed 三大法人 net over those days."""
    try:
        rows = _load_institutional_window(stock_id)
    except Exception:  # noqa: BLE001 — a missing collection must not break the scan
        rows = []
    if not rows:
        return {m: {"value": None, "prev": None} for m in INST_METRICS}
    active = False
    net = 0
    for r in rows:
        if sum(int(r.get(f) or 0) for f in _INST_GROSS_FIELDS) > 0:
            active = True
        net += int(r.get("total_net") or 0)
    return {
        "inst_active": {"value": active, "prev": None},
        "inst_net_15d": {"value": net, "prev": None},
    }


def evaluate_stock(
    stock_id: str, conditions: list[dict], name: str | None = None
) -> dict | None:
    """Evaluate one stock against the condition set (per-condition timeframe aware).

    Each condition may carry `tf` in {"d", "w", "15m"} (default "d"). Every
    distinct tf gets its own indicator snapshot; each condition is evaluated
    against its own tf's snapshot (metric-vs-metric thresholds resolve within
    one tf only). Skips the stock (returns None) when daily bars are missing,
    or when a condition needs the 15m tf but the 15m dataset is insufficient.
    Missing weekly data does not skip the stock — weekly conditions fail.
    """
    data = _load_bars(stock_id)
    if data is None:
        return None

    def _norm_tf(value) -> str:
        tf = str(value or "d").lower()
        return tf if tf in ("d", "w", "15m") else "d"

    tfs = {_norm_tf(c.get("tf")) for c in conditions} or {"d"}
    daily_snapshot = compute_snapshot(data)
    daily_snapshot.update(_institutional_metrics(stock_id))
    snapshots: dict[str, dict | None] = {"d": daily_snapshot}
    if "w" in tfs:
        weekly = _load_weekly_bars(stock_id)
        snapshots["w"] = compute_snapshot(weekly) if weekly else None
    if "15m" in tfs:
        bars_15m = _load_15m_bars(stock_id)
        if bars_15m is None:
            return None
        snapshots["15m"] = compute_snapshot(bars_15m)

    results: list[dict] = []
    passed_count = 0
    for cond in conditions:
        tf = _norm_tf(cond.get("tf"))
        snap = snapshots.get(tf)
        if snap is None:
            metric = str(cond.get("metric", ""))
            results.append(
                {
                    "metric": metric,
                    "op": str(cond.get("op", "")),
                    "value": cond.get("value"),
                    "note": str(cond.get("note", "")) or metric,
                    "actual": None,
                    "passed": False,
                    "tf": tf,
                }
            )
            continue
        sub_results, sub_passed = evaluate_conditions(snap, [cond])
        entry = sub_results[0]
        entry["tf"] = tf
        results.append(entry)
        passed_count += sub_passed

    snapshot = daily_snapshot
    price = snapshot["price"]["value"]
    date = str(data[-1]["date"])

    # Ranking score: passed conditions dominate, then a mild strength bonus.
    score = passed_count * 100.0
    slope8 = snapshot["slope8"]["value"]
    macd_hist = snapshot["macd_hist"]["value"]
    vol_ratio = snapshot["vol_ratio"]["value"]
    if slope8 is not None and slope8 > 0:
        score += min(slope8, 2) * 2
    if snapshot["ma_bull"]["value"]:
        score += 2
    if macd_hist is not None and macd_hist > 0:
        score += 1
    if vol_ratio is not None and vol_ratio > 1:
        score += 1

    return {
        "stock_id": stock_id,
        "name": name,
        "price": round(price, 2) if price else None,
        "score": round(score, 2),
        "date": date,
        "passed": passed_count == len(conditions) if conditions else False,
        "passed_count": passed_count,
        "total_conditions": len(conditions),
        "condition_results": results,
        "filter_values": {m: snapshot[m]["value"] for m in FILTER_METRICS},
    }
