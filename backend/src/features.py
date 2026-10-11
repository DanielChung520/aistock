"""特征值計算引擎 (feature-value computation engine) — 純計算模組。

Given daily OHLCV bars for ONE stock and a config map of enabled feature
groups / params (spec: ``.docs/charact.md`` §一–§六, output naming §九),
returns index-aligned flat feature dicts — one per input row.

- **Pure & stateless**: no I/O, no DB, no network, no router/task imports.
  Indicator math is reused from ``src.indicators``; Slope2 re-applies
  ``_slope_series`` on the slope series; MV slopes call ``calculate_ma``
  with the volumes series.
- **Disabled group** → all its keys are ``None`` for every row (writer may
  drop None-only groups or store them; this module leaves that choice).
- **Warmup / missing values are ``None``, never 0** (0 only when genuinely
  zero, e.g. ``three_up_str == 0`` = 平盤突破). Floats rounded to 4dp.
- **Defensive parsing**: rows whose OHLCV cannot coerce to float are skipped
  from the computation series (output keeps raw fields + all feature keys
  ``None``); ``[]`` for empty rows; never raises.
- **Alignment convention**: bit = 1 when MA[short] > MA[long] per ordered
  pair (spec table) — 完美多頭排列 (short>mid>long) = state 7, 完美空頭 = 0;
  ``alignment_score`` = Σ spread（多頭正、空頭負，規格 §三 B-1 有符號版）.
"""

from __future__ import annotations

import datetime
import math
from typing import Any

try:
    from src.indicators import (
        _slope_series, calculate_bollinger, calculate_kdj,
        calculate_ma, calculate_macd, calculate_rsi,
    )
except ModuleNotFoundError:
    # Standalone run (`python src/features.py`): sys.path points at src/,
    # so the sibling `indicators` module is importable directly.
    from indicators import (  # type: ignore[no-redef]
        _slope_series, calculate_bollinger, calculate_kdj,
        calculate_ma, calculate_macd, calculate_rsi,
    )

Num = float | int | None
MaybeFloat = float | None

_LOOKBACK_250 = 250
_PIVOT_LOOKBACK = 20
_BODY_LOOKBACK = 14

_PCT_KEYS = ["pct_change", "pct_change_2d", "up_2d"]
_RSI_KEYS = ["rsi", "rsi_pos", "rsi_dist_upper", "rsi_dist_lower"]
_KDJ_KEYS = ["kdj_k", "kdj_d", "kdj_j", "kdj_pos", "kdj_golden", "kdj_dead", "kdj_at_high", "kdj_at_low"]
_MACD_KEYS = ["macd_dif", "macd_signal", "macd_hist", "macd_hist_norm", "macd_pos", "macd_cross_up", "macd_cross_down"]
_THREE_KEYS = ["three_up", "three_down", "three_up_str", "three_down_str", "three_up_vol", "three_down_vol", "three_state"]
_CANDLE_KEYS = ["candle_long_body_up", "candle_long_body_down", "candle_doji", "candle_hammer", "candle_shooting_star", "candle_engulf_up", "candle_engulf_down", "candle_morning_star", "candle_evening_star", "candle_three_white", "candle_three_black"]
_MASTER_KEYS = ["near_52w_high", "break_52w_high", "vol_surge", "breakout_vol_confirm", "pivot_break", "line_of_least_resistance", "fly_high_vol", "above_200ma", "weekly_slope_30", "institution_accum", "vp_price_up_vol_up", "vp_price_up_vol_dn", "vp_price_dn_vol_up", "vp_price_dn_vol_dn", "vp_top_divergence", "vp_bottom_divergence", "vp_sky_vol", "vp_ground_vol", "obv", "obv_slope", "vr"]
_BOLLINGER_KEYS = ["bollinger_upper", "bollinger_middle", "bollinger_lower", "bb_width"]


def _to_float(value: Any) -> MaybeFloat:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _round4(value: MaybeFloat) -> MaybeFloat:
    return round(value, 4) if value is not None else None


def _parse_periods(raw: Any, default: list[int]) -> list[int]:
    """Parse a period spec like "8,13,21" (or a list) into positive ints."""
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.split(",") if p.strip()]
    elif isinstance(raw, (list, tuple)):
        parts = list(raw)
    else:
        return list(default)
    periods: list[int] = []
    for part in parts:
        number = _to_float(part)
        if number is not None and number > 0 and float(number).is_integer():
            periods.append(int(number))
    return periods if periods else list(default)


