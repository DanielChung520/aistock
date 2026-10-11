"""擴充特徵群組 — 知識庫 37 個未輸出為特徵欄的指標接線。

與 src/features（10 個基礎群組）平行，覆蓋基礎群組未輸出的 KB 指標。
純計算、無 I/O，規則與 src/features 一致（None-not-0、index 對齊、warmup）。

每個群組沿用基礎群組的衍生模板：
- 趨勢族 (ema/wma/hma/kama/dema/tema/vwma/linearreg/tsf):
    4 週期(8/13/21/34) 主值 + 一次/二次斜率 + 成對 spread + alignment
- 震盪族 (stochrsi/willr/ultosc/cci/mfi/apo/ppo/pvo/roc/mom/trix/adx/dx/aroon):
    主值 + 250 日分位位置 + 斜率 + 二次斜率 + 交叉訊號
- 波動/區間族 (atr/natr/stddev/sar/midprice/range3/day_high/day_low/
                 max_n/min_n/adosc/cmf):
    主值 + 對價比 + 斜率 + 250 日分位
- 事件族 (breakout_high3/new_high_n): 旗標 + 近 10 日次數 + 幅度 + 斜率
- bollinger_squeeze: 帶寬 + 壓縮旗標 + 壓縮後突破方向
"""
from __future__ import annotations

import math
from typing import Any

from src.indicators import (
    _slope_series, calculate_adx, calculate_atr, calculate_breakout_high3,
    calculate_cci, calculate_max_n, calculate_min_n, calculate_new_high_n,
    calculate_range3,
)
from src.indicators_ext import (
    calculate_adosc, calculate_apo, calculate_aroon, calculate_cmf,
    calculate_day_high, calculate_day_low, calculate_dema, calculate_dx,
    calculate_ema, calculate_hma, calculate_kama, calculate_linearreg,
    calculate_mfi, calculate_midprice, calculate_mom, calculate_natr,
    calculate_ppo, calculate_pvo, calculate_roc, calculate_sar,
    calculate_stddev, calculate_stochrsi, calculate_tema, calculate_trix,
    calculate_tsf, calculate_ultosc, calculate_vwma, calculate_willr,
    calculate_wma,
)

Num = float | int | None

# 趨勢族 4 週期（與基礎 slope 群組的 8/13/21 對齊並加 34）
TREND_PERIODS = [8, 13, 21, 34]
_LOOKBACK_250 = 250
_LOOKBACK_20 = 20


# ── 共用工具 ────────────────────────────────────────────────────────────────

def _round4(value: float | None) -> Num:
    return round(value, 4) if value is not None else None


def _extract(results: list[dict], key: str) -> list[float | None]:
    return [r.get(key) for r in results]


def _pos250(values: list[float | None]) -> list[Num]:
    """250 日 min-max 分位位置（同 macd_pos 的做法）。"""
    out: list[Num] = []
    for i, v in enumerate(values):
        if v is None:
            out.append(None)
            continue
        window = [x for x in values[max(0, i - _LOOKBACK_250 + 1): i + 1] if x is not None]
        if not window:
            out.append(None)
            continue
        lo, hi = min(window), max(window)
        out.append(_round4((v - lo) / (hi - lo)) if hi > lo else 0.5)
    return out


def _cross_series(values: list[float | None], ref: list[float | None]) -> tuple[list[Num], list[Num]]:
    """values 對 ref 的向上/向下穿越（ref=None 視為 0）。"""
    up: list[Num] = [None] * len(values)
    down: list[Num] = [None] * len(values)
    for i in range(1, len(values)):
        a, b = values[i], values[i - 1]
        r = ref[i] if ref and ref[i] is not None else 0.0
        if a is None or b is None:
            continue
        up[i] = 1 if a > r >= b else 0
        down[i] = 1 if a < r <= b else 0
    return up, down


