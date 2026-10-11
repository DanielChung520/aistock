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
from stable_baselines3.common.callbacks import BaseCallback
import pandas as pd
from arango import ArangoClient
from stable_baselines3 import A2C, DQN, PPO
from sb3_contrib import QRDQN, TRPO

from src.celery_app import celery_app

logger = logging.getLogger(__name__)

JOBS_COLLECTION = "tx_rl_training_jobs"
MODELS_COLLECTION = "tx_rl_models"
MODEL_DIR = Path("/home/daniel/github/aistock/backend/tx_rl_models")

ALGO_MAP = {"ppo": PPO, "a2c": A2C, "dqn": DQN, "trpo": TRPO, "qrdqn": QRDQN}


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


def _load_tx_features_df() -> pd.DataFrame:
    """載入台指期 15 分 K 特徵矩陣（build_features.py 產出）。

    特徵矩陣含：date, time, session, OHLCV + us_*/chip_*/spot_*/micro_* 特徵。
    date 為 YYYY/M/D、time 為 HH:MM，統一為 YYYY-MM-DD 以利比對。
    """
    path = Path(__file__).resolve().parent.parent.parent.parent / "data" / "台指期-15分K-features.csv"
    if not path.exists():
        raise RuntimeError(f"特徵矩陣不存在：{path}。請先執行 data/build_features.py")
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"], format="%Y/%m/%d").dt.strftime("%Y-%m-%d")
    return df.reset_index(drop=True)


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
    cum_pct = float(pnl.sum())
    sharpe = float(pnl.mean() / (pnl.std() + 1e-9) * np.sqrt(252)) if len(pnl) > 1 else 0.0
    downside = pnl[pnl < 0]
    downside_std = float(downside.std()) if len(downside) > 1 else 0.0
    sortino = float(pnl.mean() / (downside_std + 1e-9) * np.sqrt(252)) if len(pnl) > 1 and downside_std > 0 else 0.0
    mdd_pct = float(env.drawdown * 100)
    calmar = float(cum_pct / (abs(mdd_pct) + 1e-9)) if abs(mdd_pct) > 1e-9 else 0.0
    win_rate = float((pnl > 0).mean() * 100)
    return {
        "cumulative_return_pct": round(cum_pct, 2),
        "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3),
        "calmar": round(calmar, 3),
        "max_drawdown_pct": round(mdd_pct, 2),
        "win_rate_pct": round(win_rate, 2),
        "num_trades": int(env.num_trades),
        "num_steps": int(len(pnl)),
    }