def _param(config: dict, group: str, name: str, default: Any) -> Any:
    group_cfg = config.get(group) or {}
    value = (group_cfg.get("params") or {}).get(name)
    return default if value is None else value


def _param_int(config: dict, group: str, name: str, default: int) -> int:
    number = _to_float(_param(config, group, name, default))
    return int(number) if number is not None else default


def _param_float(config: dict, group: str, name: str, default: float) -> float:
    number = _to_float(_param(config, group, name, default))
    return number if number is not None else default


def _group_enabled(config: dict, key: str) -> bool:
    group_cfg = config.get(key)
    return bool(group_cfg) and bool(group_cfg.get("enabled"))


def _sma(values: list[float], period: int) -> list[MaybeFloat]:
    out: list[MaybeFloat] = [None] * len(values)
    for i in range(len(values)):
        if i + 1 >= period:
            out[i] = sum(values[i + 1 - period : i + 1]) / period
    return out


def _obv(closes: list[float], volumes: list[float]) -> list[float]:
    """Cumulative OBV: up-day adds volume, down-day subtracts it."""
    obv = [0.0] * len(closes)
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            obv[i] = obv[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            obv[i] = obv[i - 1] - volumes[i]
        else:
            obv[i] = obv[i - 1]
    return obv


def _weekly_slope_flags(
    dates: list[str],
    closes: list[float],
    ma_period: int = 30,
) -> list[MaybeFloat]:
    """週線斜率角度旗標（規格 §六.3、§八.6）。

    以 ISO 週收盤價重取樣 → 週 MA{ma_period} → 週斜率（%）→ ``atan`` 角度。
    旗標 = 1 當 斜率 > 0 且 角度 ≥ 30°，否則 0；未達 warmup 或斜率缺失 → None。
    """
    week_last: dict[tuple[int, int], float] = {}
    week_order: list[tuple[int, int]] = []
    for date_str, close in zip(dates, closes):
        week = datetime.date.fromisoformat(date_str).isocalendar()[:2]
        if week not in week_last:
            week_order.append(week)
        week_last[week] = close
    weekly_closes = [week_last[w] for w in week_order]
    weekly_ma = _sma(weekly_closes, ma_period)
    weekly_slope = _slope_series(weekly_ma)
    flag_by_week: dict[tuple[int, int], MaybeFloat] = {}
    for week, slope in zip(week_order, weekly_slope):
        if slope is None:
            flag_by_week[week] = None
        else:
            flag_by_week[week] = 1 if slope > 0 and math.degrees(math.atan(slope)) >= 30 else 0
    return [flag_by_week[datetime.date.fromisoformat(d).isocalendar()[:2]] for d in dates]


def _slope_keys(ma_periods: list[int], mv_periods: list[int]) -> list[str]:
    keys: list[str] = []
    for period in ma_periods:
        keys.append(f"slope_ma{period}")
        keys.append(f"slope2_ma{period}")
    for period in mv_periods:
        keys.append(f"slope_mv{period}")
        keys.append(f"slope2_mv{period}")
    return keys


def _divergence_keys(ma_periods: list[int]) -> list[str]:
    periods = sorted(ma_periods)
    keys: list[str] = [
        f"spread_{periods[i]}_{periods[j]}"
        for i in range(len(periods))
        for j in range(i + 1, len(periods))
    ]
    keys.append("spread_over")
    keys.extend(["divergence", "divergence_delta", "alignment_score", "alignment_state"])
    return keys

# ---- Feature groups (each returns dicts aligned to the input series) ----


def _compute_pct(closes: list[float]) -> list[dict[str, Num]]:
    """§一.0 漲幅 / 連續兩天漲幅."""
    out: list[dict[str, Num]] = []
    for i, close in enumerate(closes):
        pct = (close - closes[i - 1]) / closes[i - 1] * 100 if i >= 1 and closes[i - 1] != 0 else None
        pct2 = (close - closes[i - 2]) / closes[i - 2] * 100 if i >= 2 and closes[i - 2] != 0 else None
        up = 1 if i >= 2 and close > closes[i - 1] and closes[i - 1] > closes[i - 2] else (None if i < 2 else 0)
        out.append({"pct_change": _round4(pct), "pct_change_2d": _round4(pct2), "up_2d": up})
    return out


def _compute_slope(
    dates: list[str],
    closes: list[float],
    volumes: list[float],
    ma_periods: list[int],
    mv_periods: list[int],
) -> list[dict[str, Num]]:
    """§一.1 MA/MV 一次斜率 + 二次斜率."""
    n = len(closes)
    ma: dict[int, list[MaybeFloat]] = {}
    mv: dict[int, list[MaybeFloat]] = {}
    if ma_periods:
        result = calculate_ma(dates, closes, ma_periods, ma_type="sma")
        for p in ma_periods:
            ma[p] = [entry[f"ma{p}"] for entry in result]
    if mv_periods:
        result = calculate_ma(dates, volumes, mv_periods, ma_type="sma")
        for p in mv_periods:
            mv[p] = [entry[f"ma{p}"] for entry in result]
    s1 = {p: _slope_series(ma[p]) for p in ma_periods}
    s2 = {p: _slope_series(s1[p]) for p in ma_periods}
    m1 = {p: _slope_series(mv[p]) for p in mv_periods}
    m2 = {p: _slope_series(m1[p]) for p in mv_periods}
    out: list[dict[str, Num]] = []
    for i in range(n):
        entry: dict[str, Num] = {}
        for p in ma_periods:
            entry[f"slope_ma{p}"] = _round4(s1[p][i])
            entry[f"slope2_ma{p}"] = _round4(s2[p][i])
        for p in mv_periods:
            entry[f"slope_mv{p}"] = _round4(m1[p][i])
            entry[f"slope2_mv{p}"] = _round4(m2[p][i])
        out.append(entry)
    return out


def _compute_rsi(
    dates: list[str],
    closes: list[float],
    period: int,
    upper: float,
    lower: float,
) -> list[dict[str, Num]]:
    """§二 RSI 上下限位置特徵."""
    out: list[dict[str, Num]] = []
    for entry in calculate_rsi(dates, closes, period=period):
        rsi = entry["rsi"]
        pos = rsi / 100 if rsi is not None else None
        out.append(
            {"rsi": rsi, "rsi_pos": _round4(pos),
             "rsi_dist_upper": _round4(upper - rsi if rsi is not None else None),
             "rsi_dist_lower": _round4(rsi - lower if rsi is not None else None)}
        )
    return out


def _compute_kdj(
    dates: list[str],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int,
    k_smooth: int,
    d_smooth: int,
) -> list[dict[str, Num]]:
    """§二 KDJ 位置 + 交叉特徵.

    Warmup：未達週期（i+1 < period）輸出 None（規格 §九），K/D 的種子 50 僅為
    內部平滑起點，不作為輸出值。kdj_at_high/low：收盤在近 20 日高低價 2% 內。
    """
    raw = calculate_kdj(dates, highs, lows, closes, period=period, k_smooth=k_smooth, d_smooth=d_smooth)
    out: list[dict[str, Num]] = []
    for i, entry in enumerate(raw):
        k, d, j = entry["k"], entry["d"], entry["j"]
        warmup = i + 1 < period
        golden = dead = None
        if not warmup and i >= 1:
            prev_k, prev_d = raw[i - 1]["k"], raw[i - 1]["d"]
            if prev_k is not None and prev_d is not None:
                golden = 1 if k > d and prev_k <= prev_d else 0
                dead = 1 if k < d and prev_k >= prev_d else 0
        if i + 1 >= 20:
            hi20 = max(highs[i - 19 : i + 1])
            lo20 = min(lows[i - 19 : i + 1])
            at_high = 1 if closes[i] >= hi20 * 0.98 else 0
            at_low = 1 if closes[i] <= lo20 * 1.02 else 0
        else:
            at_high = at_low = None
        out.append(
            {"kdj_k": None if warmup else k, "kdj_d": None if warmup else d,
             "kdj_j": None if warmup else j,
             "kdj_pos": _round4(k / 100) if not warmup and k is not None else None,
             "kdj_golden": golden, "kdj_dead": dead,
             "kdj_at_high": at_high, "kdj_at_low": at_low}
        )
    return out


def _compute_macd(
    dates: list[str],
    closes: list[float],
    fast: int,
    slow: int,
    signal: int,
) -> list[dict[str, Num]]:
    """§二 MACD 標準化 / 250 日分位 / 交叉特徵."""
    raw = calculate_macd(dates, closes, fast=fast, slow=slow, signal=signal)
    hists = [entry["histogram"] for entry in raw]
    out: list[dict[str, Num]] = []
    for i, entry in enumerate(raw):
        dif, sig, hist = entry["dif"], entry["signal"], entry["histogram"]
        hist_norm = pos = None
        cross_up = cross_down = None
        if hist is not None:
            if closes[i]:
                hist_norm = hist / closes[i] * 100
            window = [h for h in hists[max(0, i - _LOOKBACK_250 + 1) : i + 1] if h is not None]
            if window:
                pos = sum(1 for h in window if h <= hist) / len(window)
        if i >= 1 and dif is not None and sig is not None:
            prev_dif, prev_sig = raw[i - 1]["dif"], raw[i - 1]["signal"]
            if prev_dif is not None and prev_sig is not None:
                cross_up = 1 if dif > sig and prev_dif <= prev_sig else 0
                cross_down = 1 if dif < sig and prev_dif >= prev_sig else 0
        out.append(
            {"macd_dif": dif, "macd_signal": sig, "macd_hist": hist,
             "macd_hist_norm": _round4(hist_norm), "macd_pos": _round4(pos),
             "macd_cross_up": cross_up, "macd_cross_down": cross_down}
        )
    return out


def _compute_divergence(
    dates: list[str],
    closes: list[float],
    ma_periods: list[int],
) -> list[dict[str, Num]]:
    """§三 MA 發散（A 連續 + B-1 打分 + B-2 bit 狀態）."""
    periods = sorted(ma_periods)
    n = len(closes)
    ma: dict[int, list[MaybeFloat]] = {}
    if periods:
        result = calculate_ma(dates, closes, periods, ma_type="sma")
        for p in periods:
            ma[p] = [entry[f"ma{p}"] for entry in result]
    pairs = [(periods[i], periods[j]) for i in range(len(periods)) for j in range(i + 1, len(periods))]
    weights = {(a, b): 2.0 / (b - a) for a, b in pairs}

    out: list[dict[str, Num]] = []
    prev_div: MaybeFloat = None
    for i in range(n):
        entry: dict[str, Num] = {}
        spreads: list[MaybeFloat] = []
        for a, b in pairs:
            ma_a, ma_b = ma[a][i], ma[b][i]
            spread = None
            if ma_a is not None and ma_b is not None and ma_b != 0:
                spread = ma_a / ma_b - 1
            entry[f"spread_{a}_{b}"] = _round4(spread)
            spreads.append(spread)
        complete = all(s is not None for s in spreads)
        if periods:
            ma_s, ma_l = ma[periods[0]][i], ma[periods[-1]][i]
            if ma_s is not None and ma_l is not None and ma_l != 0:
                entry["spread_over"] = _round4(ma_s / ma_l - 1)
            else:
                entry["spread_over"] = None
                complete = False
        else:
            entry["spread_over"] = None
        divergence = sum(weights[(a, b)] * s for (a, b), s in zip(pairs, spreads)) if complete else None
        entry["divergence"] = _round4(divergence)
        entry["divergence_delta"] = _round4(divergence - prev_div) if complete and prev_div is not None else None
        if complete:
            prev_div = divergence
        score = 0.0
        score_ok = True
        state = 0
        for bit_pos, ((a, b), s) in enumerate(zip(pairs, spreads)):
            if s is None:
                score_ok = False
                break
            if s > 0:
                state |= 1 << bit_pos
            score += s  # 有符號：多頭(spread>0)為正、空頭為負（規格 §三 B-1）
        entry["alignment_score"] = _round4(score) if score_ok else None
        entry["alignment_state"] = state if score_ok else None
        out.append(entry)
    return out


def _compute_three(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[float],
) -> list[dict[str, Num]]:
    """§四 三盤突破 / 三盤跌破（close 確認版）."""
    out: list[dict[str, Num]] = []
    for i, close in enumerate(closes):
        if i < 2:
            out.append({k: None for k in _THREE_KEYS})
            continue
        prev_high, prev_low = max(highs[i - 1], highs[i - 2]), min(lows[i - 1], lows[i - 2])
        three_up = 1 if close > prev_high else 0
        three_down = 1 if close < prev_low else 0
        up_str = (close / prev_high - 1) * 100 if prev_high != 0 else None
        down_str = (close / prev_low - 1) * 100 if prev_low != 0 else None
        vol_up = volumes[i] > volumes[i - 1] and volumes[i] > volumes[i - 2]
        out.append(
            {"three_up": three_up, "three_down": three_down,
             "three_up_str": _round4(up_str), "three_down_str": _round4(down_str),
             "three_up_vol": 1 if three_up and vol_up else 0,
             "three_down_vol": 1 if three_down and vol_up else 0,
             "three_state": 1 if three_up else (2 if three_down else 0)}
        )
    return out


def _compute_candles(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    lookback: int = _BODY_LOOKBACK,
) -> list[dict[str, Num]]:
    """§五 酒田戰法 11 種形態；實體門檻 = 1.5×前 lookback 日平均實體."""
    n = len(closes)
    bodies = [abs(c - o) for c, o in zip(closes, opens)]
    thresholds: list[MaybeFloat] = [None] * n
    for i in range(n):
        if i >= lookback:
            thresholds[i] = sum(bodies[i - lookback : i]) / lookback

    def is_long(i: int, up: bool) -> Num:
        t = thresholds[i]
        if t is None:
            return None
        return bodies[i] >= 1.5 * t and (closes[i] > opens[i] if up else closes[i] < opens[i])

    def pat(*bools: Num) -> Num:
        return 1 if all(bools) else (0 if None not in bools else None)

    out: list[dict[str, Num]] = []
    for i in range(n):
        body, rng = bodies[i], highs[i] - lows[i]
        upper = highs[i] - max(opens[i], closes[i])
        lower = min(opens[i], closes[i]) - lows[i]
        entry: dict[str, Num] = {
            "candle_long_body_up": is_long(i, True),
            "candle_long_body_down": is_long(i, False),
            "candle_doji": 1 if body <= rng * 0.1 else 0,
            "candle_hammer": 1 if body > 0 and lower >= 2 * body and upper <= body else 0,
            "candle_shooting_star": 1 if body > 0 and upper >= 2 * body and lower <= body else 0,
        }
        if i >= 1:
            prev_min, prev_max = min(opens[i - 1], closes[i - 1]), max(opens[i - 1], closes[i - 1])
            entry["candle_engulf_up"] = 1 if closes[i] > opens[i] and opens[i] <= prev_min and closes[i] >= prev_max else 0
            entry["candle_engulf_down"] = 1 if closes[i] < opens[i] and opens[i] >= prev_max and closes[i] <= prev_min else 0
        else:
            entry["candle_engulf_up"] = entry["candle_engulf_down"] = None
        if i >= 2:
            mid = (highs[i - 2] + lows[i - 2]) / 2
            prev1_small = bodies[i - 1] <= thresholds[i - 1] if thresholds[i - 1] is not None else None
            entry["candle_morning_star"] = pat(is_long(i - 2, False), prev1_small, is_long(i, True), closes[i] > mid)
            entry["candle_evening_star"] = pat(is_long(i - 2, True), prev1_small, is_long(i, False), closes[i] < mid)
            entry["candle_three_white"] = pat(is_long(i - 2, True), is_long(i - 1, True), is_long(i, True), closes[i - 2] < closes[i - 1] < closes[i])
            entry["candle_three_black"] = pat(is_long(i - 2, False), is_long(i - 1, False), is_long(i, False), closes[i - 2] > closes[i - 1] > closes[i])
        else:
            for key in ("candle_morning_star", "candle_evening_star", "candle_three_white", "candle_three_black"):
                entry[key] = None
        out.append(entry)
    return out


def _compute_master(
    dates: list[str],
    closes: list[float],
    highs: list[float],
    lows: list[float],
    volumes: list[float],
) -> list[dict[str, Num]]:
    """§六 大師量價指標（CANSLIM / 李佛摩 / 林則行 / 量價 8 法 / OBV / VR）."""
    n = len(closes)
    ma5_vol = _sma(volumes, 5)
    weekly_flags = _weekly_slope_flags(dates, closes)
    ma200 = _sma(closes, 200)
    obv = _obv(closes, volumes)
    obv_slope = _slope_series(obv)
    # VR(26)：近 26 日（含當日）漲日量 / 跌日量 × 100；未達 26 日 warmup 存 null（規格 §六.6、§九）。
    up_vol = [0.0] * n
    down_vol = [0.0] * n
    for i in range(n):
        if i < 25:
            up_vol[i] = down_vol[i] = 0.0
            continue
        lo = i - 25
        for j in range(lo, i + 1):
            if closes[j] > closes[j - 1]:
                up_vol[i] += volumes[j]
            elif closes[j] < closes[j - 1]:
                down_vol[i] += volumes[j]

    out: list[dict[str, Num]] = []
    for i in range(n):
        has_250 = i >= _LOOKBACK_250 - 1
        has_250p = i >= _LOOKBACK_250
        win_highs = highs[max(0, i - _LOOKBACK_250 + 1) : i + 1]
        win_vols = volumes[max(0, i - _LOOKBACK_250 + 1) : i + 1]
        prior_highs = highs[max(0, i - _LOOKBACK_250) : i]
        prior_closes = closes[max(0, i - _LOOKBACK_250) : i]
        prior_obv = obv[max(0, i - _LOOKBACK_250) : i]
        ma5 = ma5_vol[i]

        entry: dict[str, Num] = {}
        # CANSLIM 量能核心。
        max_h = max(win_highs)
        entry["near_52w_high"] = 1 if has_250 and closes[i] >= 0.95 * max_h else (None if not has_250 else 0)
        entry["break_52w_high"] = 1 if has_250 and closes[i] > max_h else (None if not has_250 else 0)
        entry["vol_surge"] = None if ma5 is None else (1 if volumes[i] > 1.4 * ma5 else 0)
        if entry["break_52w_high"] is None or entry["vol_surge"] is None:
            entry["breakout_vol_confirm"] = None
        else:
            entry["breakout_vol_confirm"] = 1 if entry["break_52w_high"] and entry["vol_surge"] else 0
        if i >= _PIVOT_LOOKBACK:
            pivot = 1 if closes[i] > max(highs[i - _PIVOT_LOOKBACK : i]) else 0
            entry["pivot_break"] = pivot
            entry["line_of_least_resistance"] = 1 if pivot and volumes[i] > volumes[i - 1] else 0
        else:
            entry["pivot_break"] = entry["line_of_least_resistance"] = None
        if ma5 is not None and has_250p:
            entry["fly_high_vol"] = 1 if volumes[i] >= 1.5 * ma5 and closes[i] > max(prior_highs) else 0
        else:
            entry["fly_high_vol"] = None
        ma200_now = ma200[i]
        entry["above_200ma"] = None if ma200_now is None else (1 if closes[i] > ma200_now else 0)
        entry["weekly_slope_30"] = weekly_flags[i]
        entry["institution_accum"] = None  # 需 stock_institutional_flows（法人買賣超），OHLCV 無法計算。
        if i >= 1:
            pu, pd = closes[i] > closes[i - 1], closes[i] < closes[i - 1]
            vu, vd = volumes[i] > volumes[i - 1], volumes[i] < volumes[i - 1]
            entry["vp_price_up_vol_up"] = 1 if pu and vu else 0
            entry["vp_price_up_vol_dn"] = 1 if pu and vd else 0
            entry["vp_price_dn_vol_up"] = 1 if pd and vu else 0
            entry["vp_price_dn_vol_dn"] = 1 if pd and vd else 0
        else:
            for key in ("vp_price_up_vol_up", "vp_price_up_vol_dn", "vp_price_dn_vol_up", "vp_price_dn_vol_dn"):
                entry[key] = None
        if has_250p:
            price_hi = closes[i] > max(prior_closes)
            price_lo = closes[i] < min(prior_closes)
            obv_hi = obv[i] > max(prior_obv)
            obv_lo = obv[i] < min(prior_obv)
            entry["vp_top_divergence"] = 1 if price_hi and not obv_hi else 0
            entry["vp_bottom_divergence"] = 1 if price_lo and not obv_lo else 0
        else:
            entry["vp_top_divergence"] = entry["vp_bottom_divergence"] = None
        entry["vp_sky_vol"] = 1 if has_250 and volumes[i] >= max(win_vols) else (None if not has_250 else 0)
        entry["vp_ground_vol"] = 1 if has_250 and volumes[i] <= min(win_vols) else (None if not has_250 else 0)
        entry["obv"] = _round4(obv[i])
        entry["obv_slope"] = _round4(obv_slope[i])
        entry["vr"] = _round4(up_vol[i] / down_vol[i] * 100) if down_vol[i] > 0 else None
        out.append(entry)
    return out


def _compute_bollinger(
    dates: list[str],
    closes: list[float],
    period: int,
    std_dev: float,
) -> list[dict[str, Num]]:
    """§六 Bollinger（直接重用 calculate_bollinger）+ 帶寬 bb_width."""
    out: list[dict[str, Num]] = []
    for entry in calculate_bollinger(dates, closes, period=period, std_dev=std_dev):
        up, mid, low = entry["upper"], entry["middle"], entry["lower"]
        width = (up - low) / mid * 100 if up is not None and mid and low is not None else None
        out.append(
            {"bollinger_upper": up,
             "bollinger_middle": mid,
             "bollinger_lower": low,
             "bb_width": _round4(width)}
        )
    return out

# ---- Orchestrator ----


def _parse_row(row: dict) -> dict | None:
    """Coerce a raw row into a clean numeric dict; None if OHLCV unparseable."""
    fields = {k: _to_float(row.get(k)) for k in ("open", "high", "low", "close", "volume", "o1", "c1")}
    if any(fields[k] is None for k in ("open", "high", "low", "close", "volume")):
        return None
    fields["date"] = row.get("date")
    return fields


def _raw_fields(row: dict) -> dict[str, Any]:
    entry: dict[str, Any] = {"date": row.get("date")}
    for key in ("open", "high", "low", "close", "volume", "o1", "c1"):
        entry[key] = _to_float(row.get(key))
    return entry


def compute_features(rows: list[dict], config: dict) -> list[dict]:
    """Compute per-date feature values for ONE stock.
    rows: daily bars sorted by date ASC. Each: ``{date, open, high, low,
          close, volume, o1?, c1?}`` (o1/c1 may be absent or None).
    config: feature enable/params map, keys = feature group keys from the
          settings modal (see module docstring for the shape).
    Returns: list of dicts, SAME length as rows (index-aligned), each a
          flat feature dict with field names exactly per spec §九.
    """
    if not rows:
        return []
    cfg = config or {}
    slope_ma = _parse_periods(_param(cfg, "slope", "MA 週期", None), [8, 13, 21])
    mv = _parse_periods(_param(cfg, "slope", "MV 週期", None), [5, 10])
    div_ma = _parse_periods(_param(cfg, "divergence", "MA 週期", None), [8, 13, 21])
    rsi_period = _param_int(cfg, "rsi", "週期", 14)
    rsi_upper = _param_float(cfg, "rsi", "超買線", 70.0)
    rsi_lower = _param_float(cfg, "rsi", "超賣線", 30.0)
    kdj_period = _param_int(cfg, "kdj", "週期", 9)
    kdj_k = _param_int(cfg, "kdj", "K 平滑", 3)
    kdj_d = _param_int(cfg, "kdj", "D 平滑", 3)
    macd_fast = _param_int(cfg, "macd", "快", 12)
    macd_slow = _param_int(cfg, "macd", "慢", 26)
    macd_sig = _param_int(cfg, "macd", "訊號", 9)
    boll_period = _param_int(cfg, "bollinger", "週期", 20)
    boll_std = _param_float(cfg, "bollinger", "標準差", 2.0)
    groups = [
        ("pct", _PCT_KEYS),
        ("slope", _slope_keys(slope_ma, mv)),
        ("rsi", _RSI_KEYS),
        ("kdj", _KDJ_KEYS),
        ("macd", _MACD_KEYS),
        ("divergence", _divergence_keys(div_ma)),
        ("three", _THREE_KEYS),
        ("candle", _CANDLE_KEYS),
        ("master", _MASTER_KEYS),
        ("bollinger", _BOLLINGER_KEYS),
    ]
    all_keys = [key for _, keys in groups for key in keys]
    parsed = [_parse_row(row) for row in rows]
    valid = [i for i, row in enumerate(parsed) if row is not None]
    if not valid:
        none_row = _raw_fields(rows[0])
        none_row.update({key: None for key in all_keys})
        return [dict(none_row) for _ in rows]
    dates = [parsed[i]["date"] for i in valid]
    opens = [parsed[i]["open"] for i in valid]
    highs = [parsed[i]["high"] for i in valid]
    lows = [parsed[i]["low"] for i in valid]
    closes = [parsed[i]["close"] for i in valid]
    volumes = [parsed[i]["volume"] for i in valid]
    enabled = lambda g: _group_enabled(cfg, g)  # noqa: E731
    computed = {
        "pct": _compute_pct(closes) if enabled("pct") else None,
        "slope": _compute_slope(dates, closes, volumes, slope_ma, mv) if enabled("slope") else None,
        "rsi": _compute_rsi(dates, closes, rsi_period, rsi_upper, rsi_lower) if enabled("rsi") else None,
        "kdj": _compute_kdj(dates, highs, lows, closes, kdj_period, kdj_k, kdj_d) if enabled("kdj") else None,
        "macd": _compute_macd(dates, closes, macd_fast, macd_slow, macd_sig) if enabled("macd") else None,
        "divergence": _compute_divergence(dates, closes, div_ma) if enabled("divergence") else None,
        "three": _compute_three(highs, lows, closes, volumes) if enabled("three") else None,
        "candle": _compute_candles(opens, highs, lows, closes) if enabled("candle") else None,
        "master": _compute_master(dates, closes, highs, lows, volumes) if enabled("master") else None,
        "bollinger": _compute_bollinger(dates, closes, boll_period, boll_std) if enabled("bollinger") else None,
    }
    output: list[dict] = []
    cursor = 0
    for row, row_parsed in zip(rows, parsed):
        if row_parsed is None:
            entry = _raw_fields(row)
            entry.update({key: None for key in all_keys})
            output.append(entry)
            continue
        entry = {
            "date": row_parsed["date"],
            "open": row_parsed["open"], "high": row_parsed["high"],
            "low": row_parsed["low"], "close": row_parsed["close"],
            "volume": row_parsed["volume"], "o1": row_parsed["o1"], "c1": row_parsed["c1"],
        }
        for name, keys in groups:
            series = computed[name]
            entry.update(series[cursor] if series is not None else {key: None for key in keys})
        output.append(entry)
        cursor += 1
    return output

# ---- Self-test (only prints — no I/O otherwise) ----


def _synthetic_rows(count: int = 300) -> list[dict]:
    """Deterministic synthetic OHLCV bars for the self-test."""
    import datetime
    import random
    rng = random.Random(42)
    start = datetime.date(2018, 1, 2)
    rows: list[dict] = []
    price = 100.0
    for i in range(count):
        price *= 1 + (0.05 + rng.gauss(0, 1.5)) / 100
        o = price * (1 + rng.gauss(0, 0.4) / 100)
        h = max(o, price) * (1 + abs(rng.gauss(0, 0.5)) / 100)
        l = min(o, price) * (1 - abs(rng.gauss(0, 0.5)) / 100)
        rows.append(
            {
                "date": (start + datetime.timedelta(days=i)).isoformat(),
                "open": round(o, 2),
                "high": round(h, 2),
                "low": round(l, 2),
                "close": round(price, 2),
                "volume": round(1000 + 4000 * (1 + 0.05 * math.sin(i / 7)) + rng.uniform(0, 300), 2),
                "o1": round(o + (price - o) * 0.3, 2),
                "c1": round(o + (price - o) * 0.7, 2),
            }
        )
    return rows


if __name__ == "__main__":
    _rows = _synthetic_rows(300)
    _config = {
        "pct": {"enabled": True},
        "slope": {"enabled": True, "params": {"MA 週期": "8,13,21", "MV 週期": "5,10"}},
        "rsi": {"enabled": True, "params": {"週期": "14", "超買線": "70", "超賣線": "30"}},
        "kdj": {"enabled": True, "params": {"週期": "9", "K 平滑": "3", "D 平滑": "3"}},
        "macd": {"enabled": True, "params": {"快": "12", "慢": "26", "訊號": "9"}},
        "divergence": {"enabled": True, "params": {"MA 週期": "8,13,21"}},
        "three": {"enabled": True},
        "candle": {"enabled": True},
        "master": {"enabled": True},
        "bollinger": {"enabled": True, "params": {"週期": "20", "標準差": "2"}},
    }
    _result = compute_features(_rows, _config)
    print(f"rows={len(_rows)} output={len(_result)}")
    _last = _result[-1]
    for _key in (
        "date", "close", "pct_change", "slope_ma8", "slope2_ma8", "rsi", "kdj_golden",
        "macd_pos", "divergence", "alignment_state", "three_state", "candle_doji",
        "near_52w_high", "obv", "vr", "bollinger_upper",
    ):
        print(f"  {_key}: {_last[_key]}")
    print(f"  total keys: {len(_last)}")
