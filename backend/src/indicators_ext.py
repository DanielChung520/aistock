"""擴充技術指標計算模組（知識庫 32 個未實作指標的實作）。

本模組實作 .docs/indicators/ 知識庫中原本標記為「未實作」的 32 個指標，
全部為純函數（無 IO），輸出格式與 src/indicators.py 一致：

    list[dict] — 每個 dict 為 {"date": str, "<metric>": float | bool | None}，
    未達 warmup 的 bar 其值為 None，數值 round 到 2 位小數。

函式命名 calculate_<metric>，輸出欄位名與知識庫 JSON 的 metric 一致。

僅使用標準庫 math，不依賴 numpy / pandas / ta-lib。
"""

from __future__ import annotations

import math
from collections.abc import Sequence


# ---------------------------------------------------------------------------
# 共用小工具
# ---------------------------------------------------------------------------

def _ema_series(values: Sequence[float | None], period: int) -> list[float | None]:
    """EMA 序列，未達 warmup 的 bar 為 None。

    輸入可能含 None（如 EMA 的 EMA）：前 period 個有效值為 seed（SMA），
    None 之後的計算維持前一值，直到累積滿 period 個有效值才開始輸出。
    """
    if period <= 0:
        raise ValueError("period must be greater than 0")
    n = len(values)
    out: list[float | None] = [None] * n

    # 找前 period 個有效值的位置與數值
    valid_idx: list[int] = []
    valid_vals: list[float] = []
    for i, v in enumerate(values):
        if v is not None:
            valid_idx.append(i)
            valid_vals.append(v)
        if len(valid_vals) == period:
            break
    if len(valid_vals) < period:
        return out

    seed_idx = valid_idx[period - 1]
    seed = sum(valid_vals[:period]) / period
    alpha = 2 / (period + 1)
    out[seed_idx] = seed
    prev = seed

    for i in range(seed_idx + 1, n):
        cur = values[i]
        if cur is not None:
            prev = cur * alpha + prev * (1 - alpha)
            out[i] = prev
        # None 維持 prev 但不輸出
    return out


def _wma_series(values: Sequence[float], period: int) -> list[float | None]:
    """WMA 序列，權重線性遞增：最遠期權重 1、最近期權重 period。"""
    out: list[float | None] = [None] * len(values)
    if period <= 0:
        raise ValueError("period must be greater than 0")
    if len(values) < period:
        return out
    weight_sum = period * (period + 1) / 2
    for i in range(period - 1, len(values)):
        window = values[i + 1 - period : i + 1]
        out[i] = sum(v * w for v, w in zip(window, range(1, period + 1))) / weight_sum
    return out


def _valid(values: Sequence[float | None]) -> list[float]:
    """過濾 None，保留有效數值（連帶位置資訊由呼叫端自行處理）。"""
    return [v for v in values if v is not None]


# ---------------------------------------------------------------------------
# 趨勢類（9）：ema / wma / hma / kama / dema / tema / vwma / midprice / sar
# ---------------------------------------------------------------------------

def calculate_ema(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 12,
) -> list[dict[str, float | str | None]]:
    """EMA 指數移動平均：EMA(t) = C(t)*k + EMA(t-1)*(1-k)，k = 2/(period+1)。"""
    series = _ema_series(closes, period)
    return [
        {"date": d, "ema": round(v, 2) if v is not None else None}
        for d, v in zip(dates, series)
    ]


def calculate_wma(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 30,
) -> list[dict[str, float | str | None]]:
    """WMA 加權移動平均：權重線性遞增（最遠 1、最近 period）。"""
    series = _wma_series(closes, period)
    return [
        {"date": d, "wma": round(v, 2) if v is not None else None}
        for d, v in zip(dates, series)
    ]