def _bool_series(values: list[float | None]) -> list[Num]:
    """bool/None 轉 1/0/None。"""
    return [1 if v else (0 if v is not None else None) for v in values]


def _cnt10(values: list[Num]) -> list[Num]:
    """近 10 日事件次數。"""
    out: list[Num] = []
    for i in range(len(values)):
        window = [v for v in values[max(0, i - 9): i + 1] if v is not None]
        out.append(sum(1 for v in window if v) if window else None)
    return out


# ── 趨勢族（9 個 × 20 欄）──────────────────────────────────────────────────

def _trend_group(
    key: str,
    values_by_period: dict[int, list[float | None]],
) -> list[dict[str, Num]]:
    """單一趨勢指標的多週期衍生: 主值 + 斜率 + 二次斜率 + spread + alignment。"""
    n = len(next(iter(values_by_period.values())))
    periods = sorted(values_by_period)
    pairs = [(a, b) for i, a in enumerate(periods) for b in periods[i + 1:]]
    slopes = {p: _slope_series(values_by_period[p]) for p in periods}
    slope2 = {p: _slope_series(slopes[p]) for p in periods}
    out: list[dict[str, Num]] = []
    prev_spreads: dict[tuple[int, int], float | None] = {}
    for i in range(n):
        entry: dict[str, Num] = {}
        for p in periods:
            entry[f"{key}{p}"] = _round4(values_by_period[p][i])
            entry[f"{key}_slope_{p}"] = _round4(slopes[p][i])
            entry[f"{key}_slope2_{p}"] = _round4(slope2[p][i])
        spreads: list[Num] = []
        for a, b in pairs:
            va, vb = values_by_period[a][i], values_by_period[b][i]
            s = va / vb - 1 if va is not None and vb and vb != 0 else None
            entry[f"{key}_spread_{a}_{b}"] = _round4(s)
            spreads.append(s)
        short, long_ = periods[0], periods[-1]
        vs, vl = values_by_period[short][i], values_by_period[long_][i]
        entry[f"{key}_spread_over"] = _round4(vs / vl - 1) if vs is not None and vl and vl != 0 else None
        if all(s is not None for s in spreads):
            state = 0
            for bit, s in enumerate(spreads):
                if s > 0:
                    state |= 1 << bit
            entry[f"{key}_alignment_state"] = state
        else:
            entry[f"{key}_alignment_state"] = None
        out.append(entry)
    return out


def _trend_series(
    dates: list[str], closes: list[float], volumes: list[float],
    fn, needs_volume: bool, key: str, period_kw: str = "period",
) -> list[dict[str, Num]]:
    """跑一個趨勢指標在多個週期上的序列。"""
    by_period: dict[int, list[float | None]] = {}
    for p in TREND_PERIODS:
        if needs_volume:
            raw = fn(dates, closes, volumes, **{period_kw: p})
        else:
            raw = fn(dates, closes, **{period_kw: p})
        by_period[p] = _extract(raw, key)
    return _trend_group(key, by_period)


def _compute_trend_groups(
    dates: list[str], closes: list[float], volumes: list[float],
    enabled: set[str],
) -> dict[str, list[dict[str, Num]] | None]:
    groups: dict[str, list[dict[str, Num]] | None] = {}
    simple = {
        "ema": (calculate_ema, "ema", "period"),
        "wma": (calculate_wma, "wma", "period"),
        "hma": (calculate_hma, "hma", "period"),
        "kama": (calculate_kama, "kama", "period"),
        "dema": (calculate_dema, "dema", "period"),
        "tema": (calculate_tema, "tema", "period"),
        "linearreg": (calculate_linearreg, "linearreg", "timeperiod"),
        "tsf": (calculate_tsf, "tsf", "timeperiod"),
    }
    for key, (fn, out_key, kw) in simple.items():
        if key in enabled:
            groups[key] = _trend_series(dates, closes, volumes, fn, False, out_key, kw)
    if "vwma" in enabled:
        groups["vwma"] = _trend_series(dates, closes, volumes, calculate_vwma, True, "vwma")
    return groups


