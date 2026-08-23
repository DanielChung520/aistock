export const ACTION_SPACE_MD = `### 動作空間（Action Space）

Agent 每個交易日可以採取的**動作集合**。SPEC §4.2 定義三種模式：

## 3 動作 (discrete_3) — 預設

| 動作 | 意義 | 部位 |
|---|---|---|
| 0 | Sell / 平多 | -1.0 |
| 1 | **Hold**（保持現有部位） | 不變 |
| 2 | Buy / 平空 | +1.0 |

- **最簡單**、訓練最快、適合 DQN
- 缺點：無法控制部位大小（例如不能「半倉」）

## 5 動作 (discrete_5)

- Strong Sell → Weak Sell → **Hold** → Weak Buy → Strong Buy
- 對應部位：-1.0 / -0.5 / 不變 / +0.5 / +1.0
- 控制部位大小但比 discrete_3 慢

## 連續 (continuous)

- 動作值 ∈ '[-1, +1]' = 目標部位大小
- 彈性最高但訓練難（需 SAC / TD3）
- 不適合 PPO 預設

### 何時選哪個？

- **初學**：discrete_3（最穩定）
- **想要部位控制**：discrete_5
- **連續空間 + 高算力**：continuous + SAC
`

export const REWARD_FUNCTION_MD = `### 獎勵函數（Reward Function）

訓練時 agent 嘗試**最大化**的目標。SPEC §4.3 定義三種：

## 純 PnL (pure_pnl) — 預設

- reward = daily_pnl_pct - cost_pct
- 簡單直接
- **缺點**：agent 會學高風險策略（賭一把大的）

## 風險調整 (sharpe)

- reward = daily_pnl_pct / rolling_volatility_20d
- 鼓勵穩定收益
- 波動率估計有噪訊，訓練可能不穩定

## 多目標 (multi_objective)

- reward = PnL - λ·MDD - μ·trades
- 最真實：同時考慮報酬、最大回撤、交易次數
- λ（MDD 懲罰）和 μ（交易懲罰）可在 UI 調整
- **推薦**用於真實策略模擬

### 建議

純學 RL → pure_pnl
模擬真實策略 → multi_objective（λ=0.5, μ=0.001）
`

export const STATE_FEATURES_MD = `### State Features — 環境觀察向量

Agent 每步看到的**資訊**。SPEC §4.1 五組可獨立開關：

| 群組 | 包含 | 維度 |
|---|---|---|
| **price** | close/open/high/low 標準化 + volume | 5 |
| **tech** | MA5 ratio、MA20 ratio、RSI14 | 3 |
| **vol** | ret_1d、ret_5d、vol_5d | 3 |
| **position** | 部位、持有天數、未實現損益、累計 PnL、回撤 | 5 |
| **calendar** | day_of_week、month | 2 |

**預設 12 維**（price + tech + vol + position）。

### TWII 缺個股欄位

這是大盤，不是個股 — 沒有：
- 營收 / 財務報表
- 法人買賣超
- 融資融券
- 個股情緒

所以**只有 5 個衍生特徵**有意義（從 OHLCV 算）。
要更強特徵需要 v0.2 拉 FinMind 法人資料。

### 怎麼選？

- 初學：全部勾（預設 12 維）
- 嫌訓練慢：取消 vol 和 calendar
- 想看純價格：只留 price + tech
`

export const ALGORITHM_MD = `### Algorithm 與超參數

## 三個演算法

| 演算法 | 動作空間 | 特性 |
|---|---|---|
| **PPO** | Discrete / Continuous | 穩定、預設首選 |
| A2C | Discrete / Continuous | 快速、但 variance 大 |
| DQN | Discrete only | 經典 baseline，較慢 |

## 重要超參數

| 參數 | 預設 | 作用 |
|---|---|---|
| learning_rate | 3e-4 | 太大會震盪、太小會學不到 |
| n_steps | 2048 | 每次更新前收集的步數 |
| batch_size | 64 | mini-batch 大小 |
| gamma | 0.99 | 折扣因子（越接近 1 越看長期）|
| total_timesteps | 50000 | **總訓練步數**（越大越準、越慢）|

### total_timesteps 怎麼選？

| 想做什麼 | 建議 |
|---|---|
| 快速 smoke test | 1000 ~ 2000（幾十秒）|
| 認真訓練 | 50000（5-15 分鐘）|
| 研究用 | 200000+（30 分鐘以上）|

### seed 設成什麼？

預設 42。
- 同一 seed 跑兩次應該得到**接近**的結果（可重現性 ±5%）
- 不同 seed 跑出**不同**結果（探索不同策略）
`

export const DATA_RANGE_MD = `### 資料區間

- **預設**：2024-08-08 ~ 2026-08-21（TWII 已注入 stock_daily）
- 訓練會用這段區間的所有特徵

### 想用其他區間？

1. 確認 market_index_daily 有對應區間的 TWII 資料
2. 跑 market_index_download Celery 任務下載
3. 再回到這裡調整日期

### 區間太短會怎樣？

- < 250 天：train split 可能 < 100 筆，模型學不到東西
- < 50 天：環境直接報錯「資料不足」
`

export const WALK_FORWARD_MD = `### Walk-Forward 驗證（防止過擬合）

**為什麼需要**？在 sample 內訓練、在 sample 內測試會**過擬合**。
Walk-Forward 把時間切成多段，每段都「前段訓練、後段測試」，模擬真實情況。

## 預設參數

- train_window: 250 天 (~1 年)
- val_window: 50 天
- test_window: 50 天
- roll_step: 50 天

## 切出幾段？

495 天資料 / 50 天 roll_step ≈ **5-6 段**。

每段都是獨立訓練 + 測試，最後取平均。
- **啟用 → 結果更可信，但訓練時間 × N 段**
- **關閉 → 只用 train/test 切一次，較快但可能過擬合**

### 建議

- 預設啟用
- 除非只是 smoke test，否則不要關
`