def calculate_hma(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 16,
) -> list[dict[str, float | str | None]]:
    """HMA 赫爾移動平均：HMA = WMA(2*WMA(n/2) - WMA(n), sqrt(n))。

    n/2 與 sqrt(n) 均以四捨五入取整數（TA-Lib 慣例）。
    """
    if period < 2:
        raise ValueError("period must be >= 2")
    half = max(1, round(period / 2))
    root = max(1, round(math.sqrt(period)))
    wma_half = _wma_series(closes, half)
    wma_full = _wma_series(closes, period)

    # 差值序列 2*WMA(n/2) - WMA(n)，兩者皆可用處才有效
    diff: list[float | None] = [None] * len(closes)
    for i in range(len(closes)):
        a = wma_half[i]
        b = wma_full[i]
        if a is not None and b is not None:
            diff[i] = 2 * a - b

    # 對有效差值序列取 WMA(root)
    valid_idx = [i for i, v in enumerate(diff) if v is not None]
    valid_vals = [v for v in diff if v is not None]
    smoothed = _wma_series(valid_vals, root)

    out: list[dict[str, float | str | None]] = []
    for i, d in enumerate(dates):
        if i < len(valid_idx) and (valid_idx[i] - i) == 0 and i < len(valid_idx):
            pass
        out.append({"date": d, "hma": None})
    # 以有效差值的 WMA 結果對回原始時間軸
    for k, idx in enumerate(valid_idx):
        if k < len(smoothed) and smoothed[k] is not None:
            out[idx] = {"date": dates[idx], "hma": round(smoothed[k], 2)}
    return out


def calculate_kama(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 10,
    fast: int = 2,
    slow: int = 30,
) -> list[dict[str, float | str | None]]:
    """KAMA 考夫曼自適應移動平均。

    ER = |C(t)-C(t-period)| / Σ|C(i)-C(i-1)| (period 期)
    SC = (ER*(2/(fast+1)-2/(slow+1)) + 2/(slow+1))^2
    KAMA(t) = KAMA(t-1) + SC*(C(t)-KAMA(t-1))
    """
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "kama": None} for d in dates]
    if n < period:
        return out

    fast_sc = 2 / (fast + 1)
    slow_sc = 2 / (slow + 1)

    # 第一個有效 KAMA 用前 period 根當 seed（TA-Lib：KAMA[period-1] = close[period-1]）
    kama_prev = closes[period - 1]
    out[period - 1] = {"date": dates[period - 1], "kama": round(kama_prev, 2)}

    for i in range(period, n):
        change = abs(closes[i] - closes[i - period])
        volatility = sum(
            abs(closes[j] - closes[j - 1]) for j in range(i - period + 1, i + 1)
        )
        er = change / volatility if volatility != 0 else 0.0
        sc = (er * (fast_sc - slow_sc) + slow_sc) ** 2
        kama_prev = kama_prev + sc * (closes[i] - kama_prev)
        out[i] = {"date": dates[i], "kama": round(kama_prev, 2)}
    return out


def calculate_dema(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 30,
) -> list[dict[str, float | str | None]]:
    """DEMA 雙重指數移動平均：DEMA = 2*EMA(price) - EMA(EMA(price))。"""
    ema1 = _ema_series(closes, period)
    ema2 = _ema_series(ema1, period)
    return [
        {
            "date": d,
            "dema": round(2 * a - b, 2) if a is not None and b is not None else None,
        }
        for d, a, b in zip(dates, ema1, ema2)
    ]


def calculate_tema(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 30,
) -> list[dict[str, float | str | None]]:
    """TEMA 三重指數移動平均：TEMA = 3*EMA1 - 3*EMA2 + EMA3。"""
    ema1 = _ema_series(closes, period)
    ema2 = _ema_series(ema1, period)
    ema3 = _ema_series(ema2, period)
    return [
        {
            "date": d,
            "tema": round(3 * a - 3 * b + c, 2)
            if a is not None and b is not None and c is not None
            else None,
        }
        for d, a, b, c in zip(dates, ema1, ema2, ema3)
    ]


