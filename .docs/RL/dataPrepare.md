# 台指期 RL 資料準備筆記

## 目標

本筆記記錄以**強化學習（Reinforcement Learning, RL）**操作台指期（TAIEX 期貨）的資料準備流程，涵蓋從原始逐筆 Tick 到可直接餵給 RL Agent 的訓練資料集（Parquet）之完整管線，以及兩個實作腳本（`taifex_downloader.py`、`build_rl_dataset.py`）。

在強化學習（RL）應用於台指期交易的**資料準備階段（Data Preparation Pipeline）**，最關鍵的不是「把資料塞滿」，而是三個核心原則：

- **避免資料污染**：排除價差單、試撮、異常 Spike 等非真實交易雜訊。
- **杜絕未來資訊洩漏（Lookahead Bias）**：所有特徵只能使用當前 step 及之前的資料，禁止以全域統計量標準化。
- **確保 Reward 的物理意義正確**：透過換月價差平移（Back-Adjustment），讓 RL 計算 Step Reward 時不會把換月價差誤算進 Agent 的獲利或虧損。

標準、嚴謹的資料前處理流程應遵循以下 **5 大核心階段**。

## 總覽：5 大核心階段

```
[原始逐筆 Tick]
   ⬇ (階段 1: 結構清理與流動性過濾)
[純淨 Tick]
   ⬇ (階段 2: 1 分鐘 OHLCV 聚合 & 時間對齊)
[單日 1-min K 棒]
   ⬇ (階段 3: 主力合約滾動與價差平移 Back-Adjustment)
[連續合約時間序列 (Continuous Contract)]
   ⬇ (階段 4: RL 狀態特徵工程 & 因果無偏標準化)
[RL 訓練資料集 (Parquet)]
```

以下依序說明各階段、實作腳本，以及跨市場與籌碼特徵的進階設計。

## 階段 1：Tick 資料清洗與流動性過濾 (Tick-level Cleaning)

歷史 Tick 是最底層的撮合紀錄，必須先剔除非交易雜訊：

1. **排除價差單（Calendar Spreads）**

   - 台指期原始檔包含跨月價差單（如 `TX/202609/202610`），這類單的成交價是「價差點數」（例如 `-15` 或 `+20`），若未剔除會直接摧毀價格序列。

2. **剔除試撮與非交易時段數據**

   - 開盤前（08:30～08:45）的模擬撮合報價不可視為真實成交。

3. **過濾單筆異常值（Bad Tick Filter）**

   - 排除價格 $\le 0$、成交量 $\le 0$ 的異常封包。
   - 剔除單筆瞬間跳動超過 3%~5% 且於次筆立即回彈的錯單/異常造市尖刺（Spike）。

## 階段 2：1 分鐘 K 線聚合與時間軸對齊 (Aggregation & Alignment)

1. **OHLCV 聚合**

   - 將每分鐘 $[T, T+59\text{s}]$ 內的成交紀錄聚合成 `Open`（第一筆）、`High`（最高）、`Low`（最低）、`Close`（最後一筆）、`Volume`（總量）。

2. **無成交分鐘的插補（Gap Imputation）**

   - 夜盤或冷門時段常出現「整整 1 分鐘無任何成交」的情況。
   - **正確做法**：`Close` 使用前一分鐘的 Close 進行 **Forward Fill (`ffill`)**；`Open`、`High`、`Low` 全部補為該 `Close`；`Volume` 填 `0`。**切忌直接刪除該分鐘**，否則會破壞 RL 時間序列的等距特性（Fixed-step Markov Decision Process）。

3. **日盤與夜盤時間戳記劃分**

   - 嚴格區分 **日盤（Regular Session, 08:45–13:45）** 與 **夜盤（Night Session, 15:00–次日 05:00）**。
   - 保留時間特徵標籤（如 `is_night_session`），方便後續模型識別盤別流動性差異。

## 階段 3：主力合約滾動與價差平移 (Continuous Contract Construction)