export const TRAINING_STATUS_MD = `### 訓練狀態

- pending：job 已建立，Celery 還沒撿到
- running：Celery 正在跑
- completed：訓練完成，可看結果
- failed：訓練失敗（看 error 訊息）

### 卡在 pending 很久？

- Celery worker 沒重啟載入新 task → systemctl --user restart aistock-celery
- Redis broker 斷線 → redis-cli -p 6380 ping
`

export const TRAINING_PROGRESS_MD = `### 訓練進度

- **Step**：目前已訓練的環境步數
- **總步數**：設定的 total_timesteps
- **耗時**：從訓練開始到現在的秒數

### 預估完成時間

(剩餘步數 / 當前步數) × 已耗時

PPO 在 TWII 495 步的環境下大約：
- 1000 steps ≈ 10-30 秒
- 50000 steps ≈ 5-15 分鐘（CPU）/ 1-3 分鐘（GPU）
`

export const BACKTEST_METRICS_MD = `### 核心指標

| 指標 | 公式 | 怎麼看 |
|---|---|---|
| **累積報酬** | 期末/期初 - 1 | 越高越好，但要看 MDD |
| **Sharpe** | mean(ret)/std(ret) × √252 | > 1 是好、< 0 是虧錢 |
| **MDD** | 最大 (peak - trough)/peak | 越小越好。> 30% 風險高 |
| **勝率** | 賺的次數 / 總次數 | 50% 是 baseline，> 60% 不錯 |

### 這些指標怎麼搭配看？

- **Sharpe 高 + MDD 低** = 好策略
- **累積高 + MDD 高** = 高風險高報酬
- **勝率高 + 累積低** = 賺少賠少
`

export const BACKTEST_SUMMARY_MD = `### 訓練摘要

- **交易次數**：agent 進出場的總次數
- **訓練步數**：總共在環境中走了幾步
- **模型路徑**：backend/tx_rl_models/{job_id}.zip
- **Job ID**：可從這裡複製到 /compare API 或其他工具

### Config 完整展開

點下方「查看完整 config」可以看到訓練時用的所有參數。
`

export const EVAL_TABS_MD = `### Tabs 切換

- **對照表**：4 個策略的關鍵指標 + 結論摘要（綠/紅 banner）
- **可視化**：4 個互動圖表（Equity Curve、Drawdown、Trade Scatter、Reward）

### 怎麼看？

- 先看**對照表**的 alpha 數字（TX-RL vs B&H 0050）
- 再切到**可視化**看圖，確認那個 alpha 是在哪段時間賺的
`

export const EVAL_EQUITY_CURVE_MD = `### 1. Equity Curve — 4 策略資金曲線

- **X 軸**：日期（2024-08 ~ 2026-08）
- **Y 軸**：資金相對值（起點 = 1.0）
- **4 條線**：
  - TX-RL Agent
  - Buy & Hold 0050
  - Buy & Hold TWII
  - MA5/MA20 Crossover

### 怎麼看？

- 線**斜率** = 平均報酬率
- 線**差距** = alpha（TX-RL vs B&H）
- **震盪幅度** = 波動率
`

export const EVAL_DRAWDOWN_MD = `### 2. Drawdown Timeline — 回撤時序

- **X 軸**：日期
- **Y 軸**：從最高點跌的**負百分比**（向下）
- 線**越低** = 回撤越深

### 怎麼看？

- **Buy & Hold** 通常最深（大盤崩盤時一起跌）
- **TX-RL Agent** 理論上能避開大跌，但實務上常**追高殺低**反而更深
- 比較「最大回撤深度」和「持續時間」

MDD 超過 -30% 已是高風險
`

export const EVAL_TRADE_SCATTER_MD = `### 3. Trade Scatter — 進場點散佈

- **X 軸**：進場日期
- **Y 軸**：進場價位
- 綠 = Buy（做多）
- 紅 = Sell（做空）

### 怎麼看？

- 點位**聚集**在特定價位 = agent 學到某個「magic price」
- 點位**分散** = agent 在不同價位都敢進場
- 跟 Equity Curve 對照看，賺錢的進場是否避開大跌段
`

export const EVAL_REWARD_CURVE_MD = `### 4. Reward Training Curve — PPO 學習曲線

- **X 軸**：訓練 step
- **Y 軸**：episode 累計 reward

### 怎麼判讀？

| 曲線形狀 | 意義 |
|---|---|
| 上升趨勢 | 還在學習 |
| 平穩 | 已收斂 |
| 下降 | 過擬合或 reward 設計有問題 |
| 震盪大 | gamma 太高或 learning rate 不穩 |

1000 timesteps 通常不夠收斂，至少 10000+ 才看得出趨勢
`

export const WARNING_MD = `### 學術預期結果（必須知道）

TX-RL 在台指期日頻的歷史實證**效果有限**：

- 我們的 ML 測試：XGBoost OOS 勝率 56.9%（≈ 隨機）
- 學術共識：日頻 RL agent 鮮少持續打贏 Buy & Hold
- 散戶劣勢：execution gap 0.3% × 2、單台電腦、無 co-location

### 這個功能的目的

**學 RL 流程**（state / action / reward / policy / walk-forward），
**不是學穩賺**。
`
