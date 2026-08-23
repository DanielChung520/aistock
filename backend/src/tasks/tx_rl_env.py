"""Gymnasium environment for Taiwan Index Futures (TX) daily-K trading.

Implements TXTradingEnv per SPEC TX-0010 §4. State / Action / Reward are
all configurable via TXEnvConfig. Execution is realistic: next-day open
entry (not close[t]), 0.3% × 2 slippage, 0.15% × 2 commission.

Walk-forward validation, 3 action modes, 3 reward modes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import gymnasium as gym
import numpy as np
import pandas as pd
from gymnasium import spaces


@dataclass
class TXEnvConfig:
    """Configuration for TXTradingEnv. All fields from SPEC TX-0010 §4."""

    action_mode: str = "discrete_3"  # discrete_3 | discrete_5 | continuous
    reward_mode: str = "pure_pnl"  # pure_pnl | sharpe | multi_objective
    reward_params: dict = field(default_factory=lambda: {"lambda_dd": 0.5, "mu_trade": 0.001})
    state_features: dict = field(default_factory=lambda: {
        "price": True, "tech": True, "vol": True, "position": True, "calendar": False,
    })
    fees: dict = field(default_factory=lambda: {"slippage_pct": 0.3, "commission_pct": 0.15})

    max_position: float = 1.0
    max_drawdown: float = 0.30
    max_daily_loss: float = 0.05
    initial_cash: float = 1_000_000.0
    contract_value: float = 200.0  # 1 點 = 200 元
    max_hold_days: int = 10  # 最大持有天數，0=不限
    point_unit: float = 1.0  # 用 1 點 = 1 元計算（簡化），後續可改用合約 200 元

    def get_state_dim(self) -> int:
        """Compute observation dimension from enabled features."""
        dim = 0
        if self.state_features.get("price"):
            dim += 5  # close_norm, high_norm, low_norm, open_norm, volume_norm
        if self.state_features.get("tech"):
            dim += 3  # MA5_ratio, MA20_ratio, RSI14
        if self.state_features.get("vol"):
            dim += 3  # ret_1d, ret_5d, vol_5d
        if self.state_features.get("position"):
            dim += 5  # position, days_held, unrealized_pnl, cum_pnl, drawdown
        if self.state_features.get("calendar"):
            dim += 2  # day_of_week, month
        return max(dim, 1)


class TXTradingEnv(gym.Env):
    """TX (Taiwan Index Futures) daily-K trading environment."""

    metadata = {"render_modes": ["human"]}

    def __init__(self, df: pd.DataFrame, config: TXEnvConfig | None = None):
        super().__init__()
        if config is None:
            config = TXEnvConfig()
        self.config = config
        self.df = df.reset_index(drop=True).copy()
        self.n_steps = len(df)
        if self.n_steps < 10:
            raise ValueError(f"需要至少 10 筆資料，實際 {self.n_steps}")

        # Pre-compute features
        self._compute_features()

        # Action space
        if config.action_mode == "discrete_3":
            self.action_space = spaces.Discrete(3)
            self._action_to_target = {0: -1.0, 1: 0.0, 2: 1.0}
        elif config.action_mode == "discrete_5":
            self.action_space = spaces.Discrete(5)
            self._action_to_target = {0: -1.0, 1: -0.5, 2: 0.0, 3: 0.5, 4: 1.0}
        elif config.action_mode == "continuous":
            self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(1,))
            self._action_to_target = None  # action 直接是部位
        else:
            raise ValueError(f"不支援的 action_mode: {config.action_mode}")

        # Observation space
        self.state_dim = config.get_state_dim()
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(self.state_dim,), dtype=np.float32
        )

        # Internal state
        self.current_step = 0
        self.position = 0.0  # -1, 0, +1
        self.entry_price = 0.0
        self.days_held = 0
        self.cum_pnl_pct = 0.0
        self.peak_pnl_pct = 0.0
        self.drawdown = 0.0
        self.num_trades = 0
        self.trade_history: list[dict] = []
        self._reward_history: list[float] = []

    def _compute_features(self):
        """Pre-compute technical features from OHLCV."""
        df = self.df
        # Price normalization (relative to first close)
        first_close = df["close"].iloc[0]
        self.close_norm = (df["close"] / first_close - 1).astype(np.float32)
        self.open_norm = (df["open"] / first_close - 1).astype(np.float32)
        self.high_norm = (df["high"] / first_close - 1).astype(np.float32)
        self.low_norm = (df["low"] / first_close - 1).astype(np.float32)
        self.volume_norm = (np.log1p(df["volume"].astype(float)) / 20).astype(np.float32)

        # Technical indicators
        ma5 = df["close"].rolling(5, min_periods=1).mean()
        ma20 = df["close"].rolling(20, min_periods=1).mean()
        self.ma5_ratio = ((df["close"] / ma5 - 1) * 100).fillna(0).astype(np.float32)
        self.ma20_ratio = ((df["close"] / ma20 - 1) * 100).fillna(0).astype(np.float32)
        # RSI14
        delta = df["close"].diff()
        gain = delta.clip(lower=0).rolling(14, min_periods=1).mean()
        loss = (-delta.clip(upper=0)).rolling(14, min_periods=1).mean()
        rs = gain / (loss + 1e-10)
        self.rsi14 = (100 - 100 / (1 + rs)).fillna(50).astype(np.float32) / 100.0

        # Volatility
        self.ret_1d = df["close"].pct_change(1).fillna(0).astype(np.float32) * 100
        self.ret_5d = df["close"].pct_change(5).fillna(0).astype(np.float32) * 100
        self.vol_5d = self.ret_1d.rolling(5, min_periods=1).std().fillna(0).astype(np.float32)

        # Calendar
        dates = pd.to_datetime(df["date"])
        self.day_of_week = dates.dt.dayofweek.astype(np.float32) / 4.0
        self.month = (dates.dt.month - 1).astype(np.float32) / 11.0

    def _get_observation(self) -> np.ndarray:
        """Build state vector from enabled features."""
        i = self.current_step
        parts: list[np.float32] = []

        if self.config.state_features.get("price"):
            parts.extend([
                self.close_norm[i], self.high_norm[i], self.low_norm[i],
                self.open_norm[i], self.volume_norm[i],
            ])
        if self.config.state_features.get("tech"):
            parts.extend([self.ma5_ratio[i], self.ma20_ratio[i], self.rsi14[i]])
        if self.config.state_features.get("vol"):
            parts.extend([self.ret_1d[i], self.ret_5d[i], self.vol_5d[i]])
        if self.config.state_features.get("position"):
            parts.extend([
                np.float32(self.position),
                np.float32(min(self.days_held, 10) / 10.0),
                np.float32(self._unrealized_pnl_pct(i) / 10.0),
                np.float32(np.clip(self.cum_pnl_pct / 30.0, -1, 1)),
                np.float32(np.clip(self.drawdown / 0.5, -1, 0)),
            ])
        if self.config.state_features.get("calendar"):
            parts.extend([self.day_of_week[i], self.month[i]])

        # Pad if state_dim larger than parts (e.g., when calendar=disabled)
        while len(parts) < self.state_dim:
            parts.append(np.float32(0.0))
        return np.array(parts[: self.state_dim], dtype=np.float32)

    def _unrealized_pnl_pct(self, step: int) -> float:
        """Unrealized PnL as % of initial price."""
        if self.position == 0 or self.entry_price == 0:
            return 0.0
        current_price = self.df["close"].iloc[step]
        return (current_price / self.entry_price - 1) * 100 * self.position

    def _is_hold_action(self, action: int | np.ndarray) -> bool:
        """Return True if the action means 'keep current position' (no transaction)."""
        if self.config.action_mode == "discrete_3" and int(action) == 1:
            return True
        if self.config.action_mode == "discrete_5" and int(action) == 2:
            return True
        return False

    def _execute_action(self, action: int | np.ndarray) -> float:
        """Execute target position, return transaction cost %.

        Entry price = open[t+1] (next-day open, per SPEC §6.1).
        Slippage 0.3% × 2 + commission 0.15% × 2.
        """
        if self._is_hold_action(action):
            return 0.0

        if self.config.action_mode in ("discrete_3", "discrete_5"):
            target = self._action_to_target[int(action)]
        else:
            target = float(np.clip(action[0], -1, 1))

        target = float(np.clip(target, -self.config.max_position, self.config.max_position))
        delta = target - self.position
        if abs(delta) < 1e-6:
            return 0.0

        if self.current_step + 1 < self.n_steps:
            entry_price = float(self.df["open"].iloc[self.current_step + 1])
        else:
            entry_price = float(self.df["close"].iloc[self.current_step])

        cost_pct = (self.config.fees["slippage_pct"] + self.config.fees["commission_pct"]) * 2 / 100.0

        self.position = target
        self.entry_price = entry_price
        self.days_held = 0
        self.num_trades += 1
        return cost_pct

    def _compute_reward(self, realized_pnl_pct: float, cost_pct: float) -> float:
        """Compute reward per SPEC §4.3."""
        if self.config.reward_mode == "pure_pnl":
            return realized_pnl_pct - cost_pct
        elif self.config.reward_mode == "sharpe":
            # Sharpe-like: daily_pnl / rolling_vol
            vol = abs(self.vol_5d[self.current_step]) + 0.1
            return (realized_pnl_pct - cost_pct) / vol
        elif self.config.reward_mode == "multi_objective":
            lam = self.config.reward_params.get("lambda_dd", 0.5)
            mu = self.config.reward_params.get("mu_trade", 0.001)
            return realized_pnl_pct - cost_pct * 100 - lam * abs(self.drawdown) * 100 - mu * 100
        return realized_pnl_pct

    def reset(self, *, seed: int | None = None, options: dict | None = None) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        if seed is not None:
            np.random.seed(seed)
        self.current_step = 0
        self.position = 0.0
        self.entry_price = 0.0
        self.days_held = 0
        self.cum_pnl_pct = 0.0
        self.peak_pnl_pct = 0.0
        self.drawdown = 0.0
        self.num_trades = 0
        self.trade_history = []
        self._reward_history = []
        return self._get_observation(), {}

    def step(self, action: int | np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]:
        cost_pct = self._execute_action(action)
        self.days_held += 1

        # Realized PnL: if holding, compute mark-to-market from entry to close[t+1]
        next_step = self.current_step + 1
        if self.position != 0 and next_step < self.n_steps:
            next_price = float(self.df["close"].iloc[next_step])
            realized_pnl_pct = (next_price / self.entry_price - 1) * 100 * self.position
        else:
            realized_pnl_pct = 0.0

        # Forced close at episode end
        terminated = next_step >= self.n_steps
        if terminated and self.position != 0:
            last_price = float(self.df["close"].iloc[self.current_step])
            realized_pnl_pct = (last_price / self.entry_price - 1) * 100 * self.position
            self.position = 0.0

        # Update cum_pnl
        self.cum_pnl_pct += realized_pnl_pct - cost_pct * 100
        self.peak_pnl_pct = max(self.peak_pnl_pct, self.cum_pnl_pct)
        self.drawdown = min(0.0, (self.cum_pnl_pct - self.peak_pnl_pct) / 100.0)

        # Risk control: max drawdown
        truncated = False
        if abs(self.drawdown) >= self.config.max_drawdown:
            truncated = True

        reward = self._compute_reward(realized_pnl_pct, cost_pct * 100)
        self._reward_history.append(float(reward))

        info = {
            "pnl_pct": realized_pnl_pct,
            "cum_pnl_pct": self.cum_pnl_pct,
            "position": self.position,
            "drawdown": self.drawdown,
            "num_trades": self.num_trades,
            "days_held": self.days_held,
            "cost_pct": cost_pct * 100,
        }

        self.current_step = next_step
        return self._get_observation() if not terminated else np.zeros(self.state_dim, dtype=np.float32), float(reward), terminated, truncated, info

    def render(self):
        if self.current_step < self.n_steps:
            date = self.df["date"].iloc[min(self.current_step, self.n_steps - 1)]
            print(f"[{date}] pos={self.position:.2f} cum_pnl={self.cum_pnl_pct:.2f}% dd={self.drawdown*100:.1f}% trades={self.num_trades}")