def _collect_visualization_data(env, model, df: pd.DataFrame, max_points: int = 500) -> tuple[list, list, list]:
    """Run the trained policy once to collect per-day equity curve, trades, and rewards.

    Returns:
        equity_curve: list[{date, equity, drawdown, position}]
        trade_list: list[{date, action, entry_price, position}]
        episode_rewards: list[{step, reward}] (sampled to max_points)
    """
    equity_curve: list[dict] = []
    obs, _ = env.reset()
    done = False
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        step_idx = env.current_step
        if step_idx < len(df):
            equity_curve.append({
                "date": str(df["date"].iloc[step_idx]),
                "equity": round(1.0 + env.cum_pnl_pct / 100.0, 4),
                "drawdown": round(env.drawdown, 4),
                "position": env.position,
            })
        obs, _, terminated, truncated, _ = env.step(action)
        done = terminated or truncated

    rewards = env._reward_history
    if len(rewards) > max_points:
        step = max(1, len(rewards) // max_points)
        sampled = rewards[::step]
    else:
        sampled = rewards
    episode_rewards = [{"step": i * (len(rewards) // max(1, len(sampled))), "reward": round(float(r), 6)}
                       for i, r in enumerate(sampled)]
    if episode_rewards and (len(episode_rewards) - 1) * (len(rewards) // max(1, len(sampled))) < len(rewards) - 1:
        episode_rewards.append({"step": len(rewards) - 1, "reward": round(float(rewards[-1]), 6)})

    return equity_curve, list(env.trade_history), episode_rewards


class _RewardLogger(BaseCallback):
    """Capture mean episode reward at each rollout boundary.

    Reads `self.model.ep_info_buffer` (deque of episode {"r": reward} dicts)
    which is updated only after n_steps timesteps (one rollout completes).
    More reliable than name_to_value which depends on logger backend timing.
    """

    def __init__(self, every_n_rollouts: int = 1):
        super().__init__()
        self.every_n_rollouts = every_n_rollouts
        self.rollout_count = 0
        self.records: list[dict] = []

    def _on_step(self) -> bool:
        return True

    def _on_rollout_end(self) -> None:
        self.rollout_count += 1
        if self.rollout_count % self.every_n_rollouts != 0:
            return
        buf = self.model.ep_info_buffer
        if not buf:
            return
        mean_rew = float(np.mean([ep["r"] for ep in buf]))
        self.records.append({"step": int(self.num_timesteps), "reward": round(mean_rew, 4)})


class _ProgressTracker(BaseCallback):
    """Update DB progress fields every N steps for live UI feedback.

    Writes to:
      - progress.current_step: per-fold step (num_timesteps within current fold)
      - progress.fold_idx: 1-indexed fold number (set by caller before each learn)
      - progress.current_reward: latest mean episode reward
      - progress.last_update_ts: timestamp for staleness detection

    Rate-limit DB writes to every `every_steps` to avoid slowing training.
    """

    def __init__(self, job_id: str, fold_idx: int, n_folds: int, every_steps: int = 500):
        super().__init__()
        self.job_id = job_id
        self.fold_idx = fold_idx
        self.n_folds = n_folds
        self.every_steps = every_steps
        self._last_written = -1
        self._db = None

    def _get_db(self):
        if self._db is None:
            self._db = _get_db()
        return self._db

    def _on_step(self) -> bool:
        if self.num_timesteps - self._last_written < self.every_steps:
            return True
        if self.num_timesteps == self._last_written:
            return True
        self._last_written = self.num_timesteps
        try:
            buf = self.model.ep_info_buffer
            cur_rew = float(np.mean([ep["r"] for ep in buf])) if buf else 0.0
            self._get_db().collection(JOBS_COLLECTION).update({
                "_key": self.job_id,
                "progress": {
                    "current_step": int(self.num_timesteps),
                    "fold_idx": self.fold_idx,
                    "n_folds": self.n_folds,
                    "current_reward": round(cur_rew, 4),
                    "last_update_ts": int(time.time()),
                },
            })
        except Exception:
            pass
        return True


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
        data_source = config.get("data", {}).get("source", "twii")
        if data_source == "tx_features":
            df = _load_tx_features_df()
        else:
            df = _load_twii_df()
        if config.get("data", {}).get("start_date"):
            df = df[df["date"] >= config["data"]["start_date"]].reset_index(drop=True)
        if config["data"].get("end_date"):
            df = df[df["date"] <= config["data"]["end_date"]].reset_index(drop=True)
        if len(df) < 50:
            raise ValueError(f"資料不足：{len(df)} 筆（需 ≥50）")

        eval_start = config.get("data", {}).get("eval_start_date")
        eval_end = config.get("data", {}).get("eval_end_date")
        if eval_start and eval_end:
            train_df = df[df["date"] < eval_start].reset_index(drop=True)
            eval_df = df[(df["date"] >= eval_start) & (df["date"] <= eval_end)].reset_index(drop=True)
            if len(train_df) < 50 or len(eval_df) < 20:
                raise ValueError(f"切分後資料不足：train={len(train_df)}, eval={len(eval_df)}")
        else:
            train_df = df
            eval_df = df

        env_cfg = config["env"]
        algo_name = config["model"]["algorithm"]
        if algo_name not in ALGO_MAP:
            raise ValueError(f"不支援的 algorithm: {algo_name}")
        AlgoClass = ALGO_MAP[algo_name]

        def _make_env(data_df):
            hl = env_cfg.get("hard_limits", {})
            return TXTradingEnv(data_df, TXEnvConfig(
                action_mode=env_cfg["action_mode"],
                reward_mode=env_cfg["reward_mode"],
                reward_params=env_cfg.get("reward_params", {}),
                state_features=env_cfg.get("state_features", {}),
                fees=env_cfg.get("fees", {}),
                hard_stop_loss_pct=hl.get("stop_loss_pct", -0.03),
                hard_take_profit_pct=hl.get("take_profit_pct", 0.05),
                hard_max_hold_bars=hl.get("max_hold_bars", 0),
            ))

        def _make_model(seed_offset=0):
            return AlgoClass(
                "MlpPolicy",
                env_train,
                learning_rate=config["model"].get("learning_rate", 3e-4),
                n_steps=config["model"].get("n_steps", 2048),
                batch_size=config["model"].get("batch_size", 256),
                gamma=config["model"].get("gamma", 0.99),
                seed=config["model"].get("seed", 42) + seed_offset,
                policy_kwargs={"net_arch": {"pi": [256, 128], "vf": [256, 128]}},
                verbose=0,
                device="cuda",
            )

        env_train = _make_env(train_df)
        total_timesteps = config["model"].get("total_timesteps", 50000)
        db.collection(JOBS_COLLECTION).update({
            "_key": job_id,
            "total_timesteps": total_timesteps,
        })

        walk_forward = config.get("walk_forward", {})
        wf_enabled = bool(walk_forward.get("enabled", False))

        fold_metrics = []
        fold_equity_curves = []
        fold_trade_lists = []
        fold_info = []
        training_rewards: list[dict] = []
        agg_data_range = None

        if wf_enabled:
            train_days = int(walk_forward.get("train_window", 2520))
            test_days = int(walk_forward.get("test_window", 504))
            roll_days = int(walk_forward.get("roll_step", 504))
            n_folds_total = max(0, (len(df) - train_days - test_days) // roll_days + 1)
            fold_idx = 0
            start = 0
            while start + train_days + test_days <= len(df):
                fold_train_df = df.iloc[start:start + train_days].reset_index(drop=True)
                fold_test_df = df.iloc[start + train_days:start + train_days + test_days].reset_index(drop=True)
                env_train_fold = _make_env(fold_train_df)
                model_fold = AlgoClass(
                    "MlpPolicy", env_train_fold,
                    learning_rate=config["model"].get("learning_rate", 3e-4),
                    n_steps=config["model"].get("n_steps", 2048),
                    batch_size=config["model"].get("batch_size", 256),
                    gamma=config["model"].get("gamma", 0.99),
                    seed=config["model"].get("seed", 42) + fold_idx,
                    policy_kwargs={"net_arch": {"pi": [256, 128], "vf": [256, 128]}},
                    verbose=0, device="cuda",
                )
                reward_logger = _RewardLogger(every_n_rollouts=1)
                progress_tracker = _ProgressTracker(
                    job_id=job_id, fold_idx=fold_idx + 1, n_folds=n_folds_total, every_steps=500
                )
                model_fold.learn(total_timesteps=total_timesteps, callback=[reward_logger, progress_tracker])
                fold_reward_offset = fold_idx * total_timesteps
                for rec in reward_logger.records:
                    training_rewards.append({"step": rec["step"] + fold_reward_offset, "reward": rec["reward"], "fold": fold_idx + 1})
                env_eval_fold = _make_env(fold_test_df)
                fm = _compute_metrics(env_eval_fold, model_fold)
                fe, ft, _ = _collect_visualization_data(env_eval_fold, model_fold, fold_test_df)
                fm["fold"] = fold_idx + 1
                fm["train_span"] = f"{fold_train_df['date'].iloc[0]} ~ {fold_train_df['date'].iloc[-1]}"
                fm["test_span"] = f"{fold_test_df['date'].iloc[0]} ~ {fold_test_df['date'].iloc[-1]}"
                fold_metrics.append(fm)
                fold_equity_curves.extend(fe)
                fold_trade_lists.extend(ft)
                fold_info.append({
                    "fold": fold_idx + 1,
                    "train_rows": len(fold_train_df),
                    "test_rows": len(fold_test_df),
                })
                fold_idx += 1
                start += roll_days
                db.collection(JOBS_COLLECTION).update({
                    "_key": job_id,
                    "fold_progress": f"{fold_idx} folds done",
                })

            if fold_metrics:
                keys = ["cumulative_return_pct", "sharpe", "sortino", "calmar",
                        "max_drawdown_pct", "win_rate_pct", "num_trades"]
                agg = {}
                for k in keys:
                    vals = [m[k] for m in fold_metrics if k in m]
                    if vals:
                        arr = np.array(vals)
                        agg[f"{k}_mean"] = round(float(arr.mean()), 3)
                        agg[f"{k}_std"] = round(float(arr.std()), 3)
                agg["n_folds"] = len(fold_metrics)
                agg["data_range"] = {
                    "first_train": fold_info[0] if fold_info else None,
                    "last_test": fold_info[-1] if fold_info else None,
                    "n_folds": len(fold_metrics),
                }
                metrics = agg
                equity_curve = fold_equity_curves
                trade_list = fold_trade_lists
                episode_rewards = []
                MODEL_DIR.mkdir(parents=True, exist_ok=True)
                model_path = MODEL_DIR / job_id
                fold_model_path = model_path
                fold_model_fold = model_fold
                fold_model_fold.save(str(fold_model_path))
            else:
                train_days = int(walk_forward.get("train_window", 2520))
                test_days = int(walk_forward.get("test_window", 504))
                needed_days = train_days + test_days
                have_days = len(df)
                raise ValueError(
                    f"walk_forward 啟用但資料不足：目前資料 {have_days} 天（{have_days/252:.1f} 年），"
                    f"walk_forward 需要至少 {needed_days} 天（{needed_days/252:.1f} 年 = train_window {train_days} + test_window {test_days}）。"
                    f"請縮短 train_window 或 test_window，或延長 data.start_date / data.end_date。"
                )
        else:
            model = _make_model(seed_offset=0)
            reward_logger = _RewardLogger(every_n_rollouts=1)
            progress_tracker = _ProgressTracker(
                job_id=job_id, fold_idx=1, n_folds=1, every_steps=500
            )
            model.learn(total_timesteps=total_timesteps, callback=[reward_logger, progress_tracker])
            training_rewards = reward_logger.records
            MODEL_DIR.mkdir(parents=True, exist_ok=True)
            model_path = MODEL_DIR / job_id
            model.save(str(model_path))

            env_eval = _make_env(eval_df)
            metrics = _compute_metrics(env_eval, model)
            equity_curve, trade_list, episode_rewards = _collect_visualization_data(env_eval, model, eval_df)

            metrics["data_range"] = {
                "train": {"start": str(train_df["date"].iloc[0]), "end": str(train_df["date"].iloc[-1]), "rows": len(train_df)},
                "eval": {"start": str(eval_df["date"].iloc[0]), "end": str(eval_df["date"].iloc[-1]), "rows": len(eval_df)},
            }

        result = {
            "job_id": job_id,
            "model_path": str(model_path) + ".zip",
            "config": config,
            "metrics": metrics,
            "n_episodes": len(fold_metrics) if wf_enabled else 1,
            "total_timesteps": total_timesteps,
            "fold_metrics": fold_metrics if wf_enabled else None,
            "training_rewards": training_rewards,
        }
        if not db.has_collection(MODELS_COLLECTION):
            db.create_collection(MODELS_COLLECTION)
        db.collection(MODELS_COLLECTION).insert({
            "_key": job_id,
            "job_id": job_id,
            "model_path": result["model_path"],
            "config": config,
            "metrics": metrics,
            "equity_curve": equity_curve,
            "trade_list": trade_list,
            "episode_rewards": episode_rewards,
            "fold_metrics": fold_metrics if wf_enabled else None,
            "training_rewards": training_rewards,
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