# ── 震盪族（14 個 × 6 欄）──────────────────────────────────────────────────

def _osc_group(key: str, values: list[float | None], zero_cross: bool = True) -> list[dict[str, Num]]:
    """主值 + 分位 + 斜率 + 二次斜率 + 交叉。"""
    slopes = _slope_series(values)
    slope2 = _slope_series(slopes)
    pos = _pos250(values)
    up, down = _cross_series(values, [0.0] * len(values) if zero_cross else None)
    out: list[dict[str, Num]] = []
    for i in range(len(values)):
        out.append({
            f"{key}": _round4(values[i]),
            f"{key}_pos": pos[i],
            f"{key}_slope": _round4(slopes[i]),
            f"{key}_slope2": _round4(slope2[i]),
            f"{key}_cross_up": up[i],
            f"{key}_cross_down": down[i],
        })
    return out


def _compute_osc_groups(
    dates: list[str], highs: list[float], lows: list[float],
    closes: list[float], volumes: list[float], enabled: set[str],
) -> dict[str, list[dict[str, Num]] | None]:
    groups: dict[str, list[dict[str, Num]] | None] = {}

    def single(key: str, results: list[dict]) -> list[dict[str, Num]]:
        return _osc_group(key, _extract(results, key))

    if "stochrsi" in enabled:
        raw = calculate_stochrsi(dates, closes)
        ks = _extract(raw, "k")
        ds = _extract(raw, "d")
        k_slope = _slope_series(ks)
        up, down = _cross_series(ks, ds)
        groups["stochrsi"] = [
            {"stochrsi_k": _round4(ks[i]), "stochrsi_d": _round4(ds[i]),
             "stochrsi_pos": _round4(ks[i] / 100 if ks[i] is not None else None),
             "stochrsi_slope": _round4(k_slope[i]),
             "stochrsi_golden": up[i], "stochrsi_dead": down[i]}
            for i in range(len(dates))
        ]
    if "aroon" in enabled:
        raw = calculate_aroon(dates, highs, lows)
        upv = _extract(raw, "aroon_up")
        dnv = _extract(raw, "aroon_down")
        osc = [u - d if u is not None and d is not None else None for u, d in zip(upv, dnv)]
        osc_slope = _slope_series(osc)
        cross_up, cross_down = _cross_series(upv, dnv)
        groups["aroon"] = [
            {"aroon_up": _round4(upv[i]), "aroon_down": _round4(dnv[i]),
             "aroon_osc": _round4(osc[i]), "aroon_pos": _round4(osc[i] / 100 + 0.5 if osc[i] is not None else None),
             "aroon_slope": _round4(osc_slope[i]),
             "aroon_cross": 1 if cross_up[i] else (0 if cross_down[i] else (None if upv[i] is None else 0))}
            for i in range(len(dates))
        ]
    osc_specs = {
        "apo": (calculate_apo, "apo", "close"),
        "ppo": (calculate_ppo, "ppo", "close"),
        "pvo": (calculate_pvo, "pvo", "volume"),
        "roc": (calculate_roc, "roc", "close"),
        "mom": (calculate_mom, "mom", "close"),
        "trix": (calculate_trix, "trix", "close"),
        "willr": (calculate_willr, "willr", "ohlc"),
        "ultosc": (calculate_ultosc, "ultosc", "ohlc"),
        "cci": (calculate_cci, "cci", "ohlc"),
        "mfi": (calculate_mfi, "mfi", "ohlcv"),
        "adx": (calculate_adx, "adx", "ohlc"),
        "dx": (calculate_dx, "dx", "ohlc"),
    }
    for key, (fn, out_key, kind) in osc_specs.items():
        if key not in enabled:
            continue
        if kind == "close":
            raw = fn(dates, closes)
        elif kind == "volume":
            raw = fn(dates, volumes)
        elif kind == "ohlcv":
            raw = fn(dates, highs, lows, closes, volumes)
        else:
            raw = fn(dates, highs, lows, closes)
        groups[key] = single(out_key, raw)
    return groups


