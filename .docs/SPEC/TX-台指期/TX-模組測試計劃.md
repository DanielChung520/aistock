# TX-模組測試計劃 — 台指期日K RL 訓練功能

> @file        TX-模組測試計劃
> @description 台指期（TX）日K RL 訓練的 8 節測試計劃。從環境契約、API、訓練可重現、執行成本、walk-forward、baseline 對照到 UI 整合 — 完整 pass-to-accept 驗收。
> @lastUpdate  2026-08-23
> @author      Sisyphus
> @version     0.1.0

**版本：0.1** ｜ 狀態：草稿 ｜ 對應模組：TX-台指期 ｜ 對應主規格：TX-0010-rl-trading-spec.md

**測試策略**：以**自動化測試取代人工 code review**——RL 訓練完成後，只要通過本測試計劃定義的測試集，即視為可接受（pass-to-accept）。

**方法論**：`/測試` skill（架構先行、邊界來自常數、回歸看 blast radius）——先驗環境契約、再驗訓練可重現、最後驗 walk-forward 與 baseline 對照。

---

## 1. 測試目標（Test Objectives）

驗證 6 件事：

1. **環境契約正確**：Gymnasium Env 符合標準介面，狀態/動作/獎勵形狀正確
2. **訓練可重現**：同一 config + seed 跑 2 次，結果在 ±5% 內
3. **執行成本真實**：backtest 含 0.3% × 2 滑價、隔日開盤進場（不能作弊）
4. **Walk-forward 有效**：time-series split 真的做了，不能用 random split
5. **Baseline 對照存在**：永遠對照 Buy & Hold 0050、MA5/MA20 crossover
6. **UI 誠實**：所有頁面顯示「學 RL 不是賺錢」警告

---

## 2. 架構錨點（Architecture Anchors）

### 2.1 功能 → 核心符號/檔案

| 功能 | 核心符號 | 檔案 |
|---|---|---|
| Gymnasium 環境 | `TXTradingEnv` | `backend/src/tasks/tx_rl_env.py` |
| 訓練任務 | `train_tx_rl_agent_task` | `backend/src/tasks/tx_rl_training.py` |
| Backtest | `run_tx_rl_backtest` | `backend/src/tasks/tx_rl_backtest.py` |
| API router | `router` | `backend/src/routers/tx_rl.py` |
| 環境定義頁 | `<EnvironmentForm>` | `frontend/src/app/tx-rl/page.tsx` |
| 訓練監控頁 | `<TrainingMonitor>` | `frontend/src/app/tx-rl/training/page.tsx` |
| 回測結果頁 | `<BacktestResults>` | `frontend/src/app/tx-rl/backtest/page.tsx` |
| 評估對照頁 | `<EvaluationCompare>` | `frontend/src/app/tx-rl/evaluation/page.tsx` |
| Sidebar 入口 | sidebar-nav | `frontend/src/components/sidebar-nav.tsx` |

### 2.2 跨功能呼叫鏈

```
User → Sidebar → EnvironmentForm 
  → POST /api/tx-rl/train (config)
  → FastAPI router → Celery task: train_tx_rl_agent_task
  → TXTradingEnv (gym) → stable_baselines3 (PPO/A2C/DQN)
  → save model + metrics → ArangoDB tx_rl_models
  → Frontend polls /api/tx-rl/jobs/{id}
  → TrainingMonitor shows progress
  → BacktestResults fetches /api/tx-rl/jobs/{id}/result
  → EvaluationCompare fetches /api/tx-rl/compare
```

### 2.3 邊界常數（來自主規格，測試邊界來源）

| 常數 | 值 | 出處 |
|---|---|---|
| TX 1 點 = 200 元 | 200 | 台指期合約規格（主規格 §1.1） |
| 滑價 0.3% × 2 | 0.006 | 主規格 §6.1 |
| 手續費 0.15% × 2 | 0.003 | 主規格 §6.1 |
| 隔日開盤進場 | open[t+1] | 主規格 §6.1 |
| Random seed 重現容忍 | ±5% | 主規格 §7.2 |
| 訓練超時 | 30 min | 主規格 §7.2 |
| Max position | ±1.0 | 主規格 §7.1 |
| Max DD 觸發 | -30% | 主規格 §7.1 |
| Max daily loss 觸發 | -5% | 主規格 §7.1 |