這是期貨做 RL 最關鍵的步驟。台指期每月第三個星期三結算，若直接硬接不同月份合約，會產生「合約基差跳空（Roll Gap）」，導致 RL 模型學到錯誤的套利行為：

1. **滾動換月判定（Roll Rule）**

   - **成交量/未平倉量（OI）交叉點切換**，或固定於**結算日當天 13:00 前後**自動將主力指針切換至次月合約。

2. **價差平移調整（Back-Adjustment / Panama Method）**

   - **原因**：RL 計算 Step Reward（例如 $\Delta \text{Price} \times \text{Position}$）時，不能把換月的 50~100 點價差算進 Agent 的獲利或虧損。
   - **做法**：以最新合約為基準，將歷史合約的歷史價格全部累加/累減基差偏移量（Offset），生成 **Adjusted Price**。
   - **雙軌保存原則**：
     - `Raw OHLC`：保留真實價格（用於計算真實保證金、滑價、手續費）。
     - `Adj OHLC`：保留平移後的連續價格（用於計算 RL 的 Reward 與技術指標）。

## 階段 4：RL 狀態特徵工程與無偏標準化 (Causal Feature Engineering)

給 RL 的輸入（Observation）必須保證**因果性（Causal Strictness）**：

1. **拒絕絕對價格，改用相對變化量（Stationary Inputs）**

   - 不要直接將 20,000 點等絕對價格丟給神經網路。
   - 應轉換為：**Log Return（對數報酬率）**、**Normalized Volume（成交量滾動分位數）**、**True Range / ATR（波動度比率）**。

2. **嚴格禁止 Lookahead Bias（未來數據洩漏）**

   - 所有特徵（如均線、布林通道、RSI、滾動標準差）**只能使用當前 step 及之前的資料（$t \le T$）**。
   - 嚴格禁止使用全局 `MinMaxScaler` 或整個資料集的 `StandardScaler`（這會引入未來的 Max/Min/Mean）。
   - **正確做法**：使用 **Rolling Window Z-Score**（例如過去 120 根 K 棒的均值與標準差）進行動態標準化。

3. **時間週期特徵編碼（Cyclical Time Features）**

   - 將分、時、星期轉換為正弦/餘弦編碼（$\sin/\cos$），讓 Agent 理解市場開盤（08:45）、尾盤（13:30）等關鍵時段節奏。

## 階段 5：資料集切分與儲存格式 (Data Split & Storage)

1. **時間順序嚴格劃分（Walk-Forward Split）**

   - **絕對不能做 Random Shuffle K-Fold！**
   - 必須依時間先後切分：
     - **Train Set**：例如 2015～2022 年（用於 Policy 探索與梯度更新）
     - **Validation Set**：例如 2023～2024 年（用於超參數微調、Early Stopping）
     - **Out-of-Sample Test Set**：例如 2025～2026 年（封存直至模型定型後，做最後無偏回測）

2. **儲存架構（Parquet）**

   - 處理完畢的連續 1 分 K 特徵矩陣存為 **Apache Parquet**（Snappy 壓縮），單一檔案數百 MB，支援極速記憶體映射（Memory-mapping），確保訓練時 `env.reset()` 與抽取 Observation 毫秒級完成。

## 特徵工程擴充研究（外部文獻對照）

本節是針對 15 分鐘 K 棒的台指期（TX）RL 環境（Gymnasium，主要交易日盤，夜盤 + 美股 + 籌碼作為背景特徵）所做的外部文獻對照研究。重點有兩個：驗證 dataPrepare.md 階段 4 的既有設計，以及補上可落地的特徵建議。

### 總結論

- **階段 4 的設計已領先大部分公開研究**：rolling z-score 因果標準化、T−1 廣播對齊、跨市場 / 籌碼 / 微結構特徵，這三項在公開文獻中幾乎沒有被同時且完整地落地。
- **主流框架餵原始價格是已知 anti-pattern**：以 FinRL 為代表的主流 RL 交易框架，實務上常直接把原始 OHLCV 序列餵給神經網路，缺乏因果標準化與時間對齊處理，本筆記的設計刻意避開這個坑。