# ── 波動/區間族（14 個 × 4 欄）────────────────────────────────────────────

def _vol_group(key: str, values: list[float | None], closes: list[float]) -> list[dict[str, Num]]:
    """主值 + 對價比 + 斜率 + 250 日分位。"""
    slopes = _slope_series(values)
    pos = _pos250(values)
    out: list[dict[str, Num]] = []
    for i in range(len(values)):
        v = values[i]
        out.append({
            f"{key}": _round4(v),
            f"{key}_ratio": _round4(v / closes[i]) if v is not None and closes[i] else None,
            f"{key}_slope": _round4(slopes[i]),
            f"{key}_pos": pos[i],
        })
    return out


def _event_group(key: str, values: list[Num], closes: list[float], ref: list[float] | None = None) -> list[dict[str, Num]]:
    """事件族: 旗標 + 近 10 日次數 + 幅度 + 斜率。"""
    cnt = _cnt10(values)
    slopes = _slope_series([float(v) if v is not None else None for v in values])
    out: list[dict[str, Num]] = []
    for i in range(len(values)):
        v = values[i]
        base = ref[i] if ref else closes[i]
        out.append({
            f"{key}": v,
            f"{key}_cnt10": cnt[i],
            f"{key}_ratio": _round4(closes[i] / base - 1) if base and closes[i] is not None else None,
            f"{key}_slope": _round4(slopes[i]),
        })
    return out


def _compute_vol_groups(
    dates: list[str], highs: list[float], lows: list[float],
    closes: list[float], volumes: list[float], enabled: set[str],
) -> dict[str, list[dict[str, Num]] | None]:
    groups: dict[str, list[dict[str, Num]] | None] = {}

    def simple(key: str, results: list[dict]) -> list[dict[str, Num]]:
        return _vol_group(key, _extract(results, key), closes)

    if "atr" in enabled:
        groups["atr"] = simple("atr", calculate_atr(dates, highs, lows, closes))
    if "natr" in enabled:
        groups["natr"] = simple("natr", calculate_natr(dates, highs, lows, closes))
    if "stddev" in enabled:
        groups["stddev"] = simple("stddev", calculate_stddev(dates, closes))
    if "sar" in enabled:
        groups["sar"] = simple("sar", calculate_sar(dates, highs, lows))
    if "midprice" in enabled:
        groups["midprice"] = simple("midprice", calculate_midprice(dates, highs, lows))
    if "range3" in enabled:
        groups["range3"] = simple("range3", calculate_range3(dates, highs, lows, closes))
    if "day_high" in enabled:
        groups["day_high"] = simple("day_high", calculate_day_high(dates, highs))
    if "day_low" in enabled:
        groups["day_low"] = simple("day_low", calculate_day_low(dates, lows))
    if "max_n" in enabled:
        groups["max_n"] = simple("max_n", calculate_max_n(dates, highs))
    if "min_n" in enabled:
        groups["min_n"] = simple("min_n", calculate_min_n(dates, lows))
    if "adosc" in enabled:
        groups["adosc"] = simple("adosc", calculate_adosc(dates, highs, lows, closes, volumes))
    if "cmf" in enabled:
        groups["cmf"] = simple("cmf", calculate_cmf(dates, highs, lows, closes, volumes))
    if "breakout_high3" in enabled:
        raw = calculate_breakout_high3(dates, highs, closes)
        flags = _bool_series(_extract(raw, "breakout_high3"))
        groups["breakout_high3"] = _event_group("breakout_high3", flags, closes)
    if "new_high_n" in enabled:
        raw = calculate_new_high_n(dates, closes)
        flags = _bool_series(_extract(raw, "new_high_n"))
        groups["new_high_n"] = _event_group("new_high_n", flags, closes)
    return groups


