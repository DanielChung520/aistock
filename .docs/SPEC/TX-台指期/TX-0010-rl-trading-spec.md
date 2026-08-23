# TX-0010 — 台指期日K RL 訓練功能規格

> @file        TX-0010-rl-trading-spec
> @description 台指期（TX）日K資料的 Reinforcement Learning 訓練獨立功能規格。從零學 RL 的實務練習，整合進 aistock sidebar。
> @lastUpdate  2026-08-23
> @author      Sisyphus
> @version     0.1.0

**狀態：草稿** ｜ 對應模組：TX-台指期 ｜ 基準規格：見下方各節

**預期目標**：以自動化測試取代人工 code review（pass-to-accept）——RL agent 訓練完成後，只要通過本規格定義的驗收測試集，即視為可接受。

**方法論**：`/測試` skill（架構先行、邊界來自常數、回歸看 blast radius）——先定義 RL 環境契約，再訓練，最後用 walk-forward 驗證。

---

## 0. 設計前提（為什麼這樣設計）

來自前次 ML/DL 分析的 6 個關鍵教訓，直接驅動本 SPEC 設計：

| 教訓 | 對本 SPEC 的影響 |
|---|---|
| **Execution gap 殺光 alpha** | backtest 強制含 0.3% × 2 滑價、隔日開盤進場 |
| **Walk-forward 才能信** | 評估一定要做 time-series split，不能只用 train/test |
| **簡單規則有時贏複雜 ML** | 預設 benchmark = MA5/MA20 crossover，RL 必須打贏才算數 |
| **MDD 比報酬重要** | reward 設計納入 MDD 懲罰項 |
| **5 features 不夠** | state 必須含跨市場/廣度特徵 |
| **Buy & Hold 0050 是硬底** | 終極 benchmark = Buy & Hold 0050 |

---

## 1. 目標（Goals）

### 1.1 主要目標
1. **學習 RL**：透過實際訓練台指期 agent，內化 state / action / reward / policy 概念
2. **誠實驗證**：用 walk-forward 與 Buy & Hold 0050 對照，量化 RL 真實勝率
3. **可重現**：每次訓練記錄 seed / hyperparameters / data snapshot，確保結果可重現
4. **可調參**：action space 與 reward function 在 UI 可調（不是寫死），鼓勵實驗

### 1.2 非目標（Out of Scope）
- ❌ 實單下單（paper trading only）
- ❌ 個股 RL（只做台指期）
- ❌ 日內高頻（只用日K）
- ❌ 多商品組合（單一商品 = TX）
- ❌ 賺錢承諾（學 RL，不是學穩賺）

---

## 2. 範圍（Scope）

### 2.1 包含
- TX 日K RL 訓練 + 評估的完整 pipeline
- Sidebar 獨立入口（4 個子頁面）
- 可調參：action space (3 種)、reward function (3 種)、algorithm (PPO/A2C/DQN)
- Backtest 含真實 execution cost
- 與 Buy & Hold 0050/TWII 對照
- 結果持久化（ArangoDB `tx_rl_models` collection）

### 2.2 不包含（v0.1）
- 跨商品對沖（TX + 0050 組合）
- Intraday K 線（分鐘級）
- 自動 re-train scheduler
- 多 agent ensemble
- Online learning（持續更新）

---

## 3. 架構（Architecture）