def calculate_vwma(
    dates: Sequence[str],
    closes: Sequence[float],
    volumes: Sequence[float],
    period: int = 30,
) -> list[dict[str, float | str | None]]:
    """VWMA 成交量加權移動平均：VWMA = Σ(close*volume, n) / Σ(volume, n)。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "vwma": None} for d in dates]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    for i in range(period - 1, n):
        vol_sum = sum(volumes[i + 1 - period : i + 1])
        if vol_sum == 0:
            continue
        vw = sum(
            c * v
            for c, v in zip(closes[i + 1 - period : i + 1], volumes[i + 1 - period : i + 1])
        ) / vol_sum
        out[i] = {"date": dates[i], "vwma": round(vw, 2)}
    return out


def calculate_midprice(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    """MIDPRICE 週期中點價：(HHV(high, n) + LLV(low, n)) / 2。"""
    n = len(highs)
    out: list[dict[str, float | str | None]] = [{"date": d, "midprice": None} for d in dates]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    for i in range(period - 1, n):
        hi = max(highs[i + 1 - period : i + 1])
        lo = min(lows[i + 1 - period : i + 1])
        out[i] = {"date": dates[i], "midprice": round((hi + lo) / 2, 2)}
    return out


def calculate_sar(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    acceleration: float = 0.02,
    maximum: float = 0.2,
) -> list[dict[str, float | str | None]]:
    """SAR 拋物線轉向（Wilder）。

    以 head/tail 兩根 K 線決定起始方向；AF 起始 acceleration，
    每次創新高/新低 +acceleration，上限 maximum；價格穿越 SAR 即翻轉。
    """
    n = len(highs)
    out: list[dict[str, float | str | None]] = [{"date": d, "sar": None} for d in dates]
    if n < 2:
        return out

    uptrend = highs[1] > highs[0]
    af = acceleration
    # EP：多頭期間的最高價；空頭期間的最低價
    ep = highs[1] if uptrend else lows[1]
    sar_prev = lows[0] if uptrend else highs[0]
    # 起始值：多頭由最低點之下起步、空頭由最高點之上起步
    out[0] = {"date": dates[0], "sar": round(sar_prev, 2)}

    for i in range(1, n):
        if uptrend:
            sar = sar_prev + af * (ep - sar_prev)
            sar = min(sar, lows[i - 1])  # SAR 不得高於前一 bar 低點
            if lows[i] < sar:
                # 多翻空：SAR = EP（多頭期間最高價）
                out[i] = {"date": dates[i], "sar": round(ep, 2)}
                uptrend = False
                sar_prev = ep
                ep = lows[i]
                af = acceleration
                continue
            if highs[i] > ep:
                ep = highs[i]
                af = min(af + acceleration, maximum)
        else:
            sar = sar_prev + af * (ep - sar_prev)
            sar = max(sar, highs[i - 1])  # SAR 不得低於前一 bar 高點
            if highs[i] > sar:
                # 空翻多：SAR = EP（空頭期間最低價）
                out[i] = {"date": dates[i], "sar": round(ep, 2)}
                uptrend = True
                sar_prev = ep
                ep = highs[i]
                af = acceleration
                continue
            if lows[i] < ep:
                ep = lows[i]
                af = min(af + acceleration, maximum)

        out[i] = {"date": dates[i], "sar": round(sar, 2)}
        sar_prev = sar

    return out


# ---------------------------------------------------------------------------
# 動能類（9）：apo / ppo / pvo / roc / mom / stochrsi / ultosc / willr / mfi
# ---------------------------------------------------------------------------

def calculate_apo(
    dates: Sequence[str],
    closes: Sequence[float],
    fastperiod: int = 12,
    slowperiod: int = 26,
) -> list[dict[str, float | str | None]]:
    """APO 絕對價格振盪：EMA(fast) - EMA(slow)。"""
    fast_ema = _ema_series(closes, fastperiod)
    slow_ema = _ema_series(closes, slowperiod)
    return [
        {
            "date": d,
            "apo": round(a - b, 2) if a is not None and b is not None else None,
        }
        for d, a, b in zip(dates, fast_ema, slow_ema)
    ]


def calculate_ppo(
    dates: Sequence[str],
    closes: Sequence[float],
    fastperiod: int = 12,
    slowperiod: int = 26,
) -> list[dict[str, float | str | None]]:
    """PPO 百分比價格振盪：(EMA(fast)-EMA(slow))/EMA(slow)*100。"""
    fast_ema = _ema_series(closes, fastperiod)
    slow_ema = _ema_series(closes, slowperiod)
    return [
        {
            "date": d,
            "ppo": round((a - b) / b * 100, 2)
            if a is not None and b is not None and b != 0
            else None,
        }
        for d, a, b in zip(dates, fast_ema, slow_ema)
    ]


def calculate_pvo(
    dates: Sequence[str],
    volumes: Sequence[float],
    fastperiod: int = 12,
    slowperiod: int = 26,
) -> list[dict[str, float | str | None]]:
    """PVO 百分比成交量振盪：(EMA(vol,fast)-EMA(vol,slow))/EMA(vol,slow)*100。"""
    fast_ema = _ema_series(volumes, fastperiod)
    slow_ema = _ema_series(volumes, slowperiod)
    return [
        {
            "date": d,
            "pvo": round((a - b) / b * 100, 2)
            if a is not None and b is not None and b != 0
            else None,
        }
        for d, a, b in zip(dates, fast_ema, slow_ema)
    ]


def calculate_roc(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 10,
) -> list[dict[str, float | str | None]]:
    """ROC 變動率：(C - C[n]) / C[n] * 100。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "roc": None} for d in dates]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    for i in range(period, n):
        base = closes[i - period]
        if base == 0:
            continue
        out[i] = {"date": dates[i], "roc": round((closes[i] - base) / base * 100, 2)}
    return out