# ── 布林壓縮噴出 ───────────────────────────────────────────────────────────

def _compute_bollinger_squeeze(
    dates: list[str], highs: list[float], lows: list[float],
    closes: list[float], enabled: bool,
) -> list[dict[str, Num]] | None:
    """帶寬 + 壓縮偵測（近 100 日最低 20%）+ 壓縮後突破方向。"""
    if not enabled:
        return None
    from src.indicators import calculate_bollinger

    raw = calculate_bollinger(dates, closes)
    n = len(dates)
    up = _extract(raw, "upper")
    mid = _extract(raw, "middle")
    lo = _extract(raw, "lower")
    width = [None if (a is None or m is None or l is None or m == 0)
             else (a - l) / m * 100 for a, m, l in zip(up, mid, lo)]
    squeeze: list[Num] = [None] * n
    prev_squeeze: list[Num] = [None] * n
    for i in range(n):
        if i < 99 or width[i] is None:
            continue
        window = [w for w in width[max(0, i - 99): i + 1] if w is not None]
        if len(window) < 50:
            continue
        threshold = sorted(window)[int(len(window) * 0.2)]
        squeeze[i] = 1 if width[i] <= threshold else 0
        prev_squeeze[i] = squeeze[i - 1] if i >= 1 else None
    out: list[dict[str, Num]] = []
    for i in range(n):
        out.append({
            "bb_width": _round4(width[i]),
            "bb_squeeze": squeeze[i],
            "bb_squeeze_break_up": (1 if prev_squeeze[i] and up[i] is not None and closes[i] > up[i] else 0)
            if prev_squeeze[i] is not None else None,
            "bb_squeeze_break_down": (1 if prev_squeeze[i] and lo[i] is not None and closes[i] < lo[i] else 0)
            if prev_squeeze[i] is not None else None,
        })
    return out


# ── Orchestrator ────────────────────────────────────────────────────────────

TREND_KEYS = ["ema", "wma", "hma", "kama", "dema", "tema", "vwma", "linearreg", "tsf"]
OSC_KEYS = ["stochrsi", "willr", "ultosc", "cci", "mfi", "apo", "ppo", "pvo", "roc", "mom", "trix", "adx", "dx", "aroon"]
VOL_KEYS = ["atr", "natr", "stddev", "sar", "midprice", "range3", "day_high", "day_low", "max_n", "min_n", "adosc", "cmf", "breakout_high3", "new_high_n"]
SQUEEZE_KEY = "bollinger_squeeze"

ALL_EXT_GROUPS = TREND_KEYS + OSC_KEYS + VOL_KEYS + [SQUEEZE_KEY]


def _group_enabled(config: dict, key: str) -> bool:
    group_cfg = config.get(key)
    return bool(group_cfg) and bool(group_cfg.get("enabled"))


