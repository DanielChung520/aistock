"""Celery task: train TX (台指期) RL agent per SPEC TX-0010 §5.3.

Uses stable-baselines3 (PPO default). Fetches TWII from stock_daily,
builds TXTradingEnv, trains, saves model, computes backtest metrics,
and stores results in tx_rl_models / tx_rl_training_jobs collections.
"""
from __future__ import annotations

import json
import logging
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
from arango import ArangoClient
from stable_baselines3 import A2C, DQN, PPO

from src.celery_app import celery_app

logger = logging.getLogger(__name__)

JOBS_COLLECTION = "tx_rl_training_jobs"
MODELS_COLLECTION = "tx_rl_models"
MODEL_DIR = Path("/home/daniel/github/aistock/backend/tx_rl_models")

ALGO_MAP = {"ppo": PPO, "a2c": A2C, "dqn": DQN}


def _get_db():
    return ArangoClient(hosts="http://localhost:8530").db(
        "aistock", username="root", password="aistock2024"
    )


def _load_twii_df() -> pd.DataFrame:
    """Fetch TWII daily bars from stock_daily (injected by previous session)."""
    db = _get_db()
    rows = list(db.aql.execute(
        "FOR d IN stock_daily FILTER d.stock_id=='TWII' SORT d.date ASC "
        "RETURN {date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume}"
    ))
    if not rows:
        raise RuntimeError("TWII 資料不存在於 stock_daily，請先執行 /tmp/opencode/inject_twii.py")
    return pd.DataFrame(rows).reset_index(drop=True)


def _compute_metrics(env, model, episodes: int = 1) -> dict:
    """Run a final episode and collect aggregate metrics."""
    all_pnl = []
    for _ in range(episodes):
        obs, _ = env.reset()
        done = False
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, terminated, truncated, info = env.step(action)
            all_pnl.append(info.get("pnl_pct", 0.0))
            done = terminated or truncated
    pnl = np.array(all_pnl)
    cum = float(pnl.sum() / 100.0)
    sharpe = float(pnl.mean() / (pnl.std() + 1e-9) * np.sqrt(252)) if len(pnl) > 1 else 0.0
    mdd = float(env.drawdown * 100)
    win_rate = float((pnl > 0).mean() * 100)
    return {
        "cumulative_return_pct": round(cum * 100, 2),
        "sharpe": round(sharpe, 3),
        "max_drawdown_pct": round(mdd, 2),
        "win_rate_pct": round(win_rate, 2),
        "num_trades": int(env.num_trades),
        "num_steps": int(len(pnl)),
    }


@celery_app.task(bind=True)
def train_tx_rl_agent_task(self, job_id: str, config: dict) -> dict:
    """Train a TX RL agent and persist results.

    config schema (from SPEC §10.1):
      data: {start_date, end_date, train_ratio, val_ratio, test_ratio}
      env: {action_mode, reward_mode, reward_params, state_features, fees}
      model: {algorithm, learning_rate, n_steps, batch_size, gamma, seed, total_timesteps}
      walk_forward: {enabled, train_window, val_window, test_window, roll_step}
    """
    from src.tasks.tx_rl_env import TXEnvConfig, TXTradingEnv

    db = _get_db()
    if not db.collection(JOBS_COLLECTION).has(job_id):
        return {"ok": False, "job_id": job_id, "error": "training job not found"}

    db.collection(JOBS_COLLECTION).update({"_key": job_id, "status": "running", "started_at": int(time.time())})

    try:
        df = _load_twii_df()
        if config.get("data", {}).get("start_date"):
            df = df[df["date"] >= config["data"]["start_date"]].reset_index(drop=True)
        if config["data"].get("end_date"):
            df = df[df["date"] <= config["data"]["end_date"]].reset_index(drop=True)
        if len(df) < 50:
            raise ValueError(f"資料不足：{len(df)} 筆（需 ≥50）")

        env_cfg = config["env"]
        env = TXTradingEnv(df, TXEnvConfig(
            action_mode=env_cfg["action_mode"],
            reward_mode=env_cfg["reward_mode"],
            reward_params=env_cfg.get("reward_params", {}),
            state_features=env_cfg.get("state_features", {}),
            fees=env_cfg.get("fees", {}),
        ))

        algo_name = config["model"]["algorithm"]
        if algo_name not in ALGO_MAP:
            raise ValueError(f"不支援的 algorithm: {algo_name}")
        AlgoClass = ALGO_MAP[algo_name]

        model = AlgoClass(
            "MlpPolicy",
            env,
            learning_rate=config["model"].get("learning_rate", 3e-4),
            n_steps=config["model"].get("n_steps", 2048),
            batch_size=config["model"].get("batch_size", 64),
            gamma=config["model"].get("gamma", 0.99),
            seed=config["model"].get("seed", 42),
            verbose=0,
            device="auto",
        )

        total_timesteps = config["model"].get("total_timesteps", 50000)
        model.learn(total_timesteps=total_timesteps)

        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        model_path = MODEL_DIR / job_id
        model.save(str(model_path))

        metrics = _compute_metrics(env, model)

        result = {
            "job_id": job_id,
            "model_path": str(model_path) + ".zip",
            "config": config,
            "metrics": metrics,
            "n_episodes": 1,
            "total_timesteps": total_timesteps,
        }
        db.collection(MODELS_COLLECTION).insert({
            "_key": job_id,
            "job_id": job_id,
            "model_path": result["model_path"],
            "config": config,
            "metrics": metrics,
            "created_at": int(time.time()),
        })
        db.collection(JOBS_COLLECTION).update({
            "_key": job_id,
            "status": "completed",
            "finished_at": int(time.time()),
            "result_ref": f"{MODELS_COLLECTION}/{job_id}",
        })
        return {"ok": True, "job_id": job_id, "metrics": metrics}

    except Exception as exc:
        logger.error("train_tx_rl %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        db.collection(JOBS_COLLECTION).update({
            "_key": job_id,
            "status": "failed",
            "finished_at": int(time.time()),
            "error": str(exc),
        })
        return {"ok": False, "job_id": job_id, "error": str(exc)}