def calculate_mom(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 10,
) -> list[dict[str, float | str | None]]:
    """MOM 動量：C - C[n]（價格差）。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "mom": None} for d in dates]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    for i in range(period, n):
        out[i] = {"date": dates[i], "mom": round(closes[i] - closes[i - period], 2)}
    return out


def _rsi_wilder_series(closes: Sequence[float], period: int) -> list[float | None]:
    """Wilder RSI 序列（與 src/indicators.py calculate_rsi 同演算法）。"""
    n = len(closes)
    out: list[float | None] = [None] * n
    if n < period + 1:
        return out
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, n):
        change = closes[i] - closes[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    out[period] = _rsi_from_avgs(avg_gain, avg_loss)
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = _rsi_from_avgs(avg_gain, avg_loss)
    return out


def _rsi_from_avgs(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calculate_stochrsi(
    dates: Sequence[str],
    closes: Sequence[float],
    timeperiod: int = 14,
    fastk_period: int = 5,
    fastd_period: int = 3,
) -> list[dict[str, float | str | None]]:
    """STOCHRSI 隨機 RSI：對 RSI 做 stochastic，%K/%D 各以 SMA 平滑。"""
    rsi = _rsi_wilder_series(closes, timeperiod)
    n = len(closes)
    out: list[dict[str, float | str | None]] = [
        {"date": d, "k": None, "d": None} for d in dates
    ]

    # 原始 stochastic（對 RSI）：(RSI(t)-min)/(max-min)*100，timeperiod 內
    raw: list[float | None] = [None] * n
    for i in range(n):
        start = i + 1 - timeperiod
        if start < 0:
            continue
        window = [v for v in rsi[start : i + 1] if v is not None]
        if len(window) < timeperiod:
            continue
        lo = min(window)
        hi = max(window)
        rsi_now = rsi[i]
        if rsi_now is None:
            continue
        if hi == lo:
            raw[i] = 50.0
        else:
            raw[i] = (rsi_now - lo) / (hi - lo) * 100

    # %K = SMA(raw, fastk_period)；%D = SMA(%K, fastd_period)
    def _sma(values: Sequence[float | None], p: int) -> list[float | None]:
        res: list[float | None] = [None] * len(values)
        for i in range(p - 1, len(values)):
            win = [v for v in values[i + 1 - p : i + 1] if v is not None]
            if len(win) == p:
                res[i] = sum(win) / p
        return res

    k_series = _sma(raw, fastk_period)
    d_series = _sma(k_series, fastd_period)

    for i, d in enumerate(dates):
        out[i] = {
            "date": d,
            "k": round(k_series[i], 2) if k_series[i] is not None else None,
            "d": round(d_series[i], 2) if d_series[i] is not None else None,
        }
    return out


def calculate_ultosc(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    timeperiod1: int = 7,
    timeperiod2: int = 14,
    timeperiod3: int = 28,
) -> list[dict[str, float | str | None]]:
    """ULTOSC 終極擺盪：100*(4*BP7+2*BP14+BP28)/(4*TR7+2*TR14+TR28)。

    BP（買賣壓）= C - min(L, C_prev)；TR = max(H, C_prev) - min(L, C_prev)。
    第一個 bar 的 BP/TR 以首根高低差代替（C_prev 不存在）。
    """
    n = len(closes)
    bp: list[float] = []
    tr: list[float] = []
    for i in range(n):
        if i == 0:
            bp.append(highs[0] - lows[0])
            tr.append(highs[0] - lows[0])
        else:
            c_prev = closes[i - 1]
            bp.append(closes[i] - min(lows[i], c_prev))
            tr.append(max(highs[i], c_prev) - min(lows[i], c_prev))

    out: list[dict[str, float | str | None]] = [{"date": d, "ultosc": None} for d in dates]

    def _sum_last(arr: Sequence[float], p: int, end: int) -> float:
        return sum(arr[end + 1 - p : end + 1])

    for i in range(n):
        if i + 1 < max(timeperiod1, timeperiod2, timeperiod3):
            continue
        bp7 = _sum_last(bp, timeperiod1, i)
        bp14 = _sum_last(bp, timeperiod2, i)
        bp28 = _sum_last(bp, timeperiod3, i)
        tr7 = _sum_last(tr, timeperiod1, i)
        tr14 = _sum_last(tr, timeperiod2, i)
        tr28 = _sum_last(tr, timeperiod3, i)
        denom = 4 * tr7 + 2 * tr14 + tr28
        if denom == 0:
            continue
        out[i] = {
            "date": dates[i],
            "ultosc": round(100 * (4 * bp7 + 2 * bp14 + bp28) / denom, 2),
        }
    return out


def calculate_willr(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    """WILLR 威廉指標：-100*(HHV(H,n)-C)/(HHV(H,n)-LLV(L,n))。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "willr": None} for d in dates]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    for i in range(period - 1, n):
        hi = max(highs[i + 1 - period : i + 1])
        lo = min(lows[i + 1 - period : i + 1])
        if hi == lo:
            out[i] = {"date": dates[i], "willr": -100.0}
        else:
            out[i] = {"date": dates[i], "willr": round(-100 * (hi - closes[i]) / (hi - lo), 2)}
    return out


