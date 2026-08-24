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

export const EVAL_EQUITY_CURVE_MD = `### 1. Equity Curve — 4 策略資金曲線對比

#### 圖表結構

- **X 軸**：日期（2024-08-08 ~ 2026-08-21，共 495 個交易日）
- **Y 軸**：資金相對值（起點 = 1.0 = 100 萬；1.5 = 150 萬）

#### 4 條線的意義

**TX-RL Agent**（琥珀色）
- 你這次訓練的 PPO 在 TWII 上的測試結果
- **看點**：跟其他三條的差距。遠低於 B&H = PPO 學到錯的（追高殺低）；接近 B&H = 學到均值回歸；偶爾超過 = 某段時間抓對方向
- **形狀**：訓練不足→鋸齒（頻繁進出場）；過擬合→完美曲線（後者通常是警訊）

**Buy & Hold 0050**（深灰）
- TWII × 0.78 的近似（0050 約 78% 曝險 TWII）
- **看點**：台灣散戶最務實的選擇——什麼都不做、定期投入
- **形狀**：最平滑（無交易摩擦）= 純粹大盤 beta

**Buy & Hold TWII**（淺灰）
- 直接持有 TWII
- **看點**：比 0050 多 22% 曝險 → 這段期間多約 22% 累積報酬
- **形狀**：比 0050 更陡，但回撤也更深

**MA5/MA20 Crossover**（藍）
- DanielMA 訊號（5日 vs 20日均線交叉）
- **看點**：傳統技術指標 baseline。如果 RL 沒顯著打贏 = PPO 在日頻沒 alpha
- **形狀**：鋸齒狀（每次交叉都交易），比 B&H 波動大

#### 怎麼讀這張圖

1. **看終點差距**：所有線的終點 y 值差距 = 各策略最終累積報酬率
2. **看斜率變化**：線段越陡 = 該段期間報酬越高；越平 = 該段期間停滯
3. **看交叉點**：當 TX-RL 線從下方穿越 B&H 線 = PPO 開始打贏被動持有
4. **看震盪幅度**：TX-RL 線的鋸齒（上下起伏）幅度 = PPO 進出次數的視覺化

#### 學術上要注意的

- **不能只比終點**：要看線的整體形狀，不是只比誰高
- **Out-of-sample 才是真的**：所有線都是 in-sample（訓練時看過），真實考驗是部署到未來
- **滑價現實**：Buy & Hold 沒算滑價；RL 與 MA 真實表現會因 0.3% × 2 略低

#### 常見的「過擬合」pattern

| 現象 | 說明 |
|---|---|
| TX-RL 線遠高於其他三條 | in-sample 過擬合，out-of-sample 會暴跌 |
| TX-RL 線劇烈起伏 | agent 過度交易，手續費吃掉利潤 |
| TX-RL 線呈完美曲線 | 過擬合典型特徵（市場不是這麼乾淨）|
| TX-RL 線在某段突然變水平 | agent 學到「永遠 hold」= RL 退化成 B&H |
`

export const EVAL_DRAWDOWN_MD = `### 2. Drawdown Timeline — 回撤隨時間變化

#### 圖表結構

- **X 軸**：日期（與 Equity Curve 同步）
- **Y 軸**：從「該日期之前的歷史最高點」跌到該日的**負百分比**（向下為負）
- **例如**：-10 表示從最高點跌了 10%

#### 為什麼 Drawdown 比單純報酬更重要

- 高報酬但高 MDD 的策略 = 你可能在某個時間點被洗掉（爆倉），撐不到最終報酬
- 低 MDD 策略 = 你能睡得著覺，心理壓力小，能長期持有
- **Calmar Ratio** = 年化報酬 / |MDD|，> 1 才算「舒服」的策略

#### 4 條線的意義

**TX-RL Agent**
- **看點**：理想應比 B&H 平（會避開大跌）；實務上常**更深**（追高殺低）
- **常見問題**：PPO 學到「看到跌就跟著賣，賣在最低點」——在 drawdown 圖上呈「領先下跌」
- **健康訊號**：drawdown 跟上大盤但稍微淺一點

**Buy & Hold 0050 / TWII**
- **看點**：大盤崩盤時（2025-08、2026-04）會一起跌
- **MDD 通常 -28% ~ -45%**：台股被動持有的真實風險
- **不可消除**：不投資就不會跌，但也不會漲

**MA5/MA20 Crossover**
- **看點**：理論上 drawdown 應比 B&H 淺（訊號會賣出避險）
- **實務常見問題**：均線是落後指標，常在跌完後才賣、漲完後才買（右側交易）
- 所以 drawdown 跟 B&H 差不多，但報酬更低：兩邊都吃虧

#### 怎麼讀這張圖

1. **最深的谷**：整段期間最大回撤發生在哪段時間？那時市場發生什麼？
2. **恢復時間**：從最深谷回到前高的天數——越慢越痛苦
3. **TX-RL 谷底比 B&H 淺嗎**：淺 = PPO 有避險能力；深 = 沒避險甚至加劇
4. **TX-RL 谷底比 B&H 早出現嗎**：早 = 領先下跌（可能好的預警，但常見是過度反應）；同時間 = 只是跟著跌

#### 危險訊號

- MDD < -30%：開始需要考慮加倉策略
- MDD < -50%：典型散戶爆倉區間
- MDD 超過 6 個月沒回來：心理上非常痛苦
`