---

## 3. 框架與測試具（Framework & Test Tools）

### 3.1 Backend 測試框架

| 項目 | 工具 | 用途 |
|---|---|---|
| 測試框架 | pytest 8.x | 單元測試 + 整合測試 |
| Gymnasium 驗證 | `gymnasium.utils.env_checker.check_env` | 環境契約合規 |
| 數值斷言 | pytest.approx | 浮點數比較 |
| Mock | pytest-mock | 替換 stable-baselines3 隨機性 |
| Coverage | pytest-cov | ≥ 80% |

### 3.2 Frontend 測試框架

| 項目 | 工具 | 用途 |
|---|---|---|
| 元件測試 | Vitest + @testing-library/react | 表單互動 |
| E2E | Playwright | 完整流程 |
| 型別檢查 | `pnpm ts-check` | 0 errors |
| Lint | `pnpm lint` | 0 errors |

### 3.3 測試具（Fixtures）

```python
# backend/tests/conftest.py

@pytest.fixture
def twii_sample_df():
    """200 天 TWII 模擬資料（含 OHLCV）."""
    dates = pd.date_range("2024-01-01", periods=200, freq="B")
    np.random.seed(42)
    close = 20000 + np.cumsum(np.random.randn(200) * 50)
    return pd.DataFrame({
        "date": dates,
        "open": close + np.random.randn(200) * 20,
        "high": close + np.abs(np.random.randn(200) * 50),
        "low": close - np.abs(np.random.randn(200) * 50),
        "close": close,
        "volume": np.random.randint(1000, 10000, 200),
    })

@pytest.fixture
def tx_env_config():
    """預設 env config（Pure PnL reward, 3 actions）."""
    return TXEnvConfig(
        action_mode="discrete_3",
        reward_mode="pure_pnl",
        fees={"slippage_pct": 0.3, "commission_pct": 0.15},
        max_position=1.0,
        max_drawdown=0.30,
    )

@pytest.fixture
def tx_env(twii_sample_df, tx_env_config):
    return TXTradingEnv(twii_sample_df, tx_env_config)

@pytest.fixture
def trained_ppo_model(tx_env):
    """快速訓練的 PPO（1000 steps）."""
    model = PPO("MlpPolicy", tx_env, n_steps=64, batch_size=16, verbose=0, seed=42)
    model.learn(total_timesteps=1000)
    return model
```

---

## 4. 測試案例（依規格附錄 A/B + 功能點）

### 4.1 Gymnasium 環境契約（`test_tx_rl_env.py`）

#### TC-01: 環境基本介面
```
對應 FR-01（環境定義）/ spec §4.5
前置：無
操作：
  - import gymnasium as gym
  - env = TXTradingEnv(df, config)
  - check_env(env)
預期：env_checker 不報錯
守衛類型：契約
```

#### TC-02: 觀察空間形狀
```
對應 FR-02（state features）
前置：env 已建立
操作：obs, info = env.reset()
預期：
  - obs.shape == (n_features,)（n_features 依 state_features config）
  - obs.dtype == np.float32
  - 預設 config → 12 維
守衛類型：契約
```

#### TC-03: 動作空間三種模式
```
對應 FR-03（action mode 可調）
前置：三個 env 各用一種 action_mode
操作：
  - discrete_3: env.action_space == Discrete(3)
  - discrete_5: env.action_space == Discrete(5)
  - continuous: env.action_space == Box(low=-1, high=1, shape=(1,))
預期：以上 assert 通過
守衛類型：契約
```

#### TC-04: Reward 三種模式
```
對應 FR-04（reward mode 可調）
前置：三個 env 各用一種 reward_mode
操作：
  - pure_pnl: step 後 reward 範圍 ≈ [-0.05, +0.05]
  - sharpe: reward 波動較小（被 vol 標準化）
  - multi_objective: reward 受 num_trades 影響（多交易 → 懲罰）
預期：3 種 reward 計算方式差異顯著
守衛類型：契約
```

#### TC-05: Step 介面回傳
```
對應 FR-05（gymnasium standard）
前置：env 已建立
操作：obs, reward, terminated, truncated, info = env.step(action)
預期：
  - obs: np.ndarray
  - reward: float
  - terminated: bool
  - truncated: bool
  - info: dict 含 pnl, position, drawdown, trade_count
守衛類型：契約
```