### 3.1 系統組件

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (Next.js :33300)                                     │
│  ├─ Sidebar: 「台指期 RL」新入口                                │
│  └─ 4 個子頁面:                                                │
│      ├─ /tx-rl/environment   (環境定義)                       │
│      ├─ /tx-rl/training      (訓練監控)                       │
│      ├─ /tx-rl/backtest      (回測結果)                       │
│      └─ /tx-rl/evaluation    (vs Buy & Hold)                  │
└────────────────────┬─────────────────────────────────────────┘
                     │ HTTP (Next.js API routes → proxy)
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Backend (FastAPI :38000)                                      │
│  ├─ 新增 router: /api/tx-rl/*                                 │
│  │    ├─ POST /api/tx-rl/train     啟動訓練                   │
│  │    ├─ GET  /api/tx-rl/jobs/:id  查詢進度                   │
│  │    ├─ POST /api/tx-rl/backtest  跑回測                     │
│  │    └─ GET  /api/tx-rl/compare   vs Buy & Hold              │
│  └─ Celery task: src.tasks.tx_rl_training.train_tx_rl_agent   │
│      └─ 使用 stable-baselines3 + gymnasium                   │
└────────────────────┬─────────────────────────────────────────┘
                     │ ArangoDB
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ 資料層                                                       │
│  ├─ stock_daily (TWII 已注入 495 筆)                          │
│  ├─ market_index_daily (TWII 原始來源)                       │
│  ├─ [NEW] tx_rl_models (訓練結果持久化)                      │
│  └─ [NEW] tx_rl_training_jobs (任務狀態)                      │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 資料流

```
1. stock_daily (TWII) 
   ↓ fetch_daily_history("TWII", months=24)
2. Feature Engineering (pandas)
   ├─ MA5, MA20, MA60
   ├─ RSI, MACD, Bollinger Bands
   ├─ ret_1d, ret_5d, vol_5d
   └─ position info (current position, days held, unrealized PnL)
   ↓ normalize + window
3. Gymnasium Environment (TXTradingEnv)
   ├─ State: np.array of features (configurable dim)
   ├─ Action: 0/1/2 (configurable space)
   └─ Reward: configurable (PnL / Sharpe / multi-obj)
   ↓
4. RL Agent (PPO/A2C/DQN via stable-baselines3)
   ↓ train for N timesteps
5. Trained Model
   ↓ save to disk
6. Backtest
   ├─ Walk-forward: rolling windows
   ├─ Execution cost: 0.3% per side
   └─ Compare vs Buy & Hold 0050
   ↓
7. Store results → ArangoDB tx_rl_models
```

---

## 4. RL 環境設計（核心）

### 4.1 狀態空間（State Space）

**可配置特徵清單**（預設全開，可關閉）：

| 類別 | 特徵 | 預設 | 計算 |
|---|---|---|---|
| 價格 | close_norm | ✅ | close / close[0] - 1 |
| 價格 | high_norm, low_norm | ✅ | 同上 |
| 價格 | open_norm | ✅ | 同上 |
| 成交量 | volume_norm | ✅ | log(volume+1) / 20 |
| 技術指標 | MA5_ratio | ✅ | close / MA5 - 1 |
| 技術指標 | MA20_ratio | ✅ | close / MA20 - 1 |
| 技術指標 | MA60_ratio | ❌ | close / MA60 - 1 |
| 技術指標 | RSI14 | ✅ | TA-Lib RSI(14) |
| 技術指標 | MACD_signal | ❌ | MACD - signal line |
| 技術指標 | BB_position | ❌ | (close - BB_lower) / (BB_upper - BB_lower) |
| 波動 | ret_1d | ✅ | (close - close[-1]) / close[-1] |
| 波動 | ret_5d | ✅ | (close - close[-5]) / close[-5] |
| 波動 | vol_5d | ❌ | std(ret_1d, 5) |
| 持倉狀態 | position | ✅ | -1 / 0 / 1 |
| 持倉狀態 | days_held | ✅ | 0 ~ max_hold_days |
| 持倉狀態 | unrealized_pnl | ✅ | current close vs entry close |
| 持倉狀態 | cumulative_pnl | ✅ | 累計損益（標準化） |
| 持倉狀態 | drawdown | ✅ | max MDD（標準化） |
| 日曆 | day_of_week | ❌ | 0-4（避週末效應） |
| 日曆 | month | ❌ | 0-11 |

**預設維度**：約 12 個特徵（價格 + 持倉 + 基本技術指標）

**正規化**：所有特徵在 env.reset() 時 z-score 標準化（用 training period mean/std）

### 4.2 動作空間（Action Space）— 可調參

三種模式（UI radio button 切換）：

#### 模式 A：離散 3 動作（預設）
```python
action_space = spaces.Discrete(3)
# 0 = Sell/Short (開空或平多)
# 1 = Hold (保持現有部位)
# 2 = Buy/Long (開多或平空)
```

#### 模式 B：離散分桶 5 動作
```python
action_space = spaces.Discrete(5)
# 0 = Strong Sell (-1.0 部位)
# 1 = Weak Sell   (-0.5 部位)
# 2 = Hold        (0 部位)
# 3 = Weak Buy    (+0.5 部位)
# 4 = Strong Buy  (+1.0 部位)
```

#### 模式 C：連續動作
```python
action_space = spaces.Box(low=-1, high=1, shape=(1,))
# action 值 ∈ [-1, +1] = 目標部位大小
```

### 4.3 獎勵函數（Reward Function）— 可調參

三種模式：

#### 模式 A：純 PnL（預設）
```python
reward = daily_pnl_pct - transaction_cost
# 簡單但易過擬合（agent 會學高風險策略）
```

#### 模式 B：風險調整（Sharpe-like）
```python
reward = daily_pnl_pct / rolling_volatility_20d
# 鼓勵穩定收益
```

#### 模式 C：多目標
```python
reward = (
    daily_pnl_pct 
    - λ * max_drawdown_pct      # λ = 0.5 (MDD 懲罰)
    - μ * num_trades           # μ = 0.001 (減少過度交易)
)
# 參數 λ、μ 預設值可在 UI 調整
```

### 4.4 Episode 結構

- **Episode 長度**：整個訓練區間（如 2024-08-08 ~ 2026-05-13，約 400 天）
- **Step**：每個交易日 = 1 step
- **Done 條件**：episode 結束（無提前終止）

### 4.5 Gymnasium Environment 介面契約

```python
class TXTradingEnv(gym.Env):
    """TX (台指期) 日頻交易環境."""
    
    metadata = {"render_modes": ["human"]}
    
    def __init__(self, df: pd.DataFrame, config: TXEnvConfig):
        # config: action_mode, reward_mode, fees, slippage, etc.
        ...
    
    def reset(self, *, seed=None, options=None) -> tuple[ObsType, dict]:
        ...
    
    def step(self, action: int | float) -> tuple[ObsType, float, bool, bool, dict]:
        # 回傳 (observation, reward, terminated, truncated, info)
        # info 含: pnl, position, drawdown, trade_count
        ...
    
    def render(self):
        # 顯示持倉、累計 PnL
        ...
```

---

## 5. 訓練流程（Training Pipeline）

### 5.1 Algorithm 選擇

| 演算法 | 動作空間 | 預設 | 適用場景 |
|---|---|---|---|
| **PPO** | Discrete/Box | ✅ 預設 | 穩定、sample efficient 中等 |
| A2C | Discrete/Box | 支援 | 快速、但 variance 大 |
| DQN | Discrete only | 支援 | 離散動作、簡單 baseline |

**核心實作**（`backend/src/tasks/tx_rl_training.py`）：

```python
from stable_baselines3 import PPO, A2C, DQN
from stable_baselines3.common.vec_env import DummyVecEnv

def train_tx_rl_agent(env, config):
    algo_class = {"ppo": PPO, "a2c": A2C, "dqn": DQN}[config["algorithm"]]
    
    model = algo_class(
        "MlpPolicy",
        env,
        learning_rate=config.get("learning_rate", 3e-4),
        n_steps=config.get("n_steps", 2048),
        batch_size=config.get("batch_size", 64),
        n_epochs=config.get("n_epochs", 10),
        gamma=config.get("gamma", 0.99),
        gae_lambda=config.get("gae_lambda", 0.95),
        clip_range=config.get("clip_range", 0.2),
        verbose=1,
        seed=config.get("seed", 42),
        device="auto",
    )
    
    model.learn(total_timesteps=config.get("total_timesteps", 50000))
    return model
```

### 5.2 預設超參數

| 超參數 | 預設值 | 範圍 | 說明 |
|---|---|---|---|
| learning_rate | 3e-4 | 1e-5 ~ 1e-2 | 學習率 |
| n_steps | 2048 | 256 ~ 8192 | 每次更新前收集的步數 |
| batch_size | 64 | 16 ~ 256 | mini-batch 大小 |
| n_epochs | 10 | 1 ~ 50 | 每次更新的訓練輪數 |
| gamma | 0.99 | 0.9 ~ 0.999 | 折扣因子 |
| gae_lambda | 0.95 | 0.9 ~ 0.97 | GAE lambda |
| clip_range | 0.2 | 0.1 ~ 0.3 | PPO clip range |
| total_timesteps | 50000 | 10000 ~ 500000 | 總訓練步數 |
| seed | 42 | 0 ~ 9999 | 隨機種子 |

### 5.3 Celery 整合

- 任務丟到 Celery（與 ai_training 同模式）
- Celery worker 拉起訓練 → 完成後寫 ArangoDB
- 前端 polling 進度

```python
# backend/src/tasks/tx_rl_training.py
@celery_app.task(bind=True)
def train_tx_rl_agent_task(self, job_id: str, config: dict):
    # 1. 載入 TWII 資料
    df = fetch_twii_data()
    
    # 2. 建立 env
    env = TXTradingEnv(df, TXEnvConfig(**config))
    
    # 3. 訓練
    model = train_tx_rl_agent(env, config)
    
    # 4. 儲存模型
    model_path = save_model(model, job_id)
    
    # 5. 計算回測指標
    metrics = run_backtest(model, env, config)
    
    # 6. 寫 ArangoDB
    save_result(job_id, model_path, metrics)
```

---

## 6. 評估框架（Evaluation）

### 6.1 回測設計

**關鍵原則**（從前次 ML 分析學到）：
1. **真實進場價 = 訊號隔日開盤價**（不是當日收盤）
2. **滑價 0.3% × 2**（進 + 出）
3. **手續費 0.15% × 2**（口 × 200 元/點不算，因 RL 學的是百分比）
4. **MDD 必算**
5. **Walk-forward 必做**

### 6.2 Walk-Forward 驗證

```
時間軸: |----train----|--val--|---test---|
        |----train----|--val--|---test---|  (roll forward)
        |----train----|--val--|---test---|  (繼續 roll)
```

| 設定 | 值 |
|---|---|
| Train window | 250 天 (~1 年) |
| Val window | 50 天 |
| Test window | 50 天 |
| Roll step | 50 天 |
| 總 walk-forward 段數 | 4-5 段 |

### 6.3 評估指標

| 指標 | 公式 | 重要性 |
|---|---|---|
| **Cumulative Return** | 期末 / 期初 - 1 | ⭐⭐⭐ |
| **Annualized Return** | (1+CR)^(252/days) - 1 | ⭐⭐⭐ |
| **Sharpe Ratio** | mean(ret) / std(ret) × √252 | ⭐⭐⭐ |
| **Max Drawdown (MDD)** | max((peak - trough) / peak) | ⭐⭐⭐ |
| **Calmar Ratio** | Annualized Return / MDD | ⭐⭐ |
| **Win Rate** | 贏的次數 / 總交易次數 | ⭐⭐ |
| **Profit Factor** | 總獲利 / 總虧損 | ⭐⭐ |
| **Num Trades** | 進場次數（execution cost 影響） | ⭐⭐ |
| **Avg Trade PnL** | 總損益 / 交易次數 | ⭐ |

### 6.4 對照基準（Baseline Comparison）

**強制對照**（不可省略）：

| 基準 | 說明 | 預期勝率 |
|---|---|---|
| **Buy & Hold 0050** | 終極標竿（散戶最佳選擇） | RL 必須打贏才算成功 |
| **Buy & Hold TWII** | 純指數追蹤 | 大盤基準 |
| **MA5/MA20 Crossover** | 簡單規則（昨天我們驗證 RL 不如它）| 上一關 |
| **Random Policy** | 下界（agent 至少要 > 隨機） | 最低門檻 |

**對照表格式**（前端顯示）：

```
| 策略              | 年化 | MDD   | Sharpe | Calmar | 勝率 | PF    |
| Buy & Hold 0050   |  8%  | -45%  |  0.8   |  0.18  |  N/A |  N/A  |
| MA5/MA20 Cross    |  3%  | -15%  |  0.4   |  0.20  | 60%  | 1.20  |
| TX-RL (this run)  |  ?%  |  ?%   |  ?     |  ?     |  ?%  |  ?    |
```

---

## 7. 風險控管（Risk Controls）— 強制

### 7.1 Backtest 內建保護

| 限制 | 值 | 用途 |
|---|---|---|
| Max position | ±1.0（滿倉） | 防止 over-leverage |
| Max drawdown | -30% | 觸發則停止 episode |
| Max daily loss | -5% | 觸發則強制 Hold 一天 |
| Slippage | 0.3% per side | 模擬真實成交 |
| Commission | 0.15% per side | 散戶標準 |

### 7.2 Training 階段保護

- **Early stopping**：val reward 連續 10 個 episode 沒改善 → 停止
- **Max training time**：30 分鐘（避免無限訓練）
- **Reproducibility check**：同一 config 跑 2 次，結果應在 ±5% 內

### 7.3 預期結果的誠實聲明

**SPEC 必須在 UI 顯示這個警告**：

> ⚠️ **RL 在台指期日頻的歷史實證效果有限**：
> - 學術文獻：日頻 RL agent 鮮少持續打敗 Buy & Hold
> - 我們的 ML 測試：XGBoost OOS 勝率 56.9%（≈ 隨機）
> - 散戶劣勢：execution gap 0.3% × 2、單台電腦、無 co-location
>
> **這個功能的目的是「學 RL」而非「賺錢」**。

---

## 8. UI 設計（Sidebar + 4 個子頁面）

### 8.1 Sidebar 入口

修改 `frontend/src/components/sidebar-nav.tsx`，新增項目：

```typescript
{
  route: '/tx-rl',
  title: '台指期 RL',
  icon: Brain,  // 沿用 ai-training 圖示
  // 可加 description: '台指期日K RL 訓練'
}
```

### 8.2 子頁面架構

#### 頁面 1：`/tx-rl/environment` — 環境定義
- Action Space 選擇（Radio: 3 actions / 5 actions / continuous）
- Reward Function 選擇（Radio: Pure PnL / Sharpe / Multi-objective）
- Reward 參數調整（λ, μ 滑桿）
- State Features 多選 checkbox（價格/技術/波動/持倉/日曆）
- Algorithm 選擇（PPO / A2C / DQN）
- 超參數（learning rate, gamma, total_timesteps 等）
- 資料區間（start_date, end_date, train/val/test ratio）
- Walk-Forward 設定（train window, roll step）
- [下一步] 按鈕 → /tx-rl/training

#### 頁面 2：`/tx-rl/training` — 訓練監控
- 「開始訓練」按鈕
- 即時進度條（timestep / total）
- 當前 reward 曲線
- log 滾動
- 訓練完成後 → [看回測] / [看評估] 按鈕

#### 頁面 3：`/tx-rl/backtest` — 回測結果
- 權益曲線圖（agent vs Buy & Hold 0050）
- 月度/週度報酬分佈
- 進場點散佈（K 線上標示 buy/sell）
- 指標卡片（年化、MDD、Sharpe、Calmar）
- [看完整評估] 按鈕 → /tx-rl/evaluation

#### 頁面 4：`/tx-rl/evaluation` — 對照分析
- 4 個策略對照表（Buy & Hold 0050 / TWII / MA5/MA20 / TX-RL）
- 多模型比較（同一參數、不同 seed）
- 雷達圖（5 個維度）
- 「⚠️ 預期結果誠實聲明」區塊
- 匯出 CSV

### 8.3 組件結構（沿用 ai-training 模式）

```
frontend/src/app/tx-rl/
├── layout.tsx                    # 包 AppShell
├── page.tsx                      # 環境定義（首頁）
├── training/
│   └── page.tsx                  # 訓練監控
├── backtest/
│   └── page.tsx                  # 回測結果
└── evaluation/
    └── page.tsx                  # 對照分析
```

---

## 9. 資料層（Data Layer）

### 9.1 ArangoDB 新增 Collection

#### `tx_rl_training_jobs`
```json
{
  "_key": "uuid",
  "job_id": "uuid",
  "status": "running | completed | failed",
  "config": { ... },            // 完整 training config
  "created_at": 1234567890,
  "finished_at": 1234567890,
  "error": null,
  "result_ref": "tx_rl_models/uuid"  // 指向結果文件
}
```

#### `tx_rl_models`
```json
{
  "_key": "uuid",
  "job_id": "uuid",
  "model_path": "/data/tx_rl_models/uuid/model.zip",
  "config": { ... },
  "metrics": {
    "train_reward": ...,
    "val_reward": ...,
    "test_metrics": {
      "cumulative_return": ...,
      "annualized_return": ...,
      "sharpe": ...,
      "max_drawdown": ...,
      "calmar": ...,
      "win_rate": ...,
      "profit_factor": ...,
      "num_trades": ...
    }
  },
  "walk_forward_results": [
    { "window": "2024-08 ~ 2025-01", "sharpe": ..., "return": ..., "mdd": ... },
    ...
  ],
  "baseline_comparison": {
    "buy_hold_0050": { ... },
    "buy_hold_twii": { ... },
    "ma_crossover": { ... }
  },
  "created_at": 1234567890
}
```

### 9.2 模型儲存

- 模型檔案存 `/home/daniel/github/aistock/backend/tx_rl_models/{job_id}/model.zip`
- 不 commit 到 git（.gitignore）
- 訓練結果 metadata 進 ArangoDB

---

## 10. Backend API 規格

### 10.1 新增 Routers

#### `POST /api/tx-rl/train`
```json
Request:
{
  "config": {
    "data": {
      "start_date": "2024-08-08",
      "end_date": "2026-08-21",
      "train_ratio": 0.7,
      "val_ratio": 0.15,
      "test_ratio": 0.15
    },
    "env": {
      "action_mode": "discrete_3",  // discrete_3 | discrete_5 | continuous
      "reward_mode": "pure_pnl",    // pure_pnl | sharpe | multi_objective
      "reward_params": { "lambda_dd": 0.5, "mu_trade": 0.001 },
      "state_features": ["price", "tech", "vol", "position"],
      "fees": { "slippage_pct": 0.3, "commission_pct": 0.15 }
    },
    "model": {
      "algorithm": "ppo",
      "learning_rate": 3e-4,
      "n_steps": 2048,
      "batch_size": 64,
      "gamma": 0.99,
      "seed": 42,
      "total_timesteps": 50000
    },
    "walk_forward": {
      "enabled": true,
      "train_window": 250,
      "val_window": 50,
      "test_window": 50,
      "roll_step": 50
    }
  }
}

Response:
{
  "job_id": "uuid",
  "status": "running"
}
```

#### `GET /api/tx-rl/jobs/{job_id}`
```json
Response:
{
  "job_id": "uuid",
  "status": "running | completed | failed",
  "progress": {
    "current_step": 12345,
    "total_steps": 50000,
    "current_reward": 0.023
  },
  "started_at": 1234567890,
  "finished_at": null
}
```

#### `GET /api/tx-rl/jobs/{job_id}/result`
```json
Response:
{
  "job_id": "uuid",
  "metrics": { ... },
  "walk_forward_results": [ ... ],
  "baseline_comparison": { ... }
}
```

#### `POST /api/tx-rl/compare`
```json
Request:
{
  "job_id": "uuid"
}

Response:
{
  "buy_hold_0050": { "cumulative_return": ..., "sharpe": ..., "mdd": ... },
  "buy_hold_twii": { ... },
  "ma_crossover": { ... },
  "tx_rl_agent": { ... }
}
```

---

## 11. 環境變數

```bash
# backend/.env 新增
TX_RL_MODEL_DIR=/home/daniel/github/aistock/backend/tx_rl_models
TX_RL_DEFAULT_ALGO=ppo
TX_RL_DEFAULT_TIMESTEPS=50000
```

---

## 12. 測試計畫

→ 見 `TX-模組測試計劃.md`（8 節結構）

---

## 13. 通過定義（Definition of Done）

一個 v0.1 版本可被視為「完成」，需要滿足：

- [ ] 4 個 sidebar 子頁面都能開啟且無 console error
- [ ] 環境定義頁可選 action space（3 種）、reward（3 種）、algorithm（3 種）
- [ ] 訓練可啟動、有進度條、完成後狀態變 completed
- [ ] 回測頁顯示權益曲線 + 6 個指標
- [ ] 評估頁顯示與 Buy & Hold 0050/TWII/MA5-MA20 對照表
- [ ] Backend 8 個 API 端點都有合約測試通過
- [ ] Gymnasium Env 通過 `env_checker` 驗證
- [ ] Walk-forward 3 段以上結果都記錄
- [ ] 警告文字「學 RL 不是賺錢」在所有頁面顯示
- [ ] ts-check / lint 在前端 0 錯（ai-training 範圍）
- [ ] ruff 在 backend 0 錯
- [ ] 1 個示範訓練（用預設 config）跑完 + 結果可查

---

## 14. 開發順序（建議）

1. **Backend Env**（Gymnasium TXTradingEnv + 單元測試）
2. **Backend Training Task**（Celery + stable-baselines3）
3. **Backend API**（4 個端點）
4. **Frontend 環境定義頁**（送 config 給後端）
5. **Frontend 訓練監控頁**（polling 進度）
6. **Frontend 回測結果頁**（圖表 + 指標）
7. **Frontend 評估對照頁**（多策略表）
8. **Sidebar 入口**（sidebar-nav.tsx）
9. **整合測試**（end-to-end）
10. **E2E 範例訓練**（用預設 config 跑一次）

---

## 15. 版本記錄

| 日期 | 版本 | 更新者 | 變更內容 |
|------|------|--------|----------|
| 2026-08-23 | 0.1.0 | Sisyphus | 初版規格（基於 ML 分析經驗 + 學習 RL 需求） |
