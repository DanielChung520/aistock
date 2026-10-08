import math
from collections.abc import Sequence


def calculate_ema(closes: Sequence[float], period: int) -> list[float | None]:
    if period <= 0:
        raise ValueError("period must be greater than 0")

    ema_values: list[float | None] = [None] * len(closes)
    if len(closes) < period:
        return ema_values

    alpha = 2 / (period + 1)
    seed = sum(closes[:period]) / period
    ema_values[period - 1] = seed
    previous_ema = seed

    for i in range(period, len(closes)):
        current_ema = closes[i] * alpha + previous_ema * (1 - alpha)
        ema_values[i] = current_ema
        previous_ema = current_ema

    return ema_values


def calculate_ma(
    dates: Sequence[str],
    closes: Sequence[float],
    periods: Sequence[int],
    ma_type: str = "sma",
) -> list[dict[str, float | str | None]]:
    result: list[dict[str, float | str | None]] = []

    if ma_type not in {"sma", "ema"}:
        raise ValueError("ma_type must be 'sma' or 'ema'")

    ema_by_period: dict[int, list[float | None]] = {}
    if ma_type == "ema":
        for period in periods:
            ema_by_period[period] = calculate_ema(closes, period)

    for i in range(len(closes)):
        entry: dict[str, float | str | None] = {"date": dates[i]}
        for period in periods:
            if ma_type == "sma":
                if i + 1 >= period:
                    value = sum(closes[i + 1 - period : i + 1]) / period
                    entry[f"ma{period}"] = round(value, 2)
                else:
                    entry[f"ma{period}"] = None
            else:
                ema_value = ema_by_period[period][i]
                entry[f"ma{period}"] = round(ema_value, 2) if ema_value is not None else None
        result.append(entry)

    return result


def calculate_kdj(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 9,
    k_smooth: int = 3,
    d_smooth: int = 3,
) -> list[dict[str, float | str]]:
    result: list[dict[str, float | str]] = []
    k_value = 50.0
    d_value = 50.0

    for i in range(len(closes)):
        if i + 1 >= period:
            lowest = min(lows[i + 1 - period : i + 1])
            highest = max(highs[i + 1 - period : i + 1])
            if highest == lowest:
                rsv = 50.0
            else:
                rsv = (closes[i] - lowest) / (highest - lowest) * 100
        else:
            rsv = 50.0

        k_value = (1 / k_smooth) * rsv + (1 - 1 / k_smooth) * k_value
        d_value = (1 / d_smooth) * k_value + (1 - 1 / d_smooth) * d_value
        j_value = 3 * k_value - 2 * d_value

        result.append(
            {
                "date": dates[i],
                "k": round(k_value, 2),
                "d": round(d_value, 2),
                "j": round(j_value, 2),
            }
        )

    return result


calculate_kd = calculate_kdj


