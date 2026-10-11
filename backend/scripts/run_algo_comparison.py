#!/usr/bin/env python3
"""Algorithm comparison: PPO / A2C / TRPO / QRDQN on identical walk_forward splits.

Note: SAC (stock SB3) doesn't support Discrete action space, so QRDQN (off-policy,
quantile regression DQN) is used as the discrete off-policy alternative.

Usage:
  .venv/bin/python scripts/run_algo_comparison.py
"""
from __future__ import annotations

import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=UserWarning, module="stable_baselines3")

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.tasks.tx_rl_env import TXTradingEnv, TXEnvConfig
from src.tasks.tx_rl_training import _load_twii_df
from src.tasks.tx_rl_training import ALGO_MAP

ALGOS = ["ppo", "a2c", "trpo", "qrdpn" if False else "qrdqn"]

COMMON_CFG = {
    "data": {"start_date": "2006-09-01", "end_date": "2026-08-21"},
    "env": {
        "action_mode": "discrete_3", "reward_mode": "sharpe_like",
        "reward_params": {"sharpe_window": 60},
        "state_features": {"price": True, "tech": True, "vol": True, "position": True,
                           "calendar": False, "cross_market": True},
        "fees": {"slippage_pct": 0.3, "commission_pct": 0.15},
    },
    "model": {"learning_rate": 3e-4, "total_timesteps": 50000, "seed": 42},
    "walk_forward": {"enabled": True, "train_window": 2520, "test_window": 504, "roll_step": 504},
}


def _make_env(df, cfg):
    return TXTradingEnv(df, TXEnvConfig(
        action_mode=cfg["env"]["action_mode"],
        reward_mode=cfg["env"]["reward_mode"],
        reward_params=cfg["env"]["reward_params"],
        state_features=cfg["env"]["state_features"],
        fees=cfg["env"]["fees"],
    ))


def _compute_metrics(env, model):
    obs, _ = env.reset()
    done = False
    pnl = []
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        obs, _r, term, trunc, info = env.step(action)
        pnl.append(info.get("pnl_pct", 0.0))
        done = term or trunc
    pnl_arr = np.array(pnl)
    cum = float(pnl_arr.sum())
    sharpe = float(pnl_arr.mean() / (pnl_arr.std() + 1e-9) * np.sqrt(252)) if len(pnl_arr) > 1 else 0.0
    downside = pnl_arr[pnl_arr < 0]
    dstd = float(downside.std()) if len(downside) > 1 else 0.0
    sortino = float(pnl_arr.mean() / (dstd + 1e-9) * np.sqrt(252)) if dstd > 0 else 0.0
    mdd_pct = float(env.drawdown * 100)
    return {
        "cum_pct": round(cum, 2),
        "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3),
        "mdd_pct": round(mdd_pct, 2),
        "num_trades": int(env.num_trades),
        "n_steps": int(len(pnl_arr)),
    }


def _run_algo(algo_name: str, df: pd.DataFrame, cfg: dict) -> dict:
    """Train one algorithm with walk_forward, return aggregate metrics."""
    AlgoCls = ALGO_MAP[algo_name]
    train_days = cfg["walk_forward"]["train_window"]
    test_days = cfg["walk_forward"]["test_window"]
    roll_days = cfg["walk_forward"]["roll_step"]
    total_timesteps = cfg["model"]["total_timesteps"]
    seed = cfg["model"]["seed"]
    lr = cfg["model"]["learning_rate"]

    fold_metrics = []
    fold_count = 0
    start = 0
    while start + train_days + test_days <= len(df):
        fold_train_df = df.iloc[start:start + train_days].reset_index(drop=True)
        fold_test_df = df.iloc[start + train_days:start + train_days + test_days].reset_index(drop=True)
        env_train = _make_env(fold_train_df, cfg)
        env_eval = _make_env(fold_test_df, cfg)

        algo_kwargs: dict = {
            "learning_rate": lr,
            "seed": seed + fold_count,
            "verbose": 0,
            "device": "auto",
        }
        if algo_name in ("qrdqn", "dqn"):
            algo_kwargs.update({"buffer_size": 10000, "learning_starts": 200})

        model = AlgoCls("MlpPolicy", env_train, **algo_kwargs)
        model.learn(total_timesteps=total_timesteps)
        fm = _compute_metrics(env_eval, model)
        fm["fold"] = fold_count + 1
        fold_metrics.append(fm)
        fold_count += 1
        start += roll_days

    if not fold_metrics:
        return {"algo": algo_name, "error": "no folds"}
    cums = [f["cum_pct"] for f in fold_metrics]
    sharpes = [f["sharpe"] for f in fold_metrics]
    sortinos = [f["sortino"] for f in fold_metrics]
    mdds = [f["mdd_pct"] for f in fold_metrics]
    trades = [f["num_trades"] for f in fold_metrics]
    return {
        "algo": algo_name,
        "n_folds": fold_count,
        "cum_pct_mean": round(np.mean(cums), 2),
        "cum_pct_std": round(np.std(cums), 2),
        "sharpe_mean": round(np.mean(sharpes), 3),
        "sortino_mean": round(np.mean(sortinos), 3),
        "mdd_pct_mean": round(np.mean(mdds), 2),
        "trades_mean": round(np.mean(trades), 2),
        "per_fold": fold_metrics,
    }