#### TC-06: Episode 終止
```
對應 FR-06（episode 結束）
前置：env 在 episode 最後一天
操作：連續 step 直到 terminated
預期：terminated == True（到資料末端）
守衛類型：邊界
```

#### TC-07: 持倉狀態追蹤
```
對應 FR-07（position state）
前置：env.reset()
操作：
  - step(action=2) → 持倉 = +1
  - step(action=2) → 持倉 = +1（保持）
  - step(action=0) → 持倉 = -1（翻空）
  - info['position'] 應該對應實際持倉
預期：持倉狀態正確
守衛類型：狀態
```

#### TC-08: 隔日開盤進場（Execution 規則）
```
對應 FR-08（執行成本）
前置：env 已建立，day=t
操作：buy 訊號在 day=t
預期：
  - 進場價 = open[t+1]（不是 close[t]）
  - 進場時扣除 0.3% slippage
守衛類型：邊界（防止作弊）
```

#### TC-09: Max Drawdown 觸發
```
對應 FR-09（風控）
前置：env 已建立
操作：模擬連續下跌，導致 cumulative_pnl < -30%
預期：terminated == True（提前結束）
守衛類型：風控
```

### 4.2 訓練可重現性（`test_tx_rl_training.py`）

#### TC-10: 同 seed 同結果
```
對應 FR-10（reproducibility）
前置：相同 config + seed=42
操作：
  - 跑訓練 A → 存 metrics_A
  - 跑訓練 B → 存 metrics_B
預期：
  - abs(metrics_A.test.sharpe - metrics_B.test.sharpe) < 0.05
  - abs(metrics_A.test.cumulative_return - metrics_B.test.cumulative_return) < 0.05
守衛類型：可重現
```

#### TC-11: 不同 seed 不同結果（但量級相近）
```
對應 FR-11（seed 影響）
前置：相同 config，seed=42 vs seed=123
操作：跑兩次訓練
預期：
  - 結果不同（不是完全相同）
  - 但都在合理範圍（如 sharpe ∈ [-0.5, 2.0]）
守衛類型：穩健性
```

#### TC-12: 訓練超時保護
```
對應 FR-12（training time cap）
前置：total_timesteps = 999999999
操作：啟動訓練
預期：30 分鐘後自動停止（不會無限跑）
守衛類型：風控
```

#### TC-13: Early Stopping
```
對應 FR-13（early stopping）
前置：故意讓 val reward 不再改善
操作：跑訓練
預期：val reward 連續 10 個 episode 沒改善 → 停止
守衛類型：效率
```

### 4.3 Backtest 真實性（`test_tx_rl_backtest.py`）

#### TC-14: 含滑價
```
對應 FR-14（execution cost）
前置：訓練好的 model
操作：跑 backtest
預期：
  - 每次進場後 reward 已被扣 0.3% × 2
  - 累積 PnL 比「無滑價」版本低
守衛類型：邊界
```

#### TC-15: 隔日開盤（非當日收盤）
```
對應 FR-15（execution timing）
前置：模擬訊號在 t 日收盤後
操作：backtest
預期：實際進場 = open[t+1]（不是 close[t]）
驗證：從 env 內部 log 確認 entry_price
守衛類型：邊界（防止偷用 close[t]）
```

#### TC-16: 連續持倉處理
```
對應 FR-16（position persistence）
前置：t=1 buy, t=2 hold
操作：env.step(hold) → env.step(hold)
預期：持倉保持 +1（沒有重複扣手續費）
守衛類型：狀態
```

### 4.4 Walk-Forward 驗證（`test_tx_rl_walkforward.py`）

#### TC-17: Walk-Forward 至少 3 段
```
對應 FR-17（walk-forward mandatory）
前置：啟用 walk_forward
操作：跑完整訓練
預期：result.walk_forward_results.length >= 3
守衛類型：流程
```

#### TC-18: 每段都有 OOS 指標
```
對應 FR-18（per-window metrics）
前置：walk-forward 結果
操作：檢查每段都有 sharpe, return, mdd
預期：每段都有完整指標
守衛類型：完整性
```

