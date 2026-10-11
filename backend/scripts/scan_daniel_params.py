"""Grid search over Daniel MA signal parameters.

Evaluates every combination of cooldown / buy_slope_min / sell_slope_max on a
fixed universe of stocks and reports the most robust parameter set. Robustness
is scored by ranking each stock's total return and win rate, then averaging the
ranks (lower is better) — this penalizes parameter sets that win big on one
stock but fail everywhere else.

Usage:
    python scripts/scan_daniel_params.py [--months 24] [--stocks 2330,2317,...]
"""
from __future__ import annotations

import argparse
import sys
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.data_fetcher import fetch_daily_history
from src.indicators import calculate_ma_daniel


def backtest_once(dates, highs, lows, closes, volumes, cooldown, buy_slope_min, sell_slope_max) -> dict:
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
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    position = None
    trades = 0
    wins = 0
    for i, sig in enumerate(signals):
        if position is not None:
            stop_hit = False  # no risk controls in scan
            hold_hit = False
            if stop_hit or hold_hit:
                continue
        if sig.get("buy") and position is None:
            position = closes[i]
        elif sig.get("sell") and position is not None:
            ret = (closes[i] / position - 1) * 100
            equity *= 1 + ret / 100
            peak = max(peak, equity)
            max_dd = max(max_dd, (peak - equity) / peak)
            trades += 1
            if ret > 0:
                wins += 1
            position = None
    if position is not None:
        ret = (closes[-1] / position - 1) * 100
        equity *= 1 + ret / 100
        trades += 1
        if ret > 0:
            wins += 1
    return {
        "total_return_pct": (equity - 1) * 100,
        "max_dd_pct": max_dd * 100,
        "win_rate_pct": (wins / trades * 100) if trades else 0,
        "trades": trades,
    }


def load_stock(stock_id: str, months: int):
    data = fetch_daily_history(stock_id, months=months)
    if not data:
        return None
    dates = [str(item["date"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]
    return dates, highs, lows, closes, volumes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--months", type=int, default=24)
    parser.add_argument("--stocks", type=str, default="2330,2317,2454,2603,2881,2891,2308,3008,2412,2409,3231,3711")
    args = parser.parse_args()

    stocks = [s.strip() for s in args.stocks.split(",") if s.strip()]
    datasets = {}
    for sid in stocks:
        d = load_stock(sid, months=args.months)
        if d:
            datasets[sid] = d
    print(f"Universe: {list(datasets.keys())}")

    grid = list(product([0, 1, 2, 3], [0.03, 0.05, 0.08], [0.01, 0.02, 0.03]))
    print(f"Grid: {len(grid)} combinations")

    rows = []
    for cooldown, buy_min, sell_max in grid:
        per_stock = {}
        for sid, (dates, highs, lows, closes, volumes) in datasets.items():
            per_stock[sid] = backtest_once(dates, highs, lows, closes, volumes, cooldown, buy_min, sell_max)
        rows.append(
            {
                "cooldown": cooldown,
                "buy_slope_min": buy_min,
                "sell_slope_max": sell_max,
                "per_stock": per_stock,
            }
        )

    # Rank each stock across all parameter sets; average the rank per set.
    for row in rows:
        ranks = []
        for sid in datasets:
            by_total = sorted(rows, key=lambda r: r["per_stock"][sid]["total_return_pct"])
            rank_total = by_total.index(row)
            ranks.append(rank_total)
        row["avg_rank"] = sum(ranks) / len(ranks)
        row["mean_return"] = sum(row["per_stock"][sid]["total_return_pct"] for sid in datasets) / len(datasets)
        row["mean_winrate"] = sum(row["per_stock"][sid]["win_rate_pct"] for sid in datasets) / len(datasets)
        row["mean_maxdd"] = sum(row["per_stock"][sid]["max_dd_pct"] for sid in datasets) / len(datasets)
        positive = sum(1 for sid in datasets if row["per_stock"][sid]["total_return_pct"] > 0)
        row["positive_stocks"] = positive

    rows.sort(key=lambda r: r["avg_rank"])
    print("\n" + "=" * 110)
    print(f"{'cd':>3} {'buyMin':>7} {'sellMax':>8} {'avgRank':>8} {'meanRet%':>9} {'winRate%':>9} {'maxDD%':>8} {'posStocks':>10}")
    print("-" * 110)
    for r in rows[:15]:
        print(
            f"{r['cooldown']:>3} {r['buy_slope_min']:>7.2f} {r['sell_slope_max']:>8.2f} "
            f"{r['avg_rank']:>8.1f} {r['mean_return']:>9.1f} {r['mean_winrate']:>9.1f} "
            f"{r['mean_maxdd']:>8.1f} {r['positive_stocks']:>10}"
        )
    print("-" * 110)
    best = rows[0]
    print(
        f"BEST: cooldown={best['cooldown']}, buy_slope_min={best['buy_slope_min']}, "
        f"sell_slope_max={best['sell_slope_max']} (avgRank={best['avg_rank']:.1f}, "
        f"meanReturn={best['mean_return']:.1f}%, winRate={best['mean_winrate']:.1f}%, "
        f"maxDD={best['mean_maxdd']:.1f}%, positive={best['positive_stocks']}/{len(datasets)})"
    )


if __name__ == "__main__":
    main()