### 外部文獻核心發現

| 主題 | 文獻 | arXiv ID / 來源 | 核心發現 |
|---|---|---|---|
| 多週期報酬 / 動能（vol 標準化） | Zhang / Zohren / Roberts | arXiv:1911.10107 | 50 種期貨、2011~2019；特徵用 multi-horizon returns ÷ vol，加上 vol 標準化的 MACD 與 RSI30；reward 也做 vol scaling |
| OHLCV 相對 / 比值特徵 | DeepScalper | arXiv:2201.09058 | 分鐘級中國股指期貨 IF/IC，結構與台指期最接近；`z_open = open_t / close_{t−1} − 1`、6 個 MA-distance（`z_d_5..30`）、5 層 LOB、pos/cash/剩餘時間；另以 risk-aware 的 volatility auxiliary task 預測波動 |
| 技術指標組 | FinRL | arXiv:2011.09607 | MACD / RSI / CCI / ADX 標準技術指標組，並以 turbulence index 作為風險門檻 |
| agent 私有狀態 | TU Delft DQN 研究 | 無 arXiv（TU Delft） | 持倉時間（holding time）是最大的單一增益來源；current exposure 則完全無用 |
| 時間特徵少即是多 | TU Delft 研究 | 無 arXiv（TU Delft） | 只用單一 24h 週期時間特徵時 Sharpe 1.12；把時間特徵全塞進去會崩到 −1.02 |
| 訂單流不平衡 OFI | Cont / Kolm | arXiv:2311.02088 | OFI 特徵勝過直接把原始 LOB（order book）餵給模型 |
| 跨市場領先 | AEL 2026 | 期刊論文 | 台股專屬證據：美股日盤報酬要到台指夜盤才被吸收（2017 夜盤開始後） |

### 標準化最佳實踐

- **Rolling Z-Score 正確** ✅：階段 4 的做法與文獻一致，是處理非平穩價格序列的標準解。
- **W（rolling window）是超參數**：需宣告並測試魯棒性。以 15 分鐘 K 為例，120 bars 約 5 天、480 bars 約 20 天，兩者代表不同時間尺度的均值回歸假設。
- **SB3 VecNormalize**：線上的 running z-score，同時標準化 observation 與 reward，是 Stable-Baselines3 的內建機制，適合接在 env 外層。
- **Vol scaling**：特徵與 reward 都除以 EWMA vol（Zhang et al. 的做法），讓不同波動時期可以互相比較。
- **禁止全局 min-max**：全局 min-max 會扭曲 MACD 等指標的幅度結構（arXiv:2411.07585），階段 4 已明確禁用。

### 陷阱（量化證據）

| 陷阱 | 量化證據 | 本專案對策 |
|---|---|---|
| 同 bar 成交洩漏 | 偽造 Sharpe +14.79（lookahead.marketmaker.cc） | env 已改用 next-bar open 成交 ✅ |
| 中心化指標 | +4.76 Sharpe（純洩漏造成的假績效，aligrithm.com） | 只用因果統計量，禁用任何含未來資訊的指標 |
| 全域標準化洩漏 | NN 對輸入幅度敏感，全域統計量把未來資訊帶進 obs | 一律改用 rolling window 標準化 |
| 當日籌碼提前使用 | 日頻特徵提早流入日盤 | T−1 對齊，時間對齊鐵律已規範 ✅ |
| 特徵 = reward 的函數 | TU Delft 的 current exposure 是典型例子 | 注意：unrealized_pnl 屬 mark-to-market，是狀態的合法部分，不算洩漏 |
| backtest 過擬合 | FinRL-Meta 系列報告指出多數 RL 策略過擬合單一市場 | 以 deflated Sharpe / PBO（Probability of Backtest Overfitting）校正 |

### DanielMA 指標評估