def _parse_row(row: dict) -> dict | None:
    try:
        return {
            "date": str(row["date"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["volume"]),
        }
    except (KeyError, TypeError, ValueError):
        return None


def compute_features_ext(rows: list[dict], config: dict) -> list[dict]:
    """Compute the extended feature groups for ONE stock.

    rows: daily bars sorted by date ASC（與 src.features.compute_features 同輸入）。
    config: 群組開關 map（key → {enabled, params}）。
    Returns: list of dicts, SAME length as rows, each a flat feature dict.
    Per-row semantics match src.features: unparseable rows keep all feature
    keys as None while valid rows are still computed. Disabled groups output
    their declared keys as None.
    """
    if not rows:
        return []
    cfg = config or {}
    n = len(rows)
    all_keys = _all_keys(cfg)
    enabled = {k for k in ALL_EXT_GROUPS if _group_enabled(cfg, k)}
    if not enabled:
        return [dict.fromkeys(all_keys, None) for _ in range(n)]

    parsed = [_parse_row(r) for r in rows]
    valid_idx = [i for i, p in enumerate(parsed) if p is not None]
    if not valid_idx:
        return [dict.fromkeys(all_keys, None) for _ in range(n)]

    dates = [parsed[i]["date"] for i in valid_idx]
    highs = [parsed[i]["high"] for i in valid_idx]
    lows = [parsed[i]["low"] for i in valid_idx]
    closes = [parsed[i]["close"] for i in valid_idx]
    volumes = [parsed[i]["volume"] for i in valid_idx]

    trend = _compute_trend_groups(dates, closes, volumes, enabled)
    osc = _compute_osc_groups(dates, highs, lows, closes, volumes, enabled)
    vol = _compute_vol_groups(dates, highs, lows, closes, volumes, enabled)
    squeeze = _compute_bollinger_squeeze(dates, highs, lows, closes, SQUEEZE_KEY in enabled)

    groups: dict[str, list[dict[str, Num]] | None] = {**trend, **osc, **vol}
    if squeeze is not None:
        groups[SQUEEZE_KEY] = squeeze

    out: list[dict] = []
    cursor = 0
    for i in range(n):
        if parsed[i] is None:
            out.append(dict.fromkeys(all_keys, None))
            continue
        entry: dict[str, Num] = {}
        for key in ALL_EXT_GROUPS:
            series = groups.get(key)
            entry.update(series[cursor] if series is not None else {k: None for k in _keys_for(key, cfg)})
        out.append(entry)
        cursor += 1
    return out


def _keys_for(key: str, config: dict) -> list[str]:
    """單一群組的輸出欄位名（含 disabled 時的 None 欄位）。"""
    cfg = config.get(key) or {}
    params = cfg.get("params") or {}
    periods = _periods_param(params)
    if key in TREND_KEYS:
        pairs = [(a, b) for i, a in enumerate(periods) for b in periods[i + 1:]]
        keys = [f"{key}{p}" for p in periods]
        keys += [f"{key}_slope_{p}" for p in periods]
        keys += [f"{key}_slope2_{p}" for p in periods]
        keys += [f"{key}_spread_{a}_{b}" for a, b in pairs]
        keys += [f"{key}_spread_over", f"{key}_alignment_state"]
        return keys
    if key == "stochrsi":
        return ["stochrsi_k", "stochrsi_d", "stochrsi_pos", "stochrsi_slope", "stochrsi_golden", "stochrsi_dead"]
    if key == "aroon":
        return ["aroon_up", "aroon_down", "aroon_osc", "aroon_pos", "aroon_slope", "aroon_cross"]
    if key in OSC_KEYS:
        return [f"{key}", f"{key}_pos", f"{key}_slope", f"{key}_slope2", f"{key}_cross_up", f"{key}_cross_down"]
    if key in ("breakout_high3", "new_high_n"):
        return [f"{key}", f"{key}_cnt10", f"{key}_ratio", f"{key}_slope"]
    if key == SQUEEZE_KEY:
        return ["bb_width", "bb_squeeze", "bb_squeeze_break_up", "bb_squeeze_break_down"]
    return [f"{key}", f"{key}_ratio", f"{key}_slope", f"{key}_pos"]


def _periods_param(params: dict) -> list[int]:
    raw = params.get("MA 週期") or params.get("periods") or "8,13,21,34"
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.split(",") if p.strip()]
    else:
        parts = list(raw)
    out = []
    for p in parts:
        try:
            v = int(p)
        except (TypeError, ValueError):
            continue
        if v > 0:
            out.append(v)
    return out or [8, 13, 21, 34]


def _all_keys(config: dict) -> list[str]:
    keys: list[str] = []
    for key in ALL_EXT_GROUPS:
        keys.extend(_keys_for(key, config))
    return keys