def calculate_mfi(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    volumes: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    """MFI 資金流量指標：MFI = 100 - 100/(1 + 正向資金流/負向資金流)。

    TP = (H+L+C)/3；資金流 = TP*volume；依 TP 相較前一根的方向分正負流。
    """
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "mfi": None} for d in dates]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    if n < period + 1:
        return out

    tp = [(h + l + c) / 3 for h, l, c in zip(highs, lows, closes)]
    mf = [tp[i] * volumes[i] for i in range(n)]

    for i in range(period, n):
        pos = 0.0
        neg = 0.0
        for j in range(i + 1 - period, i + 1):
            if tp[j] > tp[j - 1]:
                pos += mf[j]
            elif tp[j] < tp[j - 1]:
                neg += mf[j]
        if neg == 0:
            out[i] = {"date": dates[i], "mfi": 100.0}
        else:
            out[i] = {"date": dates[i], "mfi": round(100 - 100 / (1 + pos / neg), 2)}
    return out


# ---------------------------------------------------------------------------
# 統計/量能類（8）：adosc / cmf / linearreg / linearreg_slope / stddev /
#                beta / correl / tsf
# ---------------------------------------------------------------------------

def calculate_adosc(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    volumes: Sequence[float],
    fastperiod: int = 3,
    slowperiod: int = 10,
) -> list[dict[str, float | str | None]]:
    """ADOSC 蔡金 A/D 振盪：ADOSC = EMA(AD, fast) - EMA(AD, slow)。

    MFM = ((C-L)-(H-C))/(H-L)；AD(t) = AD(t-1) + MFM*volume；AD[0] = 0。
    """
    n = len(closes)
    ad: list[float] = [0.0] * n
    for i in range(1, n):
        hl = highs[i] - lows[i]
        mfm = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl if hl != 0 else 0.0
        ad[i] = ad[i - 1] + mfm * volumes[i]

    fast_ema = _ema_series(ad, fastperiod)
    slow_ema = _ema_series(ad, slowperiod)
    return [
        {
            "date": d,
            "adosc": round(a - b, 2) if a is not None and b is not None else None,
        }
        for d, a, b in zip(dates, fast_ema, slow_ema)
    ]