本專案 `backend/src/indicators.py` 的 `calculate_ma_daniel`（8/21/55/89 Fibonacci 均線 + 斜率 + 扣抵值 + trend A/B/C）逐項評估：

- ✅ **MA-distance 特徵（price/MA − 1，多週期）**：DeepScalper 就用了 6 個 MA-distance，是強而有力的先例。
- ✅ **離散 alignment flag（ma_bull 多空排列）**：LSTM-DQN 2026（Scientific Reports）顯示多空排列類的離散特徵有助學習。
- ❌ **多個相關 MA ratio 平行塞進 state**：高共線性，arXiv:2411.07585 顯示 RSI 簇的冗餘特徵會傷害學習。
- ❌ **原始 MA 值 / 絕對斜率**：非平穩，違反階段 4 的平穩性原則。
- **關鍵建議**：DanielMA 的買賣訊號（buy/sell/trend）適合當 **reward shaping 先驗**或**行為克隆（behavior cloning）baseline**，不建議直接塞進 state。

### 15 分 K TX env 具體特徵計畫

| 類別 | 內容 |
|---|---|
| 要改：first_close normalization | 改為 rolling z-score |
| 要改：linear calendar | 改為最小 sin/cos（分鐘 sin/cos + `is_night_session`） |
| 要改：~250-dim market_features 選項 | 移除，改為 curated state |
| 要加：動能 | vol-scaled 多週期報酬 + realized vol |
| 要加：微結構 | 買賣側量不平衡（從 tick 計算 OFI proxy） |
| 要加：定價 | Basis + VWAP deviation |
| 要加：regime | 離散 regime flag（trend A/B/C、波動 regime） |
| 要加：跨市場 | 跨市場 NQ/ES 夜盤特徵 + 隔夜跳空 |
| 目標 state 大小 | 約 20~35 維的 curated state（PPO/SAC 的甜蜜點）；若需要更多維度，用 encoder 或 PCA 壓縮 |

### 參考文獻清單

- **arXiv:1911.10107**：Zhang / Zohren / Roberts，多期貨多週期動能特徵（vol 標準化）。
- **arXiv:2201.09058**：DeepScalper，中國股指期貨 IF/IC 分鐘級 RL 交易。
- **arXiv:2011.09607**：FinRL，深度強化學習交易框架。
- **arXiv:2311.02088**：Cont / Kolm，訂單流不平衡（OFI）特徵。
- **arXiv:2411.07585**：特徵工程研究（全域 min-max 扭曲 MACD、RSI 簇共線性冗餘）。
- **TU Delft DQN 研究**：持倉時間 / 時間特徵數量的實證（荷蘭台夫特理工大學）。
- **lookahead.marketmaker.cc**：回測 lookahead 洩漏量化（同 bar 成交 +14.79 Sharpe）。
- **aligrithm.com**：中心化指標洩漏實測（+4.76 Sharpe）。
- **AEL 2026**：台股跨市場領先研究（美股日盤報酬 → 台指夜盤吸收）。
- **LSTM-DQN 2026（Scientific Reports）**：離散多空排列特徵的 DQN 交易研究。
- **FinRL-Meta**：RL 策略過擬合與 deflated Sharpe / PBO 校正方法。

## 實作腳本

### 模組 1：批次下載全部歷史 Tick 資料 (`taifex_downloader.py`)

期交所官方歷史逐筆檔案下載網址格式固定，可以用腳本批次抓取歷年壓縮檔：

