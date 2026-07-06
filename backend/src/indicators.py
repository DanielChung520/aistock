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