#### TC-19: Time-series split（不隨機）
```
對應 FR-19（temporal split）
前置：嘗試用 random split
操作：故意送 config {"shuffle": true}（不支援）
預期：拒絕或警告（不允許 random split）
守衛類型：邊界
```

### 4.5 Baseline 對照（`test_tx_rl_baseline.py`）

#### TC-20: Buy & Hold 0050 永遠存在
```
對應 FR-20（mandatory baseline）
前置：跑任何一次訓練
操作：fetch result.baseline_comparison
預期：buy_hold_0050 永遠有資料
守衛類型：完整性
```

#### TC-21: MA5/MA20 crossover baseline
```
對應 FR-21（mandatory baseline）
前置：同上
操作：fetch result.baseline_comparison
預期：ma_crossover 永遠有資料
守衛類型：完整性
```

#### TC-22: RL 打不贏 Buy & Hold 不算成功（但也不算失敗）
```
對應 FR-22（realistic expectations）
前置：RL 結果 < Buy & Hold
操作：UI 顯示
預期：
  - 顯示對照表
  - 顯示「學 RL 是過程」訊息
  - 不算測試失敗（這是預期結果）
守衛類型：UX
```

### 4.6 API 端點（`test_api_tx_rl.py`）

#### TC-23: POST /api/tx-rl/train 回傳 job_id
```
對應 FR-23
前置：合法 config
操作：POST /api/tx-rl/train
預期：response 200, {job_id, status: "running"}
守衛類型：API
```

#### TC-24: GET /api/tx-rl/jobs/{id} 顯示進度
```
對應 FR-24
前置：已啟動訓練
操作：GET /api/tx-rl/jobs/{id}
預期：response 200, {status, progress: {current_step, total_steps, current_reward}}
守衛類型：API
```

#### TC-25: GET /api/tx-rl/jobs/{id}/result 含完整指標
```
對應 FR-25
前置：訓練完成
操作：GET /api/tx-rl/jobs/{id}/result
預期：response 200, {metrics, walk_forward_results, baseline_comparison}
守衛類型：API
```

#### TC-26: POST /api/tx-rl/compare 回傳 4 個策略
```
對應 FR-26
前置：已有結果
操作：POST /api/tx-rl/compare
預期：response 200, {buy_hold_0050, buy_hold_twii, ma_crossover, tx_rl_agent}
守衛類型：API
```

#### TC-27: 無效 config 回 422
```
對應 FR-27
前置：送 bad config
操作：POST /api/tx-rl/train with {"action_mode": "invalid"}
預期：response 422
守衛類型：API 錯誤處理
```

### 4.7 前端整合（`test_frontend_tx_rl.tsx`）

#### TC-28: Sidebar 顯示「台指期 RL」入口
```
對應 FR-28
前置：登入頁面
操作：render sidebar
預期：「台指期 RL」連結存在
守衛類型：UI
```

#### TC-29: 環境定義頁可選 3 種 action space
```
對應 FR-29
前置：進到 /tx-rl
操作：點擊 action space 選項
預期：3 個 radio 可選
守衛類型：UI
```

#### TC-30: 警告文字「學 RL 不是賺錢」在所有頁面顯示
```
對應 FR-30
前置：任何頁面
操作：render
預期：「⚠️ 學 RL 不是賺錢」warning 存在
守衛類型：UX 誠實
```

#### TC-31: 評估頁顯示 4 策略對照表
```
對應 FR-31
前置：訓練完成
操作：進到 /tx-rl/evaluation
預期：4 策略對照表（Buy & Hold 0050/TWII/MA/TX-RL）
守衛類型：UI
```

---

## 5. 回歸測試（Regression）

### 5.1 跨模組回歸

| 測試 | 預期 |
|---|---|
| ai-training 仍可正常訓練 | 不被新 env 影響 |
| Sidebar 其他項目仍可點 | 不被新項目影響 |
| Backend startup 不報錯 | 沒有 import cycle |

### 5.2 資料回歸

| 測試 | 預期 |
|---|---|
| TWII 資料（stock_daily 495 筆）仍存在 | v0.1 已注入 |
| ArangoDB tx_rl_models collection 可正常寫入 | 新 collection |

### 5.3 性能回歸