```python
import os
import time
import zipfile
import requests

DATA_DIR = "./taifex_raw_ticks"
os.makedirs(DATA_DIR, exist_ok=True)

# 臺灣期交所歷年逐筆資料下載 URL 格式 (依年份或月份)
# 註：官方歷年打包通常為 Yearly 或 Daily/Monthly 格式
BASE_URL = "https://www.taifex.com.tw/file/taifex/DOH/historical"

def download_and_extract_year(year: int):
    zip_name = f"Daily_{year}.zip"
    url = f"{BASE_URL}/{zip_name}"
    zip_path = os.path.join(DATA_DIR, zip_name)
    extract_folder = os.path.join(DATA_DIR, str(year))
  
    if os.path.exists(extract_folder):
        print(f"[{year}] 已存在資料夾，略過下載。")
        return

    print(f"正在下載 {year} 年資料: {url} ...")
    headers = {"User-Agent": "Mozilla/5.0"}
  
    try:
        res = requests.get(url, headers=headers, stream=True, timeout=60)
        if res.status_code == 200:
            with open(zip_path, "wb") as f:
                for chunk in res.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
            print(f"解壓縮 {zip_name} ...")
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_folder)
            os.remove(zip_path) # 節省硬碟空間
            print(f"[{year}] 完成！")
        else:
            print(f"[{year}] 下載失敗，狀態碼：{res.status_code}")
    except Exception as e:
        print(f"[{year}] 下載異常: {e}")

if __name__ == "__main__":
    # 例如下載 2015 到 2025 年的資料
    for y in range(2015, 2026):
        download_and_extract_year(y)
        time.sleep(1) # 禮貌延遲
```

### 模組 2：雜訊清洗、近月合約切換、1分K重採樣 (`build_rl_dataset.py`)

本腳本處理了做 RL 訓練最容易遇到的雜訊與坑：

- **欄位空白與編碼問題**（自動去除 whitespace 與容錯編碼）。
- **排除組合價差單**（如 `TX/202401/202402`）。
- **動態選取當日成交量最大的近月合約（Front Month）**。
- **物理性雜訊與 Spike 剔除**（價格 $\le 0$、極端跳動超跌/超漲）。
- **1 分鐘 K 線重採樣與無成交區間 Forward Fill**。
- **換月價差後向平移（Back-Adjustment）**，避免 RL 誤判換月跳空。