def calculate_cmf(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    volumes: Sequence[float],
    period: int = 20,
) -> list[dict[str, float | str | None]]:
    """CMF 蔡金資金流：CMF = Σ(MFV, n) / Σ(volume, n)。

    MFM = ((C-L)-(H-C))/(H-L)；MFV = MFM*volume。
    """
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "cmf": None} for d in dates]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    for i in range(period - 1, n):
        vol_sum = 0.0
        mfv_sum = 0.0
        for j in range(i + 1 - period, i + 1):
            hl = highs[j] - lows[j]
            mfm = ((closes[j] - lows[j]) - (highs[j] - closes[j])) / hl if hl != 0 else 0.0
            mfv_sum += mfm * volumes[j]
            vol_sum += volumes[j]
        if vol_sum == 0:
            continue
        out[i] = {"date": dates[i], "cmf": round(mfv_sum / vol_sum, 2)}
    return out


def _linearreg_params(values: Sequence[float], period: int) -> tuple[float, float]:
    """最小平方法回歸 (a, b)：y = a + b*x，x = 1..period。"""
    n = period
    x_sum = n * (n + 1) / 2
    x2_sum = n * (n + 1) * (2 * n + 1) / 6
    c_sum = sum(values)
    xc_sum = sum((i + 1) * c for i, c in enumerate(values))
    denom = n * x2_sum - x_sum * x_sum
    b = (n * xc_sum - x_sum * c_sum) / denom if denom != 0 else 0.0
    a = c_sum / n - b * (x_sum / n)
    return a, b


def calculate_linearreg(
    dates: Sequence[str],
    closes: Sequence[float],
    timeperiod: int = 14,
) -> list[dict[str, float | str | None]]:
    """LINEARREG 線性回歸值：a + b*n（x 取當前期數）。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "linearreg": None} for d in dates]
    if timeperiod <= 0:
        raise ValueError("timeperiod must be greater than 0")
    for i in range(timeperiod - 1, n):
        a, b = _linearreg_params(closes[i + 1 - timeperiod : i + 1], timeperiod)
        out[i] = {"date": dates[i], "linearreg": round(a + b * timeperiod, 2)}
    return out


def calculate_linearreg_slope(
    dates: Sequence[str],
    closes: Sequence[float],
    timeperiod: int = 14,
) -> list[dict[str, float | str | None]]:
    """LINEARREG_SLOPE 線性回歸斜率：回歸的 b（斜率）。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [
        {"date": d, "linearreg_slope": None} for d in dates
    ]
    if timeperiod <= 0:
        raise ValueError("timeperiod must be greater than 0")
    for i in range(timeperiod - 1, n):
        _, b = _linearreg_params(closes[i + 1 - timeperiod : i + 1], timeperiod)
        out[i] = {"date": dates[i], "linearreg_slope": round(b, 2)}
    return out


def calculate_stddev(
    dates: Sequence[str],
    closes: Sequence[float],
    timeperiod: int = 5,
    nbdev: int = 1,
) -> list[dict[str, float | str | None]]:
    """STDDEV 標準差：sqrt(Σ(C-SMA(C,n))² / (n-nbdev))。

    nbdev=1 樣本標準差（除以 n-1）、nbdev=0 母體標準差（除以 n）。
    """
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "stddev": None} for d in dates]
    if timeperiod <= 0:
        raise ValueError("timeperiod must be greater than 0")
    denom = max(1, timeperiod - nbdev) if nbdev == 1 else timeperiod
    for i in range(timeperiod - 1, n):
        window = closes[i + 1 - timeperiod : i + 1]
        mean = sum(window) / timeperiod
        var = sum((c - mean) ** 2 for c in window) / denom
        out[i] = {"date": dates[i], "stddev": round(math.sqrt(var), 2)}
    return out