| 測試 | 預期 | 量測方式 |
|---|---|---|
| 訓練 50000 steps 完成時間 | < 10 min | timer |
| Backtest 完成時間 | < 30s | timer |
| API 端點回應時間 | < 2s（不含訓練） | timer |

---

## 6. 測試具範例（Test Tool Examples）

### 6.1 Backend 環境契約測試範例

```python
# tests/test_tx_rl_env.py
import gymnasium as gym
import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

from src.tasks.tx_rl_env import TXTradingEnv, TXEnvConfig


def test_env_passes_gymnasium_checker(twii_sample_df, tx_env_config):
    """TC-01: 環境符合 gymnasium 標準."""
    env = TXTradingEnv(twii_sample_df, tx_env_config)
    check_env(env, warn=True)  # 不報錯即通過


def test_observation_shape(twii_sample_df, tx_env_config):
    """TC-02: 觀察空間形狀正確."""
    env = TXTradingEnv(twii_sample_df, tx_env_config)
    obs, info = env.reset()
    assert obs.shape == (12,), f"expected 12 features, got {obs.shape}"
    assert obs.dtype == np.float32


@pytest.mark.parametrize("action_mode,expected", [
    ("discrete_3", gym.spaces.Discrete(3)),
    ("discrete_5", gym.spaces.Discrete(5)),
    ("continuous", gym.spaces.Box(low=-1, high=1, shape=(1,))),
])
def test_action_space_modes(twii_sample_df, tx_env_config, action_mode, expected):
    """TC-03: 三種 action space 模式."""
    tx_env_config.action_mode = action_mode
    env = TXTradingEnv(twii_sample_df, tx_env_config)
    assert env.action_space == expected


def test_entry_price_uses_next_open(twii_sample_df, tx_env_config):
    """TC-08/15: 隔日開盤進場（不能作弊用 close[t]）."""
    env = TXTradingEnv(twii_sample_df, tx_env_config)
    obs, _ = env.reset(seed=42)
    
    # 記錄 day=t 的 close
    close_t = twii_sample_df.iloc[env.current_step]["close"]
    
    # 執行 buy 訊號
    obs, reward, terminated, truncated, info = env.step(2)  # 2=Buy
    
    # 進場價應該 = open[t+1]，不是 close[t]
    expected_entry = twii_sample_df.iloc[env.current_step]["open"]
    assert env.entry_price == pytest.approx(expected_entry, rel=0.01)
    assert env.entry_price != pytest.approx(close_t, rel=0.01), "不能用 close[t] 進場！"
```

### 6.2 訓練可重現性測試範例

```python
# tests/test_tx_rl_training.py
import pytest
from stable_baselines3 import PPO

from src.tasks.tx_rl_env import TXTradingEnv
from src.tasks.tx_rl_training import train_tx_rl_agent


def test_same_seed_same_result(twii_sample_df, tx_env_config):
    """TC-10: 同 seed 跑 2 次，結果在 ±5% 內."""
    config = {
        "algorithm": "ppo",
        "total_timesteps": 2000,
        "learning_rate": 3e-4,
        "seed": 42,
        "n_steps": 64,
        "batch_size": 16,
    }
    
    # 第一次訓練
    env1 = TXTradingEnv(twii_sample_df.copy(), tx_env_config)
    model1 = train_tx_rl_agent(env1, config)
    metrics1 = run_quick_backtest(model1, env1)
    
    # 第二次訓練
    env2 = TXTradingEnv(twii_sample_df.copy(), tx_env_config)
    model2 = train_tx_rl_agent(env2, config)
    metrics2 = run_quick_backtest(model2, env2)
    
    # 允許 ±5% 容忍
    assert abs(metrics1["sharpe"] - metrics2["sharpe"]) < 0.05
    assert abs(metrics1["cumulative_return"] - metrics2["cumulative_return"]) < 0.05
```

### 6.3 Frontend 警告文字測試範例