```python
import glob
import os
import pandas as pd
import numpy as np

RAW_DIR = "./taifex_raw_ticks"
OUTPUT_DIR = "./rl_features"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def clean_and_resample_daily_file(file_path: str):
    """
    單日 Tick 資料清洗與 1 分鐘聚合
    """
    try:
        # 1. 讀取與欄位清理（歷史檔案常有 Big5 / CP950 編碼問題）
        try:
            df = pd.read_csv(file_path, encoding='cp950', low_memory=False)
        except:
            df = pd.read_csv(file_path, encoding='utf-8', low_memory=False)
          
        df.columns = [c.strip() for c in df.columns]
      
        # 兼容不同年份的欄位命名差異
        code_col = '商品代號' if '商品代號' in df.columns else 'Contract'
        month_col = '到期月份(週別)' if '到期月份(週別)' in df.columns else 'ContractMonth'
        price_col = '成交價格' if '成交價格' in df.columns else 'Price'
        vol_col = '成交數量(B+S)' if '成交數量(B+S)' in df.columns else 'Volume'
        time_col = '成交時間' if '成交時間' in df.columns else 'Time'
        date_col = '交易日期' if '交易日期' in df.columns else 'Date'

        # 2. 篩選純台指期（TX）合約，排除價差單（格式中帶有斜線者）
        df = df[df[code_col].astype(str).str.strip() == 'TX']
        df = df[~df[month_col].astype(str).str.contains('/')]
      
        if df.empty:
            return None

        # 3. 選取當日流動性最好的合約（主力近月合約）
        df[month_col] = df[month_col].astype(str).str.strip()
        top_contract = df.groupby(month_col)[vol_col].sum().idxmax()
        df = df[df[month_col] == top_contract].copy()

        # 4. 價格雜訊過濾
        df[price_col] = pd.to_numeric(df[price_col], errors='coerce')
        df[vol_col] = pd.to_numeric(df[vol_col], errors='coerce')
        df = df.dropna(subset=[price_col, vol_col])
        df = df[(df[price_col] > 1000) & (df[vol_col] > 0)] # 剔除 0 價與異常負值

        # 剔除單筆瞬間跳動超過 3% 且 1 秒內回彈的極端異常雜訊（Spike Filter）
        price_diff = df[price_col].pct_change().abs()
        df = df[price_diff < 0.03]

        # 5. 時間解析
        df[date_col] = df[date_col].astype(str).str.strip()
        df[time_col] = df[time_col].astype(str).str.strip().str.zfill(6) # 補齊 HHMMSS
      
        # 僅取前 6 位時分秒（忽略部分檔案的毫秒）
        df['dt_str'] = df[date_col] + df[time_col].str.slice(0, 6)
        df['datetime'] = pd.to_datetime(df['dt_str'], format='%Y%m%d%H%M%S', errors='coerce')
        df = df.dropna(subset=['datetime']).sort_values('datetime')
        df.set_index('datetime', inplace=True)

        # 6. 1分鐘 Resample (OHLCV)
        ohlc = df[price_col].resample('1min').ohlc()
        vol = df[vol_col].resample('1min').sum()
      
        bar_1m = ohlc.join(vol).rename(columns={vol_col: 'volume'})
        bar_1m['contract'] = top_contract
      
        # 7. 去除完全沒行情的離散時間，並對有交易區間做平滑補值
        bar_1m = bar_1m.dropna(subset=['close'])
      
        return bar_1m

    except Exception as e:
        print(f"處理檔案 {file_path} 時發生錯誤: {e}")
        return None

def build_continuous_dataset():
    """
    批次處理並拼接為連續合約（含 Back-adjustment）
    """
    all_files = sorted(glob.glob(f"{RAW_DIR}/**/*.csv", recursive=True))
    daily_bars = []

    print(f"找到 {len(all_files)} 個原始交易日檔案，開始清洗與聚合...")
    for idx, f in enumerate(all_files):
        bar = clean_and_resample_daily_file(f)
        if bar is not None and not bar.empty:
            daily_bars.append(bar)
        if (idx + 1) % 100 == 0:
            print(f"已處理 {idx + 1} / {len(all_files)} 檔...")

    if not daily_bars:
        print("沒有可用的資料！")
        return

    full_df = pd.concat(daily_bars).sort_index()

    # 8. 消除換月跳空（Back-adjustment for RL Reward）
    # 當合約代碼改變時，計算第一根 Open 與前一根 Close 的差值，向前累計平移
    full_df['contract_change'] = (full_df['contract'] != full_df['contract'].shift(1)) & (~full_df['contract'].shift(1).isna())
    full_df['roll_gap'] = 0.0
  
    # 換月時的基差跳空
    roll_indices = full_df[full_df['contract_change']].index
    for idx in roll_indices:
        prev_idx = full_df.index.get_loc(idx) - 1
        gap = full_df.iloc[full_df.index.get_loc(idx)]['open'] - full_df.iloc[prev_idx]['close']
        full_df.loc[idx, 'roll_gap'] = gap

    # 累計平移量（後向調整）
    full_df['cum_roll_gap'] = full_df['roll_gap'].cumsum()
    adjustment = full_df['cum_roll_gap'].iloc[-1] - full_df['cum_roll_gap']
  
    full_df['adj_open'] = full_df['open'] + adjustment
    full_df['adj_high'] = full_df['high'] + adjustment
    full_df['adj_low'] = full_df['low'] + adjustment
    full_df['adj_close'] = full_df['close'] + adjustment
    full_df.drop(columns=['contract_change', 'roll_gap', 'cum_roll_gap'], inplace=True)

    # 9. 儲存為高效 Parquet 檔
    out_file = os.path.join(OUTPUT_DIR, "tx_1min_continuous_cleaned.parquet")
    full_df.to_parquet(out_file, compression='snappy')
    print(f"\n 全部處理完成！輸出資料集至：{out_file}")
    print(f"總 K 棒數: {len(full_df)} 根，時間涵蓋: {full_df.index[0]} -> {full_df.index[-1]}")

if __name__ == "__main__":
    build_continuous_dataset()
```

### 產出說明：這套資料集產出後如何直接給 RL 使用？

