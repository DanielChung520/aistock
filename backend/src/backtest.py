"""Backtest engine for the Daniel MA signals.

Pure computation on daily OHLCV history: simulates a long-only swing
strategy following the buy/sell markers from `calculate_ma_daniel`, with
optional stop-loss and max-hold exits. Returns aggregate stats, the full
trade list and an equity curve for charting.
"""
from __future__ import annotations

from src.data_fetcher import fetch_daily_history
from src.indicators import calculate_ma_daniel

DEFAULT_MONTHS = 24


def run_backtest(
    stock_id: str,
    months: int = DEFAULT_MONTHS,
    cooldown: int = 1,
    buy_slope_min: float = 0.05,
    sell_slope_max: float = 0.02,
    max_hold_bars: int = 0,
    stop_loss_pct: float = 0.0,
    initial_capital: float = 100_000,
) -> dict:
    """Simulate Daniel MA trading over `months` of daily history.

    Returns a dict with aggregate stats, per-trade records and an equity
    curve (date -> portfolio value, marked to market at the daily close).
    """
    data = fetch_daily_history(stock_id, months=months)
    if not data:
        return {"stock_id": stock_id, "error": "no data"}

    dates = [str(item["date"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    signals = calculate_ma_daniel(
        dates,
        highs,
        lows,
        closes,
        volumes,
        cooldown=cooldown,
        buy_slope_min=buy_slope_min,
        sell_slope_max=sell_slope_max,
    )

    trades: list[dict] = []
    equity_curve: list[dict] = []
    position: dict | None = None
    equity = initial_capital
    peak = initial_capital
    max_drawdown = 0.0
    buy_count = 0
    sell_count = 0
    stop_loss_hits = 0
    max_hold_hits = 0

    for i, sig in enumerate(signals):
        exit_reason: str | None = None

        if position is not None:
            stop_hit = stop_loss_pct > 0 and (closes[i] / position["entry_price"] - 1) * 100 <= -stop_loss_pct
            hold_hit = max_hold_bars > 0 and (i - position["entry_idx"]) >= max_hold_bars
            if stop_hit:
                stop_loss_hits += 1
                exit_reason = "stop_loss"
            if hold_hit:
                max_hold_hits += 1
                exit_reason = "max_hold"
            if exit_reason:
                exit_price = closes[i]
                ret = (exit_price / position["entry_price"] - 1) * 100
                equity *= 1 + ret / 100
                trades.append(
                    {
                        "entry_date": position["entry_date"],
                        "exit_date": dates[i],
                        "entry": round(position["entry_price"], 2),
                        "exit": round(exit_price, 2),
                        "return_pct": round(ret, 2),
                        "exit_reason": exit_reason,
                    }
                )
                peak = max(peak, equity)
                max_drawdown = max(max_drawdown, (peak - equity) / peak)
                position = None
                sell_count += 1

        if position is None:
            if sig.get("buy"):
                position = {"entry_idx": i, "entry_price": closes[i], "entry_date": dates[i]}
                buy_count += 1
            elif sig.get("sell"):
                pass  # sell without position is a no-op
        else:
            if exit_reason is None and sig.get("sell"):
                exit_price = closes[i]
                ret = (exit_price / position["entry_price"] - 1) * 100
                equity *= 1 + ret / 100
                trades.append(
                    {
                        "entry_date": position["entry_date"],
                        "exit_date": dates[i],
                        "entry": round(position["entry_price"], 2),
                        "exit": round(exit_price, 2),
                        "return_pct": round(ret, 2),
                        "exit_reason": "signal",
                    }
                )
                peak = max(peak, equity)
                max_drawdown = max(max_drawdown, (peak - equity) / peak)
                position = None
                sell_count += 1

        if position is not None:
            # Mark to market: realized equity × current position gain factor
            equity_curve.append(
                {
                    "date": dates[i],
                    "equity": round(
                        equity
                        * (closes[i] / position["entry_price"])
                        / initial_capital
                        * 100,
                        2,
                    ),
                }
            )
        else:
            equity_curve.append(
                {"date": dates[i], "equity": round(equity / initial_capital * 100, 2)}
            )

    # Close any open position at the last bar (mark to market, no trade entry).
    if position is not None:
        ret = (closes[-1] / position["entry_price"] - 1) * 100
        equity *= 1 + ret / 100
        trades.append(
            {
                "entry_date": position["entry_date"],
                "exit_date": dates[-1],
                "entry": round(position["entry_price"], 2),
                "exit": round(closes[-1], 2),
                "return_pct": round(ret, 2),
                "exit_reason": "open",
            }
        )

    wins = [t for t in trades if t["return_pct"] > 0]
    losses = [t for t in trades if t["return_pct"] <= 0]

    return {
        "stock_id": stock_id,
        "bars": len(closes),
        "months": months,
        "params": {
            "cooldown": cooldown,
            "buy_slope_min": buy_slope_min,
            "sell_slope_max": sell_slope_max,
            "max_hold_bars": max_hold_bars,
            "stop_loss_pct": stop_loss_pct,
        },
        "initial_capital": initial_capital,
        "final_equity": round(equity, 2),
        "total_return_pct": round((equity / initial_capital - 1) * 100, 2),
        "max_drawdown_pct": round(max_drawdown * 100, 2),
        "buy_signals": buy_count,
        "sell_signals": sell_count,
        "closed_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
        "avg_win_pct": round(sum(t["return_pct"] for t in wins) / len(wins), 2) if wins else 0.0,
        "avg_loss_pct": round(sum(t["return_pct"] for t in losses) / len(losses), 2) if losses else 0.0,
        "profit_factor": round(sum(t["return_pct"] for t in wins) / abs(sum(t["return_pct"] for t in losses)), 2)
        if losses and sum(t["return_pct"] for t in losses) != 0
        else None,
        "stop_loss_hits": stop_loss_hits,
        "max_hold_hits": max_hold_hits,
        "last_signal": "holding" if position is not None else "flat",
        "trades": trades,
        "equity_curve": equity_curve,
    }