export const EVAL_TRADE_SCATTER_MD = `### 3. Trade Scatter — 進場點散佈

#### 圖表結構

- **X 軸**：進場日期
- **Y 軸**：進場時的 TWII 點數
- **每個點** = 一次進場
- **綠點** = Buy（做多進場）
- **紅點** = Sell（做空進場）

#### 為什麼這張圖重要

進場時機決定一切——同一個策略，進場在 21,000 跟進場在 24,000 的報酬天差地別。這張圖讓你**一眼看出 PPO 在什麼價位、什麼時間點進場**。

#### 4 種典型 pattern（PPO 學到了什麼？）

**Pattern 1：聚集在低價區**
- 點都集中在 21,000-23,000 → PPO 學到「跌深就買」
- ✅ 通常是好訊號（均值回歸策略）
- **驗證**：對照 Equity Curve，那段時間是否賺錢？

**Pattern 2：聚集在高價區**
- 點都集中在 26,000 以上 → PPO 學到「漲多就追」
- ⚠️ 通常是「追高」壞習慣的訊號
- **驗證**：之後是不是都慘賠？

**Pattern 3：均勻分散**
- 點散落在各個價位區間 → PPO 沒有學到價格偏好
- 中性訊號（不壞也不好）

**Pattern 4：聚集在某個特殊日期**
- 很多點在某 1-2 天內 → 可能學到「事件驅動」進場（但 495 天可能沒什麼事件）
- 需要檢查那些日期有什麼新聞

#### 怎麼讀這張圖

1. **綠 vs 紅比例**：純買進 = 永遠做多（long-only）；有紅點 = PPO 學到放空
2. **點的密度**：某段時間特別密集 = PPO 認為那段有機會（也可能是過擬合）
3. **價位高低**：平均進場價位 vs 期間 TWII 平均（22,400）→ PPO 偏好高檔追還是低檔撿？
4. **跟 Equity Curve 對照**：綠點的時段，Equity Curve 是不是上升的？紅點後曲線是不是下降？

#### 常見的紅旗

- 幾乎所有點在某個價格區間密集 → PPO 過擬合到某個「magic price」
- 綠點剛好都在 2025 年 8-10 月（大盤下跌段）→ PPO 在錯誤的時間進場（逆勢做多）
- 點很少（5 個以下）→ 樣本太少，結論不可信

#### 這張圖的侷限

- 只看進場點，沒畫出場點（要看完整進出場可以從後端查 trade_list）
- 沒有顯示持倉時間長短
- 沒有顯示每筆交易的大小（RL 固定 ±1 部位，但 MA 可能不同）
`

export const EVAL_REWARD_CURVE_MD = `### 4. Reward Training Curve — PPO 學習曲線

#### 圖表結構

- **X 軸**：訓練 step（不是日期）
- **Y 軸**：該 episode 的累計 reward
- 每個點 = 一次完整 episode 結束後的 reward

#### 為什麼這張圖跟其他三張不同

Equity / Drawdown / Trade 都是「**結果**」——訓練後的成果。
Reward Curve 是「**過程**」——訓練時 agent 學到什麼。

#### 怎麼讀 reward 曲線

**上升趨勢（最好）**
- PPO 持續學到更好的策略
- 斜率越陡 = 學得越快

**平穩（還 OK）**
- 已收斂（converged）—— PPO 找到當前架構下的最優策略
- 通常發生在 10,000-50,000 steps
- 但「收斂到好的策略」和「收斂到爛的策略」都是平的——要對照 Equity Curve 看

**下降趨勢（壞）**
- PPO 在過擬合（overfitting）——reward 在訓練環境上變好，但在沒見過的資料上會變差
- 通常發生在 reward 設計有問題（例如太看重短期 reward，agent 學到刷分）

**震盪大（不穩定）**
- learning rate 太高 / gamma 太高 / reward 設計太極端
- 需要降低 learning_rate（試 3e-4 → 1e-4）或增加 n_steps（試 2048 → 4096）

#### 1000 timesteps 看 reward 曲線要注意

這張圖是**取樣後**的（最多 500 點），所以 1000 timesteps 只有 20-30 個點。**樣本太少看不出趨勢**——至少 10,000 timesteps 才有意義。

#### 健康的 reward 曲線 pattern

上升趨勢 + 收斂後微幅震盪 = PPO 學到了且穩定 ✅

**不健康的 pattern**

- 突然下降：環境 bug 或 reward 不穩定
- 訓練震盪不收斂：hyperparameters 要調
- 完全平直：沒學到東西，換 reward function

#### 跟 Equity Curve 對照

- Reward 上升 + Equity 也上升 = PPO 真的學到東西 ✅
- Reward 上升 + Equity 平 = PPO 在訓練環境有效，但 out-of-sample 失敗（過擬合警訊）⚠️
- Reward 平 + Equity 上升 = PPO 找到好的穩定策略 ✅
- Reward 平 + Equity 平 = 學不到東西，換 hyperparameters ❌
- Reward 下降 + Equity 下降 = 訓練壞掉，要重新設計 ❌
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