def calculate_beta(
    dates: Sequence[str],
    closes: Sequence[float],
    closes2: Sequence[float],
    timeperiod: int = 5,
) -> list[dict[str, float | str | None]]:
    """BETA Beta 係數：Cov(x,y)/Var(y)，x=標的報酬、y=基準報酬。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "beta": None} for d in dates]
    if timeperiod < 2:
        raise ValueError("timeperiod must be >= 2")
    for i in range(timeperiod, n):
        x = [closes[j] / closes[j - 1] - 1 for j in range(i + 1 - timeperiod, i + 1)]
        y = [closes2[j] / closes2[j - 1] - 1 for j in range(i + 1 - timeperiod, i + 1)]
        x_mean = sum(x) / timeperiod
        y_mean = sum(y) / timeperiod
        cov = sum((a - x_mean) * (b - y_mean) for a, b in zip(x, y)) / timeperiod
        var_y = sum((b - y_mean) ** 2 for b in y) / timeperiod
        if var_y == 0:
            continue
        out[i] = {"date": dates[i], "beta": round(cov / var_y, 2)}
    return out


def calculate_correl(
    dates: Sequence[str],
    closes: Sequence[float],
    closes2: Sequence[float],
    timeperiod: int = 30,
) -> list[dict[str, float | str | None]]:
    """CORREL 相關係數（皮爾森）：Σ((x-x̄)(y-ȳ)) / sqrt(Σ(x-x̄)²*Σ(y-ȳ)²)。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "correl": None} for d in dates]
    if timeperiod < 2:
        raise ValueError("timeperiod must be >= 2")
    for i in range(timeperiod - 1, n):
        x = closes[i + 1 - timeperiod : i + 1]
        y = closes2[i + 1 - timeperiod : i + 1]
        x_mean = sum(x) / timeperiod
        y_mean = sum(y) / timeperiod
        num = sum((a - x_mean) * (b - y_mean) for a, b in zip(x, y))
        denom = math.sqrt(
            sum((a - x_mean) ** 2 for a in x) * sum((b - y_mean) ** 2 for b in y)
        )
        if denom == 0:
            continue
        out[i] = {"date": dates[i], "correl": round(num / denom, 2)}
    return out