```tsx
// tests/frontend/tx-rl-warning.test.tsx
import { render, screen } from '@testing-library/react'
import EnvironmentForm from '@/app/tx-rl/page'

describe('TX-RL 頁面警告', () => {
  it('環境定義頁顯示「學 RL 不是賺錢」', () => {
    render(<EnvironmentForm />)
    expect(screen.getByText(/學 RL.*不是賺錢/)).toBeInTheDocument()
  })
  
  it('訓練頁顯示「學 RL 不是賺錢」', () => {
    render(<TrainingMonitor />)
    expect(screen.getByText(/學 RL.*不是賺錢/)).toBeInTheDocument()
  })
  
  it('回測頁顯示「學 RL 不是賺錢」', () => {
    render(<BacktestResults />)
    expect(screen.getByText(/學 RL.*不是賺錢/)).toBeInTheDocument()
  })
  
  it('評估頁顯示「學 RL 不是賺錢」', () => {
    render(<EvaluationCompare />)
    expect(screen.getByText(/學 RL.*不是賺錢/)).toBeInTheDocument()
  })
})
```

---

## 7. 覆蓋盲點（Coverage Gaps）

明確說明**不在 v0.1 測試範圍**的項目，避免誤導：

### 7.1 不測的項目

| 項目 | 為什麼不測 |
|---|---|
| 實單下單 | v0.1 是 paper trading，無實單功能 |
| Intraday 數據 | 主規格 §2.2 不包含 |
| 跨商品對沖 | 主規格 §2.2 不包含 |
| Online learning | 主規格 §2.2 不包含 |
| 多 agent ensemble | v0.2+ 才考慮 |
| 不同市場（SPY、Nasdaq）| aistock 是台股系統 |

### 7.2 已知但暫時不修的限制

| 限制 | 影響 | 規劃 |
|---|---|---|
| 5 features 太少（TWII 缺個股欄位） | RL 學不到太多 pattern | v0.2 加 cross-sectional 特徵（上漲家數等） |
| 訓練資料只有 495 天 | 樣本少、易過擬合 | v0.2 接 FinMind 拉期貨歷史 |
| 沒做 multi-seed averaging | 單一結果可能不穩 | v0.2 加 5-seed 比較 |
| 沒做 transaction cost sensitivity | 不知道 cost 多大會擊垮 | v0.2 加 cost sweep |

### 7.3 故意保留的失敗案例

- **RL 訓練失敗（reward 不收斂）** → 視為「正常的學習結果」，不視為 bug
- **RL 打不贏 Buy & Hold** → 視為「符合學術實證」，不算測試失敗
- **Walk-forward OOS 很差** → 視為「正常 overfitting 警示」，UI 顯示給使用者

---

## 8. 通過定義（Definition of Done）

### 8.1 測試通過條件

| 類別 | 條件 |
|---|---|
| 單元測試 | 31 個 TC 全部通過（pytest exit 0） |
| Coverage | backend `src/tasks/tx_rl_*.py` ≥ 80% |
| 型別檢查 | `pnpm ts-check` 0 errors |
| Lint | `pnpm lint` 0 errors（tx-rl 範圍） |
| 整合測試 | E2E 流程：環境定義 → 訓練 → 回測 → 評估 |
| 警告文字 | 4 個頁面都有「學 RL 不是賺錢」 |

### 8.2 部署條件

- [ ] 8 個 Backend API 端點都有 contract test
- [ ] Gymnasium Env 通過 `env_checker`
- [ ] 訓練流程 30 分鐘內可完成 50000 steps
- [ ] ArangoDB 新 collection 自動建立
- [ ] Sidebar 入口可見
- [ ] 4 個子頁面都能開啟
- [ ] 至少 1 個示範訓練結果可查

### 8.3 已知誠實聲明

本測試計劃**不**保證以下事項：
- ❌ RL agent 會打贏 Buy & Hold 0050
- ❌ 學完這個能賺錢
- ❌ 訓練結果在實單會一致

**預期結果**（基於前次 ML 分析）：
- 50% 機率：RL OOS 勝率 < 55%（< 隨機 + 5%）
- 30% 機率：RL OOS 勝率 55-60%（微超隨機）
- 20% 機率：RL OOS 勝率 > 60%（有點意思，但 MDD 風險）

**「通過」= 流程可重現、誠實對照、學到 RL，不是「賺到錢」。**

---

## 9. 版本記錄

| 日期 | 版本 | 更新者 | 變更內容 |
|------|------|--------|----------|
| 2026-08-23 | 0.1.0 | Sisyphus | 初版測試計劃（基於 ML 分析經驗） |