def calculate_macd(
    dates: Sequence[str],
    closes: Sequence[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> list[dict[str, float | str | None]]:
    fast_ema = calculate_ema(closes, fast)
    slow_ema = calculate_ema(closes, slow)

    dif_values: list[float | None] = [None] * len(closes)
    for i in range(len(closes)):
        fast_value = fast_ema[i]
        slow_value = slow_ema[i]
        if fast_value is not None and slow_value is not None:
            dif_values[i] = fast_value - slow_value

    signal_values: list[float | None] = [None] * len(closes)
    valid_dif_indices = [i for i, value in enumerate(dif_values) if value is not None]
    valid_dif_values = [value for value in dif_values if value is not None]

    if len(valid_dif_values) >= signal:
        alpha = 2 / (signal + 1)
        seed = sum(valid_dif_values[:signal]) / signal
        signal_values[valid_dif_indices[signal - 1]] = seed
        previous_signal = seed

        for n in range(signal, len(valid_dif_values)):
            current_dif = valid_dif_values[n]
            current_signal = current_dif * alpha + previous_signal * (1 - alpha)
            signal_values[valid_dif_indices[n]] = current_signal
            previous_signal = current_signal

    result: list[dict[str, float | str | None]] = []
    for i in range(len(closes)):
        dif_value = dif_values[i]
        signal_value = signal_values[i]
        histogram = None

        if dif_value is not None and signal_value is not None:
            histogram = dif_value - signal_value

        result.append(
            {
                "date": dates[i],
                "dif": round(dif_value, 2) if dif_value is not None else None,
                "signal": round(signal_value, 2) if signal_value is not None else None,
                "histogram": round(histogram, 2) if histogram is not None else None,
            }
        )

    return result


def calculate_bollinger(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 20,
    std_dev: float = 2,
) -> list[dict[str, float | str | None]]:
    result: list[dict[str, float | str | None]] = []

    for i in range(len(closes)):
        if i + 1 < period:
            result.append(
                {
                    "date": dates[i],
                    "upper": None,
                    "middle": None,
                    "lower": None,
                }
            )
            continue

        window = closes[i + 1 - period : i + 1]
        middle = sum(window) / period
        variance = sum((value - middle) ** 2 for value in window) / period
        sigma = math.sqrt(variance)

        upper = middle + std_dev * sigma
        lower = middle - std_dev * sigma

        result.append(
            {
                "date": dates[i],
                "upper": round(upper, 2),
                "middle": round(middle, 2),
                "lower": round(lower, 2),
            }
        )

    return result


def calculate_rsi(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    if not closes:
        return []

    if len(closes) == 1:
        return [{"date": dates[0], "rsi": None}]

    result: list[dict[str, float | str | None]] = [{"date": dates[0], "rsi": None}]
    gains: list[float] = []
    losses: list[float] = []

    for i in range(1, len(closes)):
        change = closes[i] - closes[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))

    avg_gain = 0.0
    avg_loss = 0.0

    for i in range(len(gains)):
        if i < period - 1:
            result.append({"date": dates[i + 1], "rsi": None})
        elif i == period - 1:
            avg_gain = sum(gains[:period]) / period
            avg_loss = sum(losses[:period]) / period

            if avg_loss == 0:
                rsi_value = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi_value = 100 - (100 / (1 + rs))

            result.append({"date": dates[i + 1], "rsi": round(rsi_value, 2)})
        else:
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period

            if avg_loss == 0:
                rsi_value = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi_value = 100 - (100 / (1 + rs))

            result.append({"date": dates[i + 1], "rsi": round(rsi_value, 2)})

    return result


def _slope_series(values: Sequence[float | None]) -> list[float | None]:
    """Per-bar percentage slope of a value series, None until two consecutive values exist."""
    slopes: list[float | None] = [None] * len(values)
    for i in range(1, len(values)):
        current = values[i]
        previous = values[i - 1]
        if current is not None and previous is not None and previous != 0:
            slopes[i] = (current - previous) / previous * 100
        else:
            slopes[i] = None
    return slopes


def calculate_ma_daniel(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    volumes: Sequence[float],
    periods: Sequence[int] = (5, 8, 21, 55, 89),
    lookback: int = 8,
    ma_type: str = "sma",
    cooldown: int = 1,
    buy_slope_min: float = 0.05,
    sell_slope_max: float = 0.02,
) -> list[dict[str, float | int | str | bool | None]]:
    """Port of the "Moving Average Daniel" Pine indicator (see .docs/indicator001.md). Pure function."""
    if not closes:
        return []
    if ma_type not in {"sma", "ema"}:
        raise ValueError("ma_type must be 'sma' or 'ema'")
    if lookback <= 0:
        raise ValueError("lookback must be greater than 0")

    periods_list = list(periods)

    # Per-period MA series (SMA or EMA), None until warmup (i + 1 >= period).
    ma_series: list[list[float | None]] = []
    if ma_type == "sma":
        for period in periods_list:
            series: list[float | None] = [None] * len(closes)
            for i in range(len(closes)):
                if i + 1 >= period:
                    series[i] = sum(closes[i + 1 - period : i + 1]) / period
            ma_series.append(series)
    else:
        for period in periods_list:
            ma_series.append(calculate_ema(closes, period))

        # Compute slopes for periods we need (include up to 55 if present).
    slope_count = len(periods_list)
    for period_idx, period in enumerate(periods_list):
        if period == 55:
            slope_count = period_idx + 1
            break
    slope_count = min(slope_count, len(periods_list))
    slope_series = [_slope_series(ma_series[k]) for k in range(slope_count)]

    result: list[dict[str, float | int | str | bool | None]] = []
    for i in range(len(closes)):
        entry: dict[str, float | int | str | bool | None] = {"date": dates[i]}

        for period_idx, period in enumerate(periods_list):
            value = ma_series[period_idx][i]
            entry[f"ma{period}"] = round(value, 2) if value is not None else None
            if period_idx < slope_count:
                slope = slope_series[period_idx][i]
                entry[f"slope{period}"] = round(slope, 4) if slope is not None else None

        # 扣抵值: Pine ta.sma(close[lb], lookback) with lb=lookback, i.e. SMA of the
        # `lookback` closes ending `lookback` bars back.
        if i - lookback + 1 >= lookback:
            offset_window = closes[i - 2 * lookback + 1 : i - lookback + 1]
            entry["close_offset"] = round(sum(offset_window) / lookback, 2)
        else:
            entry["close_offset"] = None

        # 距離最近大量K棒: first j in 1..360 with volumes[i-j] > volumes[i].
        volume_distance = 0
        for j in range(1, 361):
            if i - j >= 0 and volumes[i - j] > volumes[i]:
                volume_distance = j
                break
        entry["volume_distance"] = volume_distance

        # weight/trend from first, third and fourth period MAs (Pine out/out2/out3).
        p0 = ma_series[0][i]
        p2 = ma_series[2][i] if len(periods_list) > 2 else None
        p3 = ma_series[3][i] if len(periods_list) > 3 else None
        if p0 is not None and p2 is not None and p3 is not None:
            if p0 >= p2 and p2 >= p3:
                weight = 50
                trend = "A"
            elif p0 >= p2:
                weight = 25
                trend = "B"
            else:
                weight = 0
                trend = "C"
        else:
            weight = None
            trend = None
        entry["weight"] = weight
        entry["trend"] = trend

        # buy/sell signals from MA slopes (Pine ma8slope / ma16slope / ma16sGrw).
        slope1 = slope_series[0][i] if slope_count > 0 else None
        slope2 = slope_series[1][i] if slope_count > 1 else None
        slope2_prev = slope_series[1][i - 1] if slope_count > 1 and i >= 1 else None
        slope2_prev2 = slope_series[1][i - 2] if slope_count > 1 and i >= 2 else None

        buy = False
        cond3up = i >= 2 and closes[i] > highs[i - 1] and closes[i] > highs[i - 2]
        if cond3up and slope1 is not None and slope2 is not None and slope2_prev is not None:
            if slope2 - slope2_prev > 0 and slope1 > buy_slope_min:
                buy = True
        if buy and trend == "C":
            buy = False
        entry["buy"] = buy

        sell = False
        if slope1 is not None and slope2 is not None and slope2_prev is not None and slope2_prev2 is not None:
            ma16s_grw = slope2 - slope2_prev
            ma16s_grw_prev = slope2_prev - slope2_prev2
            if ma16s_grw < 0 and ma16s_grw_prev > 0 and slope1 < sell_slope_max:
                sell = True
        entry["sell"] = sell

        result.append(entry)

    # Forward pass: suppress a sell for `cooldown` bars right after a buy, and
    # suppress a buy for `cooldown` bars right after a sell. This removes the
    # one-bar reversal (buy on bar N, sell on bar N+1) that the raw Pine
    # conditions produce on the same acceleration line.
    last_buy = -10**9
    last_sell = -10**9
    for i, entry in enumerate(result):
        if entry["buy"]:
            if i - last_sell <= cooldown:
                entry["buy"] = False
            else:
                last_buy = i
        if entry["sell"]:
            if i - last_buy <= cooldown:
                entry["sell"] = False
            else:
                last_sell = i

    return result


def calculate_signal_accuracy(
    signals: Sequence[dict[str, object]],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    horizon: int = 5,
) -> dict[str, float | int | None]:
    """Hit-rate of the Daniel buy/sell markers over a look-ahead horizon.

    A buy marker at bar i counts as a hit when the highest high within the
    next `horizon` bars exceeds the entry close. A sell marker counts as a hit
    when the lowest low within the horizon drops below the exit close. Markers
    that cannot be evaluated yet (fewer than `horizon` bars remaining) are
    excluded, so the percentages are stable and never look into the future.
    """
    n = len(signals)
    buy_hits = 0
    buy_total = 0
    sell_hits = 0
    sell_total = 0

    for i, sig in enumerate(signals):
        end = min(i + horizon + 1, n)
        if end - i - 1 < horizon:
            continue
        window_highs = highs[i + 1 : end]
        window_lows = lows[i + 1 : end]
        if sig.get("buy"):
            buy_total += 1
            if window_highs and max(window_highs) > closes[i]:
                buy_hits += 1
        if sig.get("sell"):
            sell_total += 1
            if window_lows and min(window_lows) < closes[i]:
                sell_hits += 1

    return {
        "horizon": horizon,
        "buy_accuracy": round(buy_hits / buy_total * 100, 1) if buy_total else None,
        "buy_samples": buy_total,
        "sell_accuracy": round(sell_hits / sell_total * 100, 1) if sell_total else None,
        "sell_samples": sell_total,
    }


def calculate_atr(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    """Average True Range with Wilder smoothing. Pure function.

    TR[0] = H[0] - L[0]; TR[i] = max(H[i]-L[i], |H[i]-C[i-1]|, |L[i]-C[i-1]|).
    ATR seeds with SMA(TR[:period]) then Wilder-smoothes onwards.
    """
    n = len(closes)
    if n == 0:
        return []

    tr_values: list[float] = []
    for i in range(n):
        if i == 0:
            tr_values.append(highs[0] - lows[0])
        else:
            tr_values.append(
                max(
                    highs[i] - lows[i],
                    abs(highs[i] - closes[i - 1]),
                    abs(lows[i] - closes[i - 1]),
                )
            )

    result: list[dict[str, float | str | None]] = []
    atr_value = 0.0
    for i in range(n):
        if i + 1 < period:
            result.append({"date": dates[i], "atr": None})
            continue
        if i == period - 1:
            atr_value = sum(tr_values[:period]) / period
        else:
            atr_value = (atr_value * (period - 1) + tr_values[i]) / period
        result.append({"date": dates[i], "atr": round(atr_value, 2)})

    return result


def calculate_cci(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 20,
) -> list[dict[str, float | str | None]]:
    """Commodity Channel Index. Pure function.

    CCI = (TP - mean) / (0.015 * MD) where TP = (H+L+C)/3 and MD is the
    average absolute deviation of TP within the window.
    """
    n = len(closes)
    if n == 0:
        return []

    typical = [(h + low + c) / 3 for h, low, c in zip(highs, lows, closes)]

    result: list[dict[str, float | str | None]] = []
    for i in range(n):
        if i + 1 < period:
            result.append({"date": dates[i], "cci": None})
            continue

        window = typical[i + 1 - period : i + 1]
        mean = sum(window) / period
        md = sum(abs(tp - mean) for tp in window) / period
        if md == 0:
            cci_value = 0.0
        else:
            cci_value = (typical[i] - mean) / (0.015 * md)
        result.append({"date": dates[i], "cci": round(cci_value, 2)})

    return result


def calculate_obv(
    dates: Sequence[str],
    closes: Sequence[float],
    volumes: Sequence[float],
) -> list[dict[str, float | str | None]]:
    """On-Balance Volume (Granville). Pure function, no warmup.

    OBV[0] = 0; add volume on up close, subtract on down close, unchanged flat.
    """
    n = len(closes)
    if n == 0:
        return []

    result: list[dict[str, float | str | None]] = []
    obv_value = 0.0
    for i in range(n):
        if i > 0:
            if closes[i] > closes[i - 1]:
                obv_value += volumes[i]
            elif closes[i] < closes[i - 1]:
                obv_value -= volumes[i]
        result.append({"date": dates[i], "obv": round(obv_value, 2)})

    return result


def calculate_adx(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 14,
) -> list[dict[str, float | str | None]]:
    """Average Directional Index (Wilder). Pure function.

    TR/+DM/-DM are Wilder-smoothed, turned into +DI/-DI, then DX; the ADX is
    a Wilder smoothing of DX seeded by SMA(DX[:period]).
    """
    n = len(closes)
    if n == 0:
        return []

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
            max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
        )

    # Wilder smoothing of TR / +DM / -DM: seed with SMA of the first `period`.
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

    # +DI / -DI and DX, available from index period-1 onwards.
    dx_values: list[float | None] = [None] * n
    for i in range(n):
        if sm_tr[i] is None or sm_pdm[i] is None or sm_mdm[i] is None:
            continue
        if sm_tr[i] == 0:
            plus_di = 0.0
            minus_di = 0.0
        else:
            plus_di = 100.0 * sm_pdm[i] / sm_tr[i]
            minus_di = 100.0 * sm_mdm[i] / sm_tr[i]
        di_sum = plus_di + minus_di
        dx_values[i] = 100.0 * abs(plus_di - minus_di) / di_sum if di_sum else 0.0

    # ADX = Wilder smoothing of DX, seeded by SMA of the first `period` DX.
    adx_values: list[float | None] = [None] * n
    valid_dx = [dx for dx in dx_values if dx is not None]
    if len(valid_dx) >= period:
        adx_start = n - len(valid_dx) + period - 1
        adx_values[adx_start] = sum(valid_dx[:period]) / period
        for i in range(adx_start + 1, n):
            adx_values[i] = (adx_values[i - 1] * (period - 1) + dx_values[i]) / period

    result: list[dict[str, float | str | None]] = []
    for i in range(n):
        adx_value = adx_values[i]
        result.append({"date": dates[i], "adx": round(adx_value, 2) if adx_value is not None else None})

    return result


def calculate_range3(
    dates: Sequence[str],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
) -> list[dict[str, float | str | None]]:
    """三日振幅(%) — (max high - min low over the last 3 bars) / close * 100.

    Small values indicate tight 3-bar consolidation; < 3% is the 窄幅 zone.
    """
    n = len(closes)
    if n == 0:
        return []

    result: list[dict[str, float | str | None]] = []
    for i in range(n):
        if i < 2 or closes[i] == 0:
            result.append({"date": dates[i], "range3": None})
            continue
        hi = max(highs[i - 2 : i + 1])
        lo = min(lows[i - 2 : i + 1])
        result.append({"date": dates[i], "range3": round((hi - lo) / closes[i] * 100, 2)})

    return result


def calculate_breakout_high3(
    dates: Sequence[str],
    highs: Sequence[float],
    closes: Sequence[float],
) -> list[dict[str, float | str | bool | None]]:
    """今日收盤突破前三日（不含今日）的最高價。bool 輸出。"""
    n = len(closes)
    if n == 0:
        return []

    result: list[dict[str, float | str | bool | None]] = []
    for i in range(n):
        if i < 3:
            result.append({"date": dates[i], "breakout_high3": None})
            continue
        prev_high = max(highs[i - 3 : i])
        result.append({"date": dates[i], "breakout_high3": closes[i] > prev_high})

    return result


def calculate_new_high_n(
    dates: Sequence[str],
    closes: Sequence[float],
    period: int = 20,
) -> list[dict[str, float | str | bool | None]]:
    """收盤創近 N 日（含今日）新高。bool 輸出。"""
    n = len(closes)
    if n == 0:
        return []

    result: list[dict[str, float | str | bool | None]] = []
    for i in range(n):
        if i + 1 < period:
            result.append({"date": dates[i], "new_high_n": None})
            continue
        window = closes[i + 1 - period : i + 1]
        result.append({"date": dates[i], "new_high_n": closes[i] == max(window)})

    return result


def calculate_max_n(
    dates: Sequence[str],
    highs: Sequence[float],
    period: int = 20,
) -> list[dict[str, float | str | None]]:
    """最近 N 日（含今日）最高價（壓力位，對應 TA-Lib MAX）。"""
    n = len(highs)
    if n == 0:
        return []

    result: list[dict[str, float | str | None]] = []
    for i in range(n):
        if i + 1 < period:
            result.append({"date": dates[i], "max_n": None})
            continue
        window = highs[i + 1 - period : i + 1]
        result.append({"date": dates[i], "max_n": round(max(window), 2)})

    return result


def calculate_min_n(
    dates: Sequence[str],
    lows: Sequence[float],
    period: int = 20,
) -> list[dict[str, float | str | None]]:
    """最近 N 日（含今日）最低價（支撐位，對應 TA-Lib MIN）。"""
    n = len(lows)
    if n == 0:
        return []

    result: list[dict[str, float | str | None]] = []
    for i in range(n):
        if i + 1 < period:
            result.append({"date": dates[i], "min_n": None})
            continue
        window = lows[i + 1 - period : i + 1]
        result.append({"date": dates[i], "min_n": round(min(window), 2)})

    return result