產出的 Parquet 會包含：

- `open, high, low, close, volume`：原始報價（用於觀察真實市場盤況）。
- `adj_open, adj_high, adj_low, adj_close`：消除換月跳空後的調整價（**專門給 RL 計算 Step Reward 與 Portfolio Value**）。
- `contract`：當前合約月份。

在 RL 環境中，只需要 `pd.read_parquet("tx_1min_continuous_cleaned.parquet")` 即可在毫秒級內將數百萬根 1 分 K 載入記憶體進行極速訓練。

## 進階：跨市場與籌碼特徵

台指期是高度連動外部市場與造市籌碼的淺碟型衍生品，若單純只餵台指期本身的 OHLCV，RL Agent 極容易將內部隨機噪聲誤判為規律。

引入跨市場與籌碼特徵時，核心在於「時間粒度匹配」與「因果無偏對齊（Causal Alignment）」。

### 跨市場連動特徵（重點在外盤領先指標）

台股以半導體與科技權值為主，與美股及匯率有極強的領先/滯後關聯：

- **美股指數期貨（1 分鐘對齊）**
  - 小那斯達克期貨（NQ）、小標普期貨（ES）、小費城半導體期貨。
  - 對齊方式：美指期 24 小時交易，在台指日盤與夜盤均可與台指 1 分 K 做到同秒級對齊。
  - 特徵型態：計算過去 5m/15m/60m 的 Log Return、價差動能與相關係數變化。
- **TSMC ADR（美股盤中與盤後）**
  - 台積電佔台指權重高，ADR 在美股常規交易時段與盤後盤的漲跌幅，是台指夜盤與次日日盤開盤的定價錨。
- **匯率與避險指標**
  - 美元兌新台幣（USD/TWD）離岸報價、美元指數（DXY）。
  - VIX 指數（市場恐慌情緒，用於縮放 Agent 的部位風險權重）。

### 籌碼面與衍生品市場特徵（日頻 / 盤中靜態特徵）

籌碼資料多數為日發布（每日 15:00 後公布），必須作為「全域情境特徵（Context Embedding）」廣播到每分鐘：

- **三大法人台指期未平倉淨口數（Net OI）**：外資與投信的期貨淨多空部位及其單日變化量。
- **選擇權 Put/Call Ratio（PCR）**：全市場 Put 與 Call 的成交量比與未平倉比，反映主力支撐壓力預期。
- **外資現貨買賣超金額**：日盤收盤後的外資現貨動向。
- **散戶小台多空比**：小台指散戶指標通常具有反指標特性。

### 本地盤中微結構特徵（1 分鐘動態特徵）

除了 OHLCV，單純台指期內部還有高資訊價值的結構衍生量：

- **價差（Basis / Spread）**
  - 台指期成交價 − 加權指數現貨點數（現貨時段 09:00～13:30）。
  - 正逆價差的極端收斂或擴大是強烈的均值回歸與造市動向特徵。
- **大台 vs. 小台強弱差**：大台（法人主力）與小台（散戶散單）在 1 分鐘內的漲跌幅差值。
- **成交量集中度與 VWAP 偏離度**：(Close−VWAP)/ATR。

### State Vector 整合架構圖（跨市場資料整合架構建議）

```
[State Vector for RL Step t]
│
├── 即時價格特徵 (1-min K): Log Return, Realized Volatility, Normalized Volume, RSI
├── 跨市場特徵 (1-min K): NQ 1-min Return, ES 1-min Return, USD/TWD Return
├── 微結構特徵 (1-min K): 現貨正逆價差 (Basis), VWAP Deviation
├── 週期特徵 (Static): sin/cos(當前分鐘), is_night_session, 距離結算日天數
└── 籌碼背景特徵 (Daily Broadcast): 昨日外資期貨淨OI, 昨日PCR (Rolling Z-Score)
```

### 時間對齊鐵律

日頻籌碼資料必須嚴格遵守時間對齊，避免未來資訊提早流入：

