"""AI-style trade advice for the paper-trading simulator.

Generates a plain-language recommendation for the NEXT bar based on the
technical picture visible at the close of the current bar: MA alignment,
MA8/MA21 slopes and acceleration, price vs the offset (扣抵) level, distance
to the last heavy-volume bar, plus the current position state.

This is a rule-based "analyst" — no LLM involved. The output mirrors what a
human trader would say after reviewing the same chart.
"""
from __future__ import annotations


def generate_advice(signal: dict, position: dict, close: float) -> dict:
    """Build a recommendation for the next bar given today's close snapshot."""
    buy_sig = bool(signal.get("buy"))
    sell_sig = bool(signal.get("sell"))
    trend = signal.get("trend")
    slope8 = signal.get("slope8")
    slope21 = signal.get("slope21")
    close_offset = signal.get("close_offset")
    vol_dist = signal.get("volume_distance")
    shares = position.get("shares", 0)

    reasons: list[str] = []
    action = "wait"
    price_range: list[float] = []
    side = "none"

    # Trend context
    trend_desc = {"A": "多頭排列", "B": "中期偏多", "C": "空頭排列"}.get(trend, "震盪")
    reasons.append(f"均線{trend_desc}")

    # Slope / acceleration
    slope8_txt = f"MA8斜率 {slope8:+.2f}%" if slope8 is not None else ""
    slope21_txt = f"MA21斜率 {slope21:+.2f}%" if slope21 is not None else ""
    reasons.append(f"{slope8_txt} / {slope21_txt}")

    # Price vs offset
    if close_offset is not None:
        if close > close_offset:
            reasons.append(f"收盤價 {close:.0f} 站上扣抵值 {close_offset:.0f}（均線有撐）")
        else:
            reasons.append(f"收盤價 {close:.0f} 低於扣抵值 {close_offset:.0f}（均線有壓）")

    if vol_dist is not None and vol_dist > 0:
        reasons.append(f"距最近大量區 {vol_dist} 根")

    if shares > 0:
        entry = position.get("entry_price", 0)
        pnl_pct = (close / entry - 1) * 100 if entry else 0
        if sell_sig:
            action = "sell"
            side = "sell"
            reasons.append(f"出現賣出訊號，建議隔日開盤賣出（現浮動 {pnl_pct:+.1f}%）")
            price_range = [round(close * 0.99, 2), round(close * 1.01, 2)]
        elif trend == "C" and pnl_pct < 0:
            action = "sell"
            side = "sell"
            reasons.append(f"空頭排列且虧損 {pnl_pct:+.1f}%，建議減碼防守")
            price_range = [round(close * 0.99, 2), round(close, 2)]
        elif pnl_pct >= 10:
            action = "hold"
            side = "none"
            reasons.append(f"獲利 {pnl_pct:+.1f}%，建議部分獲利了結")
            price_range = [round(close * 0.98, 2), round(close, 2)]
        else:
            action = "hold"
            side = "none"
            reasons.append(f"續抱觀察（現浮動 {pnl_pct:+.1f}%）")
    else:
        if buy_sig:
            action = "buy"
            side = "buy"
            reasons.append("出現買進訊號，建議隔日開盤買進")
            price_range = [round(close * 0.99, 2), round(close * 1.02, 2)]
        elif trend in ("A", "B") and slope8 is not None and slope8 > 0:
            action = "wait"
            side = "none"
            reasons.append("趨勢偏多但尚無買進訊號，回檔再留意")
            price_range = []
        elif trend == "C":
            action = "wait"
            side = "none"
            reasons.append("空頭排列，空手觀望")
            price_range = []
        else:
            action = "wait"
            side = "none"
            reasons.append("等待訊號")
            price_range = []

    return {
        "action": action,
        "side": side,
        "suggested_price": price_range,
        "reasons": reasons,
    }
