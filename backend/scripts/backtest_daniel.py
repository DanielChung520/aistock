"""Backtest the Daniel MA buy/sell signals on daily history.

Simulates a long-only swing strategy:
- On a `buy` bar, open a position at that bar's close (if flat).
- On a `sell` bar, close the position at that bar's close (if holding).
- Buy-back after a sell is allowed only on a later `buy` bar.

Outputs: trade list, win rate, avg return, expectancy, total return,
max drawdown (equity-based), signal counts.

Usage:
    python scripts/backtest_daniel.py [stock_id ...] [--months N]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.data_fetcher import fetch_daily_history
from src.indicators import calculate_ma_daniel


def run_backtest(
    stock_id: str,
    months: int = 24,
    cooldown: int = 1,
    max_hold_bars: int = 0,
    stop_loss_pct: float = 0.0,
) -> dict:
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
    )

    trades: list[dict] = []
    position: dict | None = None
    equity = 1.0
    peak = 1.0
    max_drawdown = 0.0
    buy_count = 0
    sell_count = 0
    stop_loss_hits = 0
    max_hold_hits = 0

    for i, sig in enumerate(signals):
        if position is not None:
            stop_hit = stop_loss_pct > 0 and (closes[i] / position["entry_price"] - 1) * 100 <= -stop_loss_pct
            hold_hit = max_hold_bars > 0 and (i - position["entry_idx"]) >= max_hold_bars
            if stop_hit:
                stop_loss_hits += 1
            if hold_hit:
                max_hold_hits += 1
            if stop_hit or hold_hit:
                exit_price = closes[i]
                ret = (exit_price / position["entry_price"] - 1) * 100
                trades.append(
                    {
                        "entry_date": position["entry_date"],
                        "exit_date": dates[i],
                        "entry": position["entry_price"],
                        "exit": exit_price,
                        "return_pct": round(ret, 2),
                        "stop_loss": stop_hit,
                    }
                )
                equity *= 1 + ret / 100
                peak = max(peak, equity)
                max_drawdown = max(max_drawdown, (peak - equity) / peak)
                position = None
                sell_count += 1
                continue

        if sig.get("buy") and position is None:
            position = {"entry_idx": i, "entry_price": closes[i], "entry_date": dates[i]}
            buy_count += 1
        elif sig.get("sell") and position is not None:
            exit_price = closes[i]
            ret = (exit_price / position["entry_price"] - 1) * 100
            trades.append(
                {
                    "entry_date": position["entry_date"],
                    "exit_date": dates[i],
                    "entry": position["entry_price"],
                    "exit": exit_price,
                    "return_pct": round(ret, 2),
                }
            )
            equity *= 1 + ret / 100
            peak = max(peak, equity)
            max_drawdown = max(max_drawdown, (peak - equity) / peak)
            position = None
            sell_count += 1

    # Close any open position at the last bar (mark to market, no trade entry).
    if position is not None:
        ret = (closes[-1] / position["entry_price"] - 1) * 100
        trades.append(
            {
                "entry_date": position["entry_date"],
                "exit_date": dates[-1],
                "entry": position["entry_price"],
                "exit": closes[-1],
                "return_pct": round(ret, 2),
                "open": True,
            }
        )
        equity *= 1 + ret / 100

    wins = [t for t in trades if t["return_pct"] > 0]
    losses = [t for t in trades if t["return_pct"] <= 0]

    return {
        "stock_id": stock_id,
        "bars": len(closes),
        "months": months,
        "buy_signals": buy_count,
        "sell_signals": sell_count,
        "closed_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
        "avg_win_pct": round(sum(t["return_pct"] for t in wins) / len(wins), 2) if wins else 0.0,
        "avg_loss_pct": round(sum(t["return_pct"] for t in losses) / len(losses), 2) if losses else 0.0,
        "total_return_pct": round((equity - 1) * 100, 2),
        "max_drawdown_pct": round(max_drawdown * 100, 2),
        "stop_loss_hits": stop_loss_hits,
        "max_hold_hits": max_hold_hits,
        "last_close": closes[-1],
        "last_signal": "holding" if position is not None else "flat",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest Daniel MA signals")
    parser.add_argument("stocks", nargs="*", help="stock ids (default: watchlist)")
    parser.add_argument("--months", type=int, default=24)
    parser.add_argument("--cooldown", type=int, default=1)
    parser.add_argument("--max-hold-bars", type=int, default=0)
    parser.add_argument("--stop-loss-pct", type=float, default=0.0)
    args = parser.parse_args()

    from src.db import get_db

    stocks = args.stocks
    if not stocks:
        db = get_db()
        stocks = list(db.aql.execute("FOR w IN watchlist RETURN w.stock_id"))

    results = []
    for stock_id in stocks:
        print(f"→ {stock_id} ...", flush=True)
        r = run_backtest(
            stock_id,
            months=args.months,
            cooldown=args.cooldown,
            max_hold_bars=args.max_hold_bars,
            stop_loss_pct=args.stop_loss_pct,
        )
        results.append(r)

    print("\n" + "=" * 100)
    header = f"{'stock':<8}{'bars':>6}{'buy':>5}{'sell':>6}{'trades':>8}{'win%':>7}{'avgW':>8}{'avgL':>8}{'total%':>9}{'maxDD%':>8}"
    print(header)
    print("-" * 100)
    for r in results:
        if "error" in r:
            print(f"{r['stock_id']:<8}  ERROR: {r['error']}")
            continue
        print(
            f"{r['stock_id']:<8}{r['bars']:>6}{r['buy_signals']:>5}{r['sell_signals']:>6}"
            f"{r['closed_trades']:>8}{r['win_rate_pct']:>7}{r['avg_win_pct']:>8}"
            f"{r['avg_loss_pct']:>8}{r['total_return_pct']:>9}{r['max_drawdown_pct']:>8}"
        )


if __name__ == "__main__":
    main()