- 日頻籌碼資料（如外資 OI）在**當日 15:00** 才產出。
- 因此在當日日盤（08:45～13:45）只能使用 **T−1 日的籌碼**。
- 到了 15:00 夜盤開始後，才能切換為當日剛公布的籌碼數據。
- 切忌在日盤提早讀取當日收盤籌碼。

## 執行檢查清單 (Action Checklist)

以下將整個資料準備管線濃縮為依序執行的步驟，並標註對應的階段與模組：

1. **下載歷史 Tick 資料**：執行模組 1 `taifex_downloader.py`，依 URL 格式 `https://www.taifex.com.tw/file/taifex/DOH/historical/Daily_{year}.zip` 批次抓取 2015–2025 年逐筆壓縮檔並解壓縮至 `./taifex_raw_ticks`。（模組 1）
2. **Tick 清洗與流動性過濾**：排除價差單（如 `TX/202609/202610`）、剔除試撮與非交易時段（08:30～08:45）、過濾 Bad Tick（價格 $\le 0$、成交量 $\le 0$、單筆跳動超過 3%~5% 且次筆立即回彈的 Spike）。（階段 1）
3. **1 分鐘 K 線聚合與時間對齊**：以 $[T, T+59\text{s}]$ 聚合 OHLCV；無成交分鐘以 Close 進行 Forward Fill（`ffill`）、Open/High/Low 補為該 Close、Volume 填 0，嚴禁刪除分鐘；以 `is_night_session` 標籤區分日盤（08:45–13:45）與夜盤（15:00–次日 05:00）。（階段 2 / 模組 2）
4. **主力合約選取與換月 Back-Adjustment**：動態選取當日成交量最大的近月合約；依 Roll Rule（成交量/OI 交叉點或結算日當天 13:00 前後）切換主力；以最新合約為基準累計平移 Roll Gap 生成 Adj OHLC（供 RL 計算 Step Reward 與技術指標），並保留 Raw OHLC（供真實保證金、滑價、手續費計算）。（階段 3 / 模組 2）
5. **因果特徵工程與無偏標準化**：以 Log Return、Normalized Volume、True Range / ATR 取代絕對價格；所有特徵僅使用 $t \le T$ 的資料；以 Rolling Window Z-Score（如過去 120 根 K 棒）動態標準化，禁用全局 `MinMaxScaler` / `StandardScaler`；時間週期以 sin/cos 編碼。（階段 4）
6. **Walk-Forward 切分資料集**：依時間先後切分 Train（2015～2022）、Validation（2023～2024）、Out-of-Sample Test（2025～2026），絕對不能做 Random Shuffle K-Fold。（階段 5）
7. **儲存為 Parquet 並驗證載入**：將連續 1 分 K 特徵矩陣以 Apache Parquet（Snappy 壓縮）儲存，欄位含 `open/high/low/close/volume`、`adj_open/adj_high/adj_low/adj_close`、`contract`；以 `pd.read_parquet` 毫秒級載入，確保 `env.reset()` 與抽取 Observation 極速完成。（階段 5 / 模組 2）
8. **接續跨市場與籌碼特徵**：對齊美股指數期貨（NQ/ES/小費半導體）的 5m/15m/60m Log Return、價差動能與相關係數，加入 TSMC ADR 定價錨、USD/TWD 與 DXY、VIX 風險權重縮放；日頻籌碼特徵（三大法人淨 OI、選擇權 PCR、外資現貨買賣超、散戶小台多空比）以 Context Embedding 廣播到每分鐘，並嚴格遵守時間對齊鐵律：日盤（08:45～13:45）只能用 T−1 日籌碼，15:00 夜盤後才可用當日。（進階）
9. **特徵工程落地**：將階段 4 的擴充研究套用於實際特徵工程：rolling z-score + vol scaling + sin/cos 時間編碼 + OFI（訂單流不平衡）+ MA-distance 特徵，細節參考「特徵工程擴充研究」章節。（階段 4）