def calculate_tsf(
    dates: Sequence[str],
    closes: Sequence[float],
    timeperiod: int = 14,
) -> list[dict[str, float | str | None]]:
    """TSF 時間序列預測：a + b*(n+1)（回歸外推一期）。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "tsf": None} for d in dates]
    if timeperiod <= 0:
        raise ValueError("timeperiod must be greater than 0")
    for i in range(timeperiod - 1, n):
        a, b = _linearreg_params(closes[i + 1 - timeperiod : i + 1], timeperiod)
        out[i] = {"date": dates[i], "tsf": round(a + b * (timeperiod + 1), 2)}
    return out


# ---------------------------------------------------------------------------
# 型態/其他類（6）：aroon / dx / natr / day_high / day_low / trix
# ---------------------------------------------------------------------------

def calculate_aroon(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    period: int = 25,
) -> list[dict[str, float | str | None]]:
    """AROON 阿隆指標：AROON_UP/DOWN = (N - 距 N 日內高低價期數)/N*100。

    期數從 0 起算（今日創新高低則為 0）。
    """
    n = len(highs)
    out: list[dict[str, float | str | None]] = [
        {"date": d, "aroon_up": None, "aroon_down": None} for d in dates
    ]
    if period <= 0:
        raise ValueError("period must be greater than 0")
    for i in range(period - 1, n):
        window_hi = highs[i + 1 - period : i + 1]
        window_lo = lows[i + 1 - period : i + 1]
        max_hi = max(window_hi)
        min_lo = min(window_lo)
        # 距離（期數，0 = 今日）；從窗內最後一筆往前找
        idx_hi = period - 1 - window_hi[::-1].index(max_hi)
        idx_lo = period - 1 - window_lo[::-1].index(min_lo)
        out[i] = {
            "date": dates[i],
            "aroon_up": round((period - idx_hi) / period * 100, 2),
            "aroon_down": round((period - idx_lo) / period * 100, 2),
        }
    return out


def calculate_dx(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    """DX 趨向指標：DX = 100*|+DI - -DI|/(+DI + -DI)。

    與 ADX 共用 Wilder 平滑 +DM/-DM/TR，但輸出單日 DX 而非平滑後的 ADX。
    """
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "dx": None} for d in dates]
    if n == 0:
        return out
    if period <= 0:
        raise ValueError("period must be greater than 0")

    tr_values: list[float] = []
    pdm_values: list[float] = []
    mdm_values: list[float] = []
    for i in range(n):
        if i == 0:
            tr_values.append(highs[0] - lows[0])
            pdm_values.append(0.0)
            mdm_values.append(0.0)
            continue
        up_move = highs[i] - highs[i - 1]
        down_move = lows[i - 1] - lows[i]
        pdm_values.append(up_move if up_move > down_move and up_move > 0 else 0.0)
        mdm_values.append(down_move if down_move > up_move and down_move > 0 else 0.0)
        tr_values.append(
            max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        )

    sm_tr: list[float | None] = [None] * n
    sm_pdm: list[float | None] = [None] * n
    sm_mdm: list[float | None] = [None] * n
    if n >= period:
        sm_tr[period - 1] = sum(tr_values[:period]) / period
        sm_pdm[period - 1] = sum(pdm_values[:period]) / period
        sm_mdm[period - 1] = sum(mdm_values[:period]) / period
        for i in range(period, n):
            sm_tr[i] = (sm_tr[i - 1] * (period - 1) + tr_values[i]) / period
            sm_pdm[i] = (sm_pdm[i - 1] * (period - 1) + pdm_values[i]) / period
            sm_mdm[i] = (sm_mdm[i - 1] * (period - 1) + mdm_values[i]) / period

    for i in range(period - 1, n):
        if sm_tr[i] is None or sm_tr[i] == 0:
            continue
        plus_di = 100.0 * sm_pdm[i] / sm_tr[i] if sm_pdm[i] is not None else 0.0
        minus_di = 100.0 * sm_mdm[i] / sm_tr[i] if sm_mdm[i] is not None else 0.0
        di_sum = plus_di + minus_di
        dx = 100.0 * abs(plus_di - minus_di) / di_sum if di_sum else 0.0
        out[i] = {"date": dates[i], "dx": round(dx, 2)}
    return out


def calculate_natr(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    """NATR 正規化平均真實波幅：NATR = ATR/C*100（Wilder ATR）。"""
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "natr": None} for d in dates]
    if n == 0:
        return out
    if period <= 0:
        raise ValueError("period must be greater than 0")

    tr_values: list[float] = []
    for i in range(n):
        if i == 0:
            tr_values.append(highs[0] - lows[0])
        else:
            tr_values.append(
                max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
            )

    atr_value = 0.0
    for i in range(period - 1, n):
        if i == period - 1:
            atr_value = sum(tr_values[:period]) / period
        else:
            atr_value = (atr_value * (period - 1) + tr_values[i]) / period
        if closes[i] == 0:
            continue
        out[i] = {"date": dates[i], "natr": round(atr_value / closes[i] * 100, 2)}
    return out


def calculate_day_high(
    dates: Sequence[str],
    highs: Sequence[float],
) -> list[dict[str, float | str]]:
    """單日最高價：直接輸出當日 high，無 warmup。"""
    return [{"date": d, "day_high": round(h, 2)} for d, h in zip(dates, highs)]


def calculate_day_low(
    dates: Sequence[str],
    lows: Sequence[float],
) -> list[dict[str, float | str]]:
    """單日最低價：直接輸出當日 low，無 warmup。"""
    return [{"date": d, "day_low": round(l, 2)} for d, l in zip(dates, lows)]


def calculate_trix(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 15,
) -> list[dict[str, float | str | None]]:
    """TRIX 三重指數平滑指標：(EMA3(t)-EMA3(t-1))/EMA3(t-1)*100。"""
    ema1 = _ema_series(closes, period)
    ema2 = _ema_series(ema1, period)
    ema3 = _ema_series(ema2, period)
    n = len(closes)
    out: list[dict[str, float | str | None]] = [{"date": d, "trix": None} for d in dates]
    for i in range(1, n):
        cur = ema3[i]
        prev = ema3[i - 1]
        if cur is not None and prev is not None and prev != 0:
            out[i] = {"date": dates[i], "trix": round((cur - prev) / prev * 100, 2)}
    return out
