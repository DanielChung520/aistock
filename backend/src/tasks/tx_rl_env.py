"""Gymnasium environment for Taiwan Index Futures (TX) daily-K trading.

Implements TXTradingEnv per SPEC TX-0010 §4. State / Action / Reward are
all configurable via TXEnvConfig. Execution is realistic: next-day open
entry (not close[t]), 0.3% × 2 slippage, 0.15% × 2 commission.

Walk-forward validation, 3 action modes, 3 reward modes.
"""
from __future__ import annotations

from collections import deque
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
    reward_mode: str = "pure_pnl"  # pure_pnl | sharpe | sharpe_like | multi_objective | risk_adjusted | sparse_pnl
    reward_params: dict = field(default_factory=lambda: {"lambda_dd": 0.5, "lambda_vol": 0.3, "sharpe_window": 60, "mu_trade": 0.001})
    state_features: dict = field(default_factory=lambda: {
        "price": True, "tech": True, "vol": True, "position": True, "calendar": False,
        "rolling_z": False, "sin_cos": False, "momentum": False, "ma_distance": False,
        "precomputed": False,
    })
    fees: dict = field(default_factory=lambda: {"slippage_pct": 0.3, "commission_pct": 0.15})

    max_position: float = 1.0
    max_drawdown: float = 0.99
    max_daily_loss: float = 0.05
    initial_cash: float = 1_000_000.0
    contract_value: float = 200.0  # 1 點 = 200 元
    max_hold_days: int = 10  # 最大持有天數，0=不限
    point_unit: float = 1.0  # 用 1 點 = 1 元計算（簡化），後續可改用合約 200 元

    # 硬性風控底線（Hard Limits）：陳豐然 López de Prado 業界最佳實務
    # 防止 Agent 訓練探索期間破產；與 max_drawdown（帳戶層級）獨立。
    # 計算基準 = 進場價 vs 當前 close 的（position × (close - entry)/entry）
    hard_stop_loss_pct: float = -0.03  # 單筆 -3% 強制平倉（<0 表示停損，0=禁用）
    hard_take_profit_pct: float = 0.05  # 單筆 +5% 強制平倉（>0 表示停利，0=禁用）
    hard_max_hold_bars: int = 0  # 持有超過 N 根 K棒強制平倉（0=不限）

    # ── 真實化模型（realistic_cash=True 時生效）──
    # 大台 TX：契約乘數 200 元/點；原始保證金 ~167,000/口；維持保證金 ~128,000/口（2026 期交所）
    realistic_cash: bool = False  # True = 金額制現金流 + 保證金 + 每日結算（期貨真實模型）
    contract_multiplier: float = 200.0  # 每點新台幣
    initial_margin: float = 167_000.0  # 原始保證金/口
    maintenance_margin: float = 128_000.0  # 維持保證金/口
    trade_cost_ntd: float = 0.0  # 每口單邊手續費（元），0 = 用 fees 百分比
    position_limit: float = 0.3  # 部位上限（可用資金比例），避免全倉

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
        if self.state_features.get("rolling_z"):
            dim += 5  # close_z, high_z, low_z, open_z, volume_z (rolling z-score)
        if self.state_features.get("sin_cos"):
            dim += 4  # sin_minute, cos_minute, sin_hour, is_night_session
        if self.state_features.get("momentum"):
            dim += 5  # ret_vol_1, ret_vol_3, ret_vol_6, rv_6, atr_ratio
        if self.state_features.get("ma_distance"):
            dim += 3  # ma_dist_8, ma_dist_32, ma_dist_160 (price/MA - 1)
        if self.state_features.get("precomputed"):
            dim += PRECOMPUTED_FEATURE_DIM  # us_*/chip_*/spot_*/micro_* from feature matrix
        if self.state_features.get("cross_market"):
            dim += 8  # sp500/ixic/vix/tnx/dxy features (see src/data/cross_market.py)
        if self.state_features.get("market_features"):
            from src.data.market_features import get_feature_dim as _mfd
            dim += _mfd()  # ~250 dims: top 30 stocks × 7 + 10 industries × 3 + 10 breadth
        return max(dim, 1)