def main() -> int:
    print("=" * 80)
    print("Algorithm Comparison: PPO / A2C / TRPO / QRDQN on walk_forward 4 folds")
    print("State: 24-dim (price+tech+vol+position+cross_market)")
    print("Reward: sharpe_like (60-day rolling)")
    print("Train: 2520 days / Test: 504 days / Roll: 504 days")
    print("Seed: 42, total_timesteps: 50000")
    print("Note: SAC not included (stock SB3 only supports continuous actions)")
    print("=" * 80)

    df = _load_twii_df()
    df['date'] = df['date'].astype(str)
    df = df[df['date'] >= COMMON_CFG["data"]["start_date"]].reset_index(drop=True)
    print(f"\nLoaded {len(df)} rows\n")

    results: list[dict] = []
    for algo in ["ppo", "a2c", "trpo", "qrdqn"]:
        print(f"\n--- Training {algo.upper()} ---")
        t0 = time.time()
        try:
            r = _run_algo(algo, df, COMMON_CFG)
            r["wall_time_sec"] = round(time.time() - t0, 1)
            print(f"  done in {r['wall_time_sec']}s")
            results.append(r)
        except Exception as e:
            print(f"  FAILED: {type(e).__name__}: {str(e)[:120]}")
            results.append({"algo": algo, "error": str(e)[:120]})

    print("\n" + "=" * 80)
    print("COMPARISON TABLE (mean ± std across 4 folds)")
    print("=" * 80)
    print(f"{'Algo':<8} {'cum_pct':>12} {'sharpe':>8} {'sortino':>9} {'mdd_pct':>10} {'trades':>8} {'time(s)':>8}")
    print("-" * 80)
    for r in results:
        if "error" in r:
            print(f"{r['algo']:<8} ERROR: {r['error']}")
            continue
        print(f"{r['algo']:<8} "
              f"{r['cum_pct_mean']:>+8.2f}±{r['cum_pct_std']:<3.2f} "
              f"{r['sharpe_mean']:>+8.3f} "
              f"{r['sortino_mean']:>+9.3f} "
              f"{r['mdd_pct_mean']:>+10.2f} "
              f"{r['trades_mean']:>8.2f} "
              f"{r['wall_time_sec']:>8.1f}")

    print("\n" + "=" * 80)
    print("Per-fold breakdown")
    print("=" * 80)
    print(f"{'Algo':<8} {'fold':<5} {'cum%':>8} {'sharpe':>8} {'mdd%':>8} {'trades':>7}")
    print("-" * 80)
    for r in results:
        if "error" in r:
            continue
        for f in r["per_fold"]:
            print(f"{r['algo']:<8} "
                  f"{f['fold']:<5} "
                  f"{f['cum_pct']:>+7.2f}% "
                  f"{f['sharpe']:>+8.3f} "
                  f"{f['mdd_pct']:>+7.2f}% "
                  f"{f['num_trades']:>7}")

    out = ROOT / "data" / "algo_comparison.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame([{k: v for k, v in r.items() if k != 'per_fold'} for r in results]).to_json(out, orient='records', indent=2)
    print(f"\nSaved → {out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())