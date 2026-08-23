"""Contract tests for TXTradingEnv per SPEC TX-0010 test plan TC-01~09.

Pure environment tests — no ArangoDB / Celery / API dependencies.
Validates the Gymnasium contract: observation/action spaces, step interface,
execution rules (next-day open, slippage), risk controls (max DD).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from gymnasium.utils.env_checker import check_env

from src.tasks.tx_rl_env import TXEnvConfig, TXTradingEnv


def _make_twii_df(n: int = 200) -> pd.DataFrame:
    """Generate deterministic TWII-like data for env testing."""
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    np.random.seed(42)
    close = 20000 + np.cumsum(np.random.randn(n) * 50)
    open_ = close + np.random.randn(n) * 20
    high = np.maximum(close, open_) + np.abs(np.random.randn(n) * 30)
    low = np.minimum(close, open_) - np.abs(np.random.randn(n) * 30)
    volume = np.random.randint(1_000_000, 10_000_000, n)
    return pd.DataFrame({
        "date": dates.strftime("%Y-%m-%d"),
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


@pytest.fixture
def twii_df():
    return _make_twii_df(200)


@pytest.fixture
def default_config():
    return TXEnvConfig(
        action_mode="discrete_3",
        reward_mode="pure_pnl",
        state_features={"price": True, "tech": True, "vol": True, "position": True, "calendar": False},
    )


@pytest.fixture
def env(twii_df, default_config):
    return TXTradingEnv(twii_df, default_config)


# TC-01: 環境符合 gymnasium 標準
def test_TC01_env_passes_gymnasium_checker(env):
    """check_env must not raise — validates observation_space, action_space, reset/step interfaces."""
    check_env(env.unwrapped, warn=True)


# TC-02: 觀察空間形狀
def test_TC02_observation_shape(env):
    obs, _ = env.reset(seed=42)
    assert obs.shape == (env.config.get_state_dim(),), (
        f"expected ({env.config.get_state_dim()},), got {obs.shape}"
    )
    assert obs.dtype == np.float32


def test_TC02b_state_dim_configurable(twii_df):
    """State dim changes with feature toggles."""
    cfg_min = TXEnvConfig(state_features={"price": True, "tech": False, "vol": False, "position": False, "calendar": False})
    cfg_max = TXEnvConfig(state_features={"price": True, "tech": True, "vol": True, "position": True, "calendar": True})
    e_min = TXTradingEnv(twii_df, cfg_min)
    e_max = TXTradingEnv(twii_df, cfg_max)
    assert e_min.config.get_state_dim() == 5  # only price
    assert e_max.config.get_state_dim() == 18  # all (5+3+3+5+2)


# TC-03: 三種 action space
@pytest.mark.parametrize("action_mode,expected_type", [
    ("discrete_3", "Discrete"),
    ("discrete_5", "Discrete"),
    ("continuous", "Box"),
])
def test_TC03_action_space_modes(twii_df, action_mode, expected_type):
    cfg = TXEnvConfig(action_mode=action_mode)
    e = TXTradingEnv(twii_df, cfg)
    assert type(e.action_space).__name__ == expected_type
    if action_mode == "discrete_3":
        assert e.action_space.n == 3
    elif action_mode == "discrete_5":
        assert e.action_space.n == 5
    elif action_mode == "continuous":
        assert e.action_space.shape == (1,)


# TC-04: 三種 reward 模式
def test_TC04a_pure_pnl_reward(env):
    obs, _ = env.reset(seed=42)
    _, r1, _, _, info = env.step(1)  # Hold
    assert isinstance(r1, float)
    assert abs(r1) < 1.0  # Daily PnL % should be small


def test_TC04b_sharpe_reward(twii_df):
    cfg = TXEnvConfig(reward_mode="sharpe")
    e = TXTradingEnv(twii_df, cfg)
    e.reset(seed=42)
    _, r, _, _, _ = e.step(1)
    # Sharpe-like rewards are bounded
    assert isinstance(r, float)


def test_TC04c_multi_objective_reward(twii_df):
    cfg = TXEnvConfig(reward_mode="multi_objective", reward_params={"lambda_dd": 0.5, "mu_trade": 0.001})
    e = TXTradingEnv(twii_df, cfg)
    e.reset(seed=42)
    # Trigger a trade
    e.step(2)  # Buy
    _, r, _, _, _ = e.step(1)  # Hold
    assert isinstance(r, float)


# TC-05: Step 介面回傳
def test_TC05_step_interface(env):
    obs, _ = env.reset(seed=42)
    obs, reward, terminated, truncated, info = env.step(1)
    assert isinstance(obs, np.ndarray)
    assert isinstance(reward, float)
    assert isinstance(terminated, bool)
    assert isinstance(truncated, bool)
    assert isinstance(info, dict)
    for k in ("pnl_pct", "cum_pnl_pct", "position", "drawdown", "num_trades"):
        assert k in info, f"missing info key: {k}"


# TC-06: Episode 終止
def test_TC06_episode_terminates_at_end(twii_df):
    cfg = TXEnvConfig()
    e = TXTradingEnv(twii_df.iloc[:20].copy(), cfg)  # 20 天
    e.reset(seed=42)
    terminated = False
    for _ in range(50):  # 超過 20 步
        _, _, terminated, _, _ = e.step(1)
        if terminated:
            break
    assert terminated, "Episode should terminate at data end"


# TC-07: 持倉狀態追蹤
def test_TC07_position_state_tracking(env):
    obs, _ = env.reset(seed=42)
    # Buy
    obs, _, _, _, info = env.step(2)  # action=2 → Buy (discrete_3)
    assert info["position"] == 1.0
    # Hold
    obs, _, _, _, info = env.step(1)  # Hold
    assert info["position"] == 1.0
    # Sell
    obs, _, _, _, info = env.step(0)  # Sell
    assert info["position"] == -1.0


# TC-08: 隔日開盤進場（不能作弊用 close[t]）
def test_TC08_entry_price_uses_next_day_open():
    """Verify entry price comes from open[t+1], not close[t].

    Uses custom data with a large gap (open[0]=close[0]=100, open[1]=200) so
    the three candidate prices are unambiguously distinguishable.
    """
    df = pd.DataFrame({
        "date": ["2024-01-01", "2024-01-02", "2024-01-03"] + [f"2024-01-{i:02d}" for i in range(4, 11)],
        "open":  [100.0, 200.0, 300.0] + [100.0] * 7,
        "high":  [100.0, 200.0, 300.0] + [100.0] * 7,
        "low":   [100.0, 200.0, 300.0] + [100.0] * 7,
        "close": [100.0, 200.0, 300.0] + [100.0] * 7,
        "volume": [1_000_000] * 10,
    })
    env = TXTradingEnv(df, TXEnvConfig())
    env.reset(seed=42)
    env.step(2)  # Buy at day 0
    assert env.entry_price == 200.0, f"expected open[1]=200, got {env.entry_price}"
    assert env.entry_price != 100.0


# TC-09: Max drawdown 觸發截斷
def test_TC09_max_drawdown_truncates(twii_df):
    # Use a sharply declining market to trigger DD
    df = _make_twii_df(100)
    df["close"] = np.linspace(20000, 14000, 100)  # 30% drop
    df["open"] = df["close"] + 100
    df["high"] = df["close"] + 200
    df["low"] = df["close"] - 200
    cfg = TXEnvConfig(max_drawdown=0.20, action_mode="discrete_3")
    e = TXTradingEnv(df, cfg)
    e.reset(seed=42)
    truncated = False
    for i in range(99):
        e.step(2)  # Always buy
        _, _, _, truncated, info = e.step(1)
        if truncated:
            break
    assert truncated, "Episode should truncate when DD exceeds max_drawdown"