def _rolling_z(series: pd.Series, window: int) -> pd.Series:
    """Causal rolling z-score of a series over a trailing window.

    Uses only data up to and including the current bar (no lookahead).
    Early bars use min_periods=1; zero std is backfilled to avoid div-by-0.
    """
    mean = series.rolling(window, min_periods=1).mean()
    std = series.rolling(window, min_periods=1).std().replace(0.0, np.nan).bfill()
    return ((series - mean) / std).fillna(0.0).clip(-5, 5).astype(np.float32)


# 特徵矩陣（build_features.py 產出）中的外部特徵欄位，固定順序。
# 開啟 state_features["precomputed"] 時，env 直接讀取這些欄位進 observation，
# 不重算（與 build_features.py 保持一致）。
PRECOMPUTED_FEATURE_COLUMNS: tuple[str, ...] = (
    "us_nq_ret1", "us_es_ret1", "us_sox_ret1", "us_tsm_ret1", "us_usdtwd_ret1",
    "us_vix_ret1", "us_dxy_ret1", "us_sp500_ret1", "us_ixic_ret1", "us_tnx_ret1",
    "chip_pcr_vol", "chip_pcr_oi", "chip_inst_foreign_net", "chip_inst_total_net",
    "chip_margin_chg", "spot_taiex_ret1",
    "micro_vwap_dev", "micro_ret_vol_1", "micro_ret_vol_3", "micro_ret_vol_6",
    "micro_rv_6", "micro_atr_ratio", "micro_ma_dist_8", "micro_ma_dist_32", "micro_ma_dist_160",
)
PRECOMPUTED_FEATURE_DIM = len(PRECOMPUTED_FEATURE_COLUMNS)


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
        self.position = 0.0  # 口數（realistic_cash）或 -1~1（抽象）
        self.entry_price = 0.0
        self.days_held = 0
        self.cum_pnl_pct = 0.0
        self._prev_unrealized_pct = 0.0
        self.peak_pnl_pct = 0.0
        self.drawdown = 0.0
        self.num_trades = 0
        self.trade_history: list[dict] = []
        self._reward_history: list[float] = []
        self._recent_returns: deque[float] = deque(maxlen=252)
        # 硬性風控追蹤：建倉時的 step（用於 hard_max_hold_bars）
        self._entry_bar_idx: int = -1
        # sparse_pnl 模式：上一次已實現 PnL（用於 step 計算 realized_delta）
        self._prev_realized_pnl_pct: float = 0.0

        # 真實化模型狀態（realistic_cash）
        self.cash = float(self.config.initial_cash)  # 帳戶總資金（NTD，含保證金占用）
        self.margin_used = 0.0  # 凍結保證金（NTD）
        self.equity = float(self.config.initial_cash)  # 帳戶權益（含浮動損益）
        self.cum_pnl_ntd = 0.0  # 累計損益（NTD）
        self._prev_equity = float(self.config.initial_cash)
        self._entry_price_ntd = 0.0  # 建倉價（點數）
        self._position_ntd = 0  # 目前口數（int，realistic_cash）

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

        if self.config.state_features.get("rolling_z"):
            # Causal rolling z-score: mean/std over trailing `roll_window` bars only.
            # Roll with min_periods=1 keeps early bars defined; std floor avoids div-by-0.
            roll_window = int(self.config.reward_params.get("z_window", 120))
            closes = df["close"].astype(float)
            roll_mean = closes.rolling(roll_window, min_periods=1).mean()
            roll_std = closes.rolling(roll_window, min_periods=1).std().replace(0.0, np.nan).bfill()
            self.close_z = ((closes - roll_mean) / roll_std).fillna(0.0).clip(-5, 5).astype(np.float32)
            self.high_z = _rolling_z(df["high"].astype(float), roll_window)
            self.low_z = _rolling_z(df["low"].astype(float), roll_window)
            self.open_z = _rolling_z(df["open"].astype(float), roll_window)
            self.volume_z = _rolling_z(np.log1p(df["volume"].astype(float)), roll_window)

        if self.config.state_features.get("sin_cos"):
            # Cyclical time features (minute-of-session + session flag).
            # 台指日盤 08:45~13:45 + 夜盤 15:00~05:00；以 24h 週期做 sin/cos
            if "time" in df.columns and df["time"].notna().any():
                times = pd.to_datetime(df["date"] + " " + df["time"], errors="coerce")
            else:
                # 日頻資料（無 time 欄位）→ 用當日 12:00 代表
                times = pd.to_datetime(df["date"], errors="coerce") + pd.Timedelta(hours=12)
            times = times.fillna(pd.Timestamp("2020-01-01 12:00"))
            minute_of_day = times.dt.hour * 60 + times.dt.minute
            self.sin_minute = np.sin(2 * np.pi * minute_of_day / (24 * 60)).astype(np.float32)
            self.cos_minute = np.cos(2 * np.pi * minute_of_day / (24 * 60)).astype(np.float32)
            self.sin_hour = np.sin(2 * np.pi * times.dt.hour / 24).astype(np.float32)
            self.is_night_session = np.zeros(len(df), dtype=np.float32)
            if "session" in df.columns:
                self.is_night_session = (df["session"].astype(str) == "night").astype(np.float32)

        if self.config.state_features.get("momentum"):
            # Vol-scaled multi-horizon returns + realized volatility + ATR ratio (DeepScalper/Zhang et al.)
            closes = df["close"].astype(float)
            ret = closes.pct_change()
            ewma_vol = ret.ewm(span=32, min_periods=1).std().replace(0.0, np.nan).bfill().fillna(1e-6)
            self.ret_vol_1 = (ret.fillna(0.0) / ewma_vol).clip(-5, 5).astype(np.float32)
            ret3 = closes.pct_change(3).fillna(0.0)
            self.ret_vol_3 = (ret3 / ewma_vol).clip(-5, 5).astype(np.float32)
            ret6 = closes.pct_change(6).fillna(0.0)
            self.ret_vol_6 = (ret6 / ewma_vol).clip(-5, 5).astype(np.float32)
            # Realized volatility (rolling std of returns over trailing window, z-scored)
            self.rv_6 = _rolling_z(ret.fillna(0.0).rolling(6, min_periods=1).std().fillna(0.0), 120).astype(np.float32)
            # ATR ratio: True Range / rolling mean ATR (volatility ratio, stationary)
            tr = pd.concat([
                (df["high"] - df["low"]).astype(float),
                (df["high"] - closes.shift(1)).abs(),
                (df["low"] - closes.shift(1)).abs(),
            ], axis=1).max(axis=1)
            atr = tr.rolling(32, min_periods=1).mean().replace(0.0, np.nan).bfill().fillna(1e-6)
            self.atr_ratio = (tr / atr - 1).clip(-3, 3).astype(np.float32)

        if self.config.state_features.get("ma_distance"):
            # MA-distance: price/MA - 1 at 3 distinct horizons (8, 32, 160 bars).
            # 15-min bars: 8≈2h, 32≈1day, 160≈1week. Matches DeepScalper's z_d pattern.
            closes = df["close"].astype(float)
            for period, attr in ((8, "ma_dist_8"), (32, "ma_dist_32"), (160, "ma_dist_160")):
                ma = closes.rolling(period, min_periods=1).mean()
                setattr(self, attr, ((closes / ma - 1) * 100).fillna(0.0).clip(-5, 5).astype(np.float32))

        if self.config.state_features.get("precomputed"):
            missing = [c for c in PRECOMPUTED_FEATURE_COLUMNS if c not in df.columns]
            if missing:
                raise ValueError(
                    f"state_features['precomputed'] 需要特徵矩陣欄位，缺少: {missing}。"
                    "請用 build_features.py 產生 台指期-15分K-features.csv"
                )
            self._precomputed = df[list(PRECOMPUTED_FEATURE_COLUMNS)].astype(np.float32).values
        else:
            self._precomputed = None

        if self.config.state_features.get("cross_market"):
            from src.data.cross_market import compute_features as _cm_compute, FEATURE_COLUMNS
            cm = _cm_compute(self.df["date"].astype(str).tolist())
            cm_indexed = cm.set_index("date").reindex(self.df["date"].astype(str).tolist())
            self._cross_market = cm_indexed[FEATURE_COLUMNS].astype(np.float32).values
        else:
            self._cross_market = np.zeros((self.n_steps, 8), dtype=np.float32)

        if self.config.state_features.get("market_features"):
            from src.data.market_features import compute_features as _mf_compute, get_feature_columns as _mf_cols
            mf = _mf_compute(self.df["date"].astype(str).tolist())
            mf_indexed = mf.set_index("date").reindex(self.df["date"].astype(str).tolist())
            self._market_features = mf_indexed[_mf_cols()].astype(np.float32).values
        else:
            self._market_features = np.zeros((self.n_steps, 0), dtype=np.float32)

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
            if self.config.realistic_cash:
                # 金額制：口數比例（normalized）+ 金額損益
                max_c = max(self._max_contracts(), 1)
                pos_norm = float(np.clip(self._position_ntd / max_c, -1, 1))
                equity_norm = float(np.clip(self.cum_pnl_ntd / self.config.initial_cash / 3.0, -1, 1))
                dd_norm = float(np.clip(self.drawdown / 0.5, -1, 0))
                parts.extend([
                    np.float32(pos_norm),
                    np.float32(min(self.days_held, 10) / 10.0),
                    np.float32(equity_norm),
                    np.float32(equity_norm),
                    np.float32(dd_norm),
                ])
            else:
                parts.extend([
                    np.float32(self.position),
                    np.float32(min(self.days_held, 10) / 10.0),
                    np.float32(self._unrealized_pnl_pct(i) / 10.0),
                    np.float32(np.clip(self.cum_pnl_pct / 30.0, -1, 1)),
                    np.float32(np.clip(self.drawdown / 0.5, -1, 0)),
                ])
        if self.config.state_features.get("calendar"):
            parts.extend([self.day_of_week[i], self.month[i]])
        if self.config.state_features.get("rolling_z"):
            parts.extend([self.close_z[i], self.high_z[i], self.low_z[i], self.open_z[i], self.volume_z[i]])
        if self.config.state_features.get("sin_cos"):
            parts.extend([self.sin_minute[i], self.cos_minute[i], self.sin_hour[i], self.is_night_session[i]])
        if self.config.state_features.get("momentum"):
            parts.extend([self.ret_vol_1[i], self.ret_vol_3[i], self.ret_vol_6[i], self.rv_6[i], self.atr_ratio[i]])
        if self.config.state_features.get("ma_distance"):
            parts.extend([self.ma_dist_8[i], self.ma_dist_32[i], self.ma_dist_160[i]])
        if self.config.state_features.get("precomputed"):
            parts.extend([np.float32(v) for v in self._precomputed[i]])
        if self.config.state_features.get("cross_market"):
            parts.extend([np.float32(v) for v in self._cross_market[i]])
        if self.config.state_features.get("market_features"):
            parts.extend([np.float32(v) for v in self._market_features[i]])

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

        if self.config.realistic_cash:
            return self._execute_action_realistic(target)

        target = float(np.clip(target, -self.config.max_position, self.config.max_position))
        delta = target - self.position
        if abs(delta) < 1e-6:
            return 0.0

        if self.current_step + 1 < self.n_steps:
            entry_price = float(self.df["open"].iloc[self.current_step + 1])
        else:
            entry_price = float(self.df["close"].iloc[self.current_step])

        cost_pct = (self.config.fees["slippage_pct"] + self.config.fees["commission_pct"]) * 2 / 100.0

        prev_position = self.position
        self.position = target
        self.entry_price = entry_price
        self.days_held = 0
        self.num_trades += 1
        # 硬性底線追蹤：建倉/加倉時記錄 bar idx（hard_max_hold_bars 用）
        if target != 0 and prev_position == 0:
            self._entry_bar_idx = self.current_step
        elif target == 0:
            self._entry_bar_idx = -1
        if prev_position != target:
            self.trade_history.append({
                "step": self.current_step,
                "date": str(self.df["date"].iloc[self.current_step]),
                "action": "Buy" if target > 0 else "Sell" if target < 0 else "Hold",
                "entry_price": entry_price,
                "position": target,
            })
        return cost_pct

    def _max_contracts(self) -> int:
        """依可用資金 × 部位上限計算最大可下口數（realistic_cash）。

        可用資金 = 總資金 − 已凍結保證金。position_limit 限制部位佔比，
        避免 RL 學到「全倉」這種真實交易不會做的極端行為。
        """
        margin_per_contract = self.config.initial_margin
        if margin_per_contract <= 0:
            return 100
        available = (self.cash - self.margin_used) * self.config.position_limit
        return max(0, int(available // margin_per_contract))

    def _execute_action_realistic(self, target: float) -> float:
        """金額制交易執行（口數為單位，保證金制）。

        target ∈ {-1, 0, +1}（discrete）或 [-1, 1]（continuous）。
        discrete: -1=滿倉做空、0=空手、+1=滿倉做多（口數由可用保證金決定）。
        continuous: target × 最大可下口數。
        成交價 = next bar open（含滑價）。回傳交易成本（NTD）。
        """
        max_contracts = self._max_contracts()
        if self.config.action_mode in ("discrete_3", "discrete_5"):
            target_contracts = int(target * max_contracts)
        else:
            target_contracts = int(round(target * max_contracts))
        target_contracts = int(np.clip(target_contracts, -max_contracts, max_contracts))

        if target_contracts == self._position_ntd:
            return 0.0

        if self.current_step + 1 < self.n_steps:
            fill_price = float(self.df["open"].iloc[self.current_step + 1])
        else:
            fill_price = float(self.df["close"].iloc[self.current_step])

        # 滑價（點數）：成交價偏移
        slippage_pts = fill_price * self.config.fees.get("slippage_pct", 0.3) / 100.0
        if target_contracts > self._position_ntd:  # 買（或多）→ 買價上移
            fill_price += slippage_pts
        elif target_contracts < self._position_ntd:  # 賣（或空）→ 賣價下移
            fill_price -= slippage_pts

        # 平倉部分：先實現損益（現金流入/流出）並退回保證金
        delta = target_contracts - self._position_ntd
        if delta != 0:
            close_contracts = min(abs(delta), abs(self._position_ntd))
            if close_contracts > 0:
                sign = 1 if self._position_ntd > 0 else -1
                realized = (fill_price - self._entry_price_ntd) * sign * close_contracts * self.config.contract_multiplier
                self.cash += realized
                self.cum_pnl_ntd += realized
                self.margin_used -= close_contracts * self.config.initial_margin
                self._position_ntd = self._position_ntd - sign * close_contracts

        # 開倉部分：凍結保證金 + 手續費
        open_contracts = abs(target_contracts) - abs(self._position_ntd)
        if open_contracts > 0:
            available = self.cash - self.margin_used
            max_open = int(available // self.config.initial_margin)
            open_contracts = min(open_contracts, max_open)
            if open_contracts > 0:
                self.margin_used += open_contracts * self.config.initial_margin
                self._entry_price_ntd = fill_price
                self._position_ntd = target_contracts
                # 硬性底線：建倉時記錄 bar idx（hard_max_hold_bars 用）
                self._entry_bar_idx = self.current_step
        # 平倉時清空 entry bar idx
        if target_contracts == 0:
            self._entry_bar_idx = -1

        # 手續費（每口單邊）
        trade_fee = (abs(delta) * self.config.trade_cost_ntd if self.config.trade_cost_ntd > 0
                     else abs(delta) * fill_price * self.config.fees.get("commission_pct", 0.15) / 100.0 * self.config.contract_multiplier)
        self.cash -= trade_fee
        self.cum_pnl_ntd -= trade_fee
        self.num_trades += 1
        self.entry_price = self._entry_price_ntd
        self.position = float(self._position_ntd)
        self.trade_history.append({
            "step": self.current_step,
            "date": str(self.df["date"].iloc[self.current_step]),
            "action": "Buy" if target_contracts > 0 else "Sell" if target_contracts < 0 else "Hold",
            "entry_price": fill_price,
            "position": self._position_ntd,
        })
        return trade_fee

    def _compute_reward(self, realized_pnl_pct: float, cost_pct: float) -> float:
        """Compute reward per SPEC §4.3."""
        if self.config.reward_mode == "pure_pnl":
            return realized_pnl_pct - cost_pct
        elif self.config.reward_mode == "sharpe":
            # Sharpe-like: daily_pnl / rolling_vol
            vol = abs(self.vol_5d[self.current_step]) + 0.1
            return (realized_pnl_pct - cost_pct) / vol
        elif self.config.reward_mode == "sharpe_like":
            window = int(self.config.reward_params.get("sharpe_window", 60))
            self._recent_returns.append(realized_pnl_pct - cost_pct)
            if len(self._recent_returns) < 30:
                return realized_pnl_pct - cost_pct
            arr = np.array(self._recent_returns, dtype=np.float64)
            mu = float(arr.mean())
            sigma = float(arr.std()) + 1e-6
            return mu / sigma
        elif self.config.reward_mode == "multi_objective":
            lam = self.config.reward_params.get("lambda_dd", 0.5)
            mu = self.config.reward_params.get("mu_trade", 0.001)
            return realized_pnl_pct - cost_pct * 100 - lam * abs(self.drawdown) * 100 - mu * 100
        elif self.config.reward_mode == "risk_adjusted":
            lam_dd = self.config.reward_params.get("lambda_dd", 0.5)
            lam_vol = self.config.reward_params.get("lambda_vol", 0.3)
            window = int(self.config.reward_params.get("sharpe_window", 60))
            self._recent_returns.append(realized_pnl_pct - cost_pct)
            if len(self._recent_returns) < 5:
                return realized_pnl_pct - cost_pct
            arr = np.array(list(self._recent_returns)[-window:], dtype=np.float64)
            vol = float(arr.std())
            return realized_pnl_pct - cost_pct - lam_dd * abs(self.drawdown) * 100 - lam_vol * vol
        elif self.config.reward_mode == "sparse_pnl":
            # sparse reward：只在「部位變化 / episode 結束」時結算
            # step() 與 _step_realistic() 會先用 _prev_realized_pnl_pct 紀錄累積值，
            # 此處回傳本次增量
            realized_delta = realized_pnl_pct - self._prev_realized_pnl_pct
            self._prev_realized_pnl_pct = realized_pnl_pct
            return realized_delta - cost_pct
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
        self._prev_unrealized_pct = 0.0
        self.peak_pnl_pct = 0.0
        self.drawdown = 0.0
        self.num_trades = 0
        self.trade_history = []
        self._reward_history = []
        self._recent_returns.clear()
        self._entry_bar_idx = -1
        self._prev_realized_pnl_pct = 0.0
        self.cash = float(self.config.initial_cash)
        self.margin_used = 0.0
        self.equity = float(self.config.initial_cash)
        self.cum_pnl_ntd = 0.0
        self._prev_equity = float(self.config.initial_cash)
        self._entry_price_ntd = 0.0
        self._position_ntd = 0
        return self._get_observation(), {}

    def step(self, action: int | np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]:
        if self.config.realistic_cash:
            return self._step_realistic(action)

        cost_pct = self._execute_action(action)
        self.days_held += 1

        next_step = self.current_step + 1
        new_unrealized_pct = 0.0
        if self.position != 0 and next_step < self.n_steps:
            next_price = float(self.df["close"].iloc[next_step])
            new_unrealized_pct = (next_price / self.entry_price - 1) * 100 * self.position
        else:
            next_price = None

        terminated = next_step >= self.n_steps
        if terminated and self.position != 0:
            last_price = float(self.df["close"].iloc[self.current_step])
            new_unrealized_pct = (last_price / self.entry_price - 1) * 100 * self.position
            self.position = 0.0
            self._entry_bar_idx = -1

        # 硬性風控底線（Hard Limits）：若違反則強制平倉並 truncated
        truncated = False
        forced_pnl = 0.0
        force_reason = ""
        if not terminated:  # episode 結束不再強制（會被 terminated=True 中斷）
            violated, force_reason = self._check_hard_limits()
            if violated:
                truncated = True
                forced_pnl = self._force_close(force_reason)

        realized_pnl_pct = new_unrealized_pct - self._prev_unrealized_pct
        if truncated:
            # 強制平倉產生 realized_pnl_pct 以走完追蹤；視為一次性實現
            realized_pnl_pct += forced_pnl
        self._prev_unrealized_pct = new_unrealized_pct

        self.cum_pnl_pct += realized_pnl_pct - cost_pct * 100
        self.peak_pnl_pct = max(self.peak_pnl_pct, self.cum_pnl_pct)
        self.drawdown = min(0.0, (self.cum_pnl_pct - self.peak_pnl_pct) / 100.0)

        # Risk control: max drawdown
        if abs(self.drawdown) >= self.config.max_drawdown:
            truncated = True

        if self.config.reward_mode == "sparse_pnl":
            # sparse reward：只有 episode 結束時結算總損益，中間步數一律=0
            if terminated or truncated:
                reward = self.cum_pnl_pct
            else:
                reward = 0.0
        else:
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

    def _check_hard_limits(self) -> tuple[bool, str]:
        """檢查硬性風控底線（Hard Limits）。違反時回傳 (True, 原因)。

        檢查條件：
        - hard_stop_loss_pct: 進場以來損益 ≤ 設定值（如 -3%）
        - hard_take_profit_pct: 進場以來損益 ≥ 設定值（如 +5%）
        - hard_max_hold_bars: 持有 K棒數 ≥ 設定值

        計算基準為「position × (close - entry)/entry」（百分比報酬）。
        必須在 _execute_action / _execute_action_realistic 已更新 self.position 與
        self.entry_price 之後才能正確計算。
        """
        if self.position == 0:
            return False, ""

        # 抽象模式用 pct，真實模式用 NTD 但比例計算一致
        if self.config.realistic_cash:
            if self._entry_price_ntd == 0:
                return False, ""
            current_price = float(self.df["close"].iloc[self.current_step])
            sign = 1 if self._position_ntd > 0 else -1
            ret_pct = (current_price / self._entry_price_ntd - 1) * 100 * sign
        else:
            if self.entry_price == 0:
                return False, ""
            current_price = float(self.df["close"].iloc[self.current_step])
            ret_pct = (current_price / self.entry_price - 1) * 100 * self.position

        sl = self.config.hard_stop_loss_pct * 100
        tp = self.config.hard_take_profit_pct * 100
        if sl < 0 and ret_pct <= sl:
            return True, f"hard_stop_loss ({ret_pct:.2f}% ≤ {sl:.2f}%)"
        if tp > 0 and ret_pct >= tp:
            return True, f"hard_take_profit ({ret_pct:.2f}% ≥ {tp:.2f}%)"
        if self.config.hard_max_hold_bars > 0 and self._entry_bar_idx >= 0:
            held = self.current_step - self._entry_bar_idx
            if held >= self.config.hard_max_hold_bars:
                return True, f"hard_max_hold ({held} bars ≥ {self.config.hard_max_hold_bars})"
        return False, ""

    def _force_close(self, reason: str) -> float:
        """硬性底線觸發：強制平倉（依當前 close 結算），回傳 realized PnL 百分比。

        同時更新 trade_history（標記 reason），並把 position/entry_price/_entry_bar_idx 重置。
        """
        if self.position == 0:
            return 0.0
        if self.config.realistic_cash:
            current_price = float(self.df["close"].iloc[self.current_step])
            sign = 1 if self._position_ntd > 0 else -1
            realized_pct = (current_price / self._entry_price_ntd - 1) * 100 * sign
            # 結算：現金流出/入並退回保證金
            contracts = abs(self._position_ntd)
            realized_ntd = (current_price - self._entry_price_ntd) * sign * contracts * self.config.contract_multiplier
            self.cash += realized_ntd
            self.cum_pnl_ntd += realized_ntd
            self.margin_used = 0.0
            self._position_ntd = 0
        else:
            current_price = float(self.df["close"].iloc[self.current_step])
            realized_pct = (current_price / self.entry_price - 1) * 100 * self.position
        self.position = 0.0
        self.entry_price = 0.0
        self._entry_bar_idx = -1
        self.trade_history.append({
            "step": self.current_step,
            "date": str(self.df["date"].iloc[self.current_step]),
            "action": reason,
            "entry_price": current_price,
            "position": 0.0,
        })
        return realized_pct

    def render(self):
        if self.current_step < self.n_steps:
            date = self.df["date"].iloc[min(self.current_step, self.n_steps - 1)]
            print(f"[{date}] pos={self.position:.2f} cum_pnl={self.cum_pnl_pct:.2f}% dd={self.drawdown*100:.1f}% trades={self.num_trades}")

    def _step_realistic(self, action: int | np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]:
        """金額制 step：每日結算 + 金額 reward + 維持保證金風控（realistic_cash）。"""
        self._execute_action(action)
        self.days_held += 1

        next_step = self.current_step + 1

        # 每日結算（mark-to-market）：以次一根 close 計算浮動損益
        if self._position_ntd != 0 and next_step < self.n_steps:
            next_price = float(self.df["close"].iloc[next_step])
            unrealized_ntd = (next_price - self._entry_price_ntd) * self._position_ntd * self.config.contract_multiplier
        else:
            next_price = None
            unrealized_ntd = 0.0

        self.equity = self.cash + unrealized_ntd
        self.cum_pnl_ntd = self.equity - self.config.initial_cash

        # reward = 權益變化（金額制）
        realized_ntd = self.equity - self._prev_equity
        self._prev_equity = self.equity

        # 損益追蹤（% 制，供 render/相容）
        pnl_ratio = realized_ntd / self.config.initial_cash * 100 if self.config.initial_cash > 0 else 0.0
        self.cum_pnl_pct = self.cum_pnl_ntd / self.config.initial_cash * 100 if self.config.initial_cash > 0 else 0.0
        self.peak_pnl_pct = max(self.peak_pnl_pct, self.cum_pnl_pct)
        self.drawdown = min(0.0, (self.cum_pnl_pct - self.peak_pnl_pct) / 100.0)

        terminated = next_step >= self.n_steps
        truncated = False

        # 硬性風控底線（Hard Limits）：若違反則強制平倉並 truncated
        if not terminated and self._position_ntd != 0:
            violated, force_reason = self._check_hard_limits()
            if violated:
                truncated = True
                self._force_close(force_reason)
                # _force_close 已處理資金/部位，這裡重新計算 equity
                unrealized_ntd = 0.0
                self.equity = self.cash
                self._prev_equity = self.equity

        # 維持保證金風控：權益 < 維持保證金 × 口數 → 強制平倉
        if self._position_ntd != 0:
            margin_required = abs(self._position_ntd) * self.config.maintenance_margin
            if self.equity < margin_required:
                truncated = True
                # 強制平倉（以 current close 結算）
                close_price = float(self.df["close"].iloc[self.current_step])
                forced_pnl = (close_price - self._entry_price_ntd) * self._position_ntd * self.config.contract_multiplier
                self.cash += forced_pnl
                self.cum_pnl_ntd += forced_pnl
                self.margin_used = 0.0
                self._position_ntd = 0
                self.position = 0.0
                self._entry_price_ntd = 0.0
                self.equity = self.cash
                self._prev_equity = self.equity

        # 最大回撤 / 最大日損（金額制）
        if abs(self.drawdown) >= self.config.max_drawdown:
            truncated = True
        if self.config.initial_cash > 0 and realized_ntd <= -self.config.max_daily_loss * self.config.initial_cash:
            truncated = True

        if self.config.reward_mode == "sparse_pnl":
            if terminated or truncated:
                reward = self.cum_pnl_ntd
            else:
                reward = 0.0
        else:
            reward = realized_ntd if self.config.reward_mode == "pure_pnl" else self._compute_reward(realized_ntd, 0.0)
        self._reward_history.append(float(reward))

        info = {
            "pnl_ntd": realized_ntd,
            "cum_pnl_ntd": self.cum_pnl_ntd,
            "equity": self.equity,
            "cash": self.cash,
            "position": float(self._position_ntd),
            "contracts": self._position_ntd,
            "drawdown": self.drawdown,
            "num_trades": self.num_trades,
            "days_held": self.days_held,
        }

        self.current_step = next_step
        return self._get_observation() if not terminated else np.zeros(self.state_dim, dtype=np.float32), float(reward), terminated, truncated, info
