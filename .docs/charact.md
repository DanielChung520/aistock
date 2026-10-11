# 特徵值（Feature / 特征值）定義 — 設計對齊筆記

> 目的：在實作「生成特征值」功能前，先對齊我們對每一項特徵的理解。
> 資料基礎：`stock_daily_o1c1`（10 年 OHLCV + O1/C1，138,300 docs）、
> `stock_institutional_flows`（法人買賣超）、`stock_margin`（融資融券）、`stock_monthly_revenue`（月營收）。
> 計算原則（G9）：所有指標與特徵一律在後端（FastAPI）計算，前端不計算。
> 特徵的輸入欄位：date / open / high / low / close / volume / o1 / c1。

---

## 零、資料欄位速覽

| 欄位 | 說明 |
|---|---|
| `open` / `high` / `low` / `close` | 日 K 開高低收 |
| `volume` | 成交量 |
| `o1` | 開盤 1 小時收盤價（早盤動能） |
| `c1` | 收盤 1 小時收盤價（尾盤動能） |
| `o1c1_preserved` | 是否保留原始 O1/C1（0 = 無損） |

O1 / C1 的用途：
- 拆「三盤」：早盤 = open→o1、中盤 = o1→c1、尾盤 = c1→close
- O1-C / C1-C 價差：盤中強弱
- K 線形態的 o1/c1 版本

---

## 〇・市場指數（市場環境維度）

### 目的

特徵值需要「大盤環境」維度，才能算個股相對強弱（RS）、系統性風險與美股隔夜效應。
目前 `/market/taiex` 僅即時抓取不入庫，本次補齊並**入庫儲存**。

### 指數清單（預設，可在功能設置中增刪）

| 類別 | 指數 | yfinance 代號 | 用途 |
|---|---|---|---|
| 台股 | 加權指數 | `^TWII` | 台股大盤 |
| 台股 | 櫃買指數 | `^TWO` | 中小型股 |
| 亞股 | 日經 225 | `^N225` | 亞股連動 |
| 亞股 | 恆生 | `^HSI` | 亞股連動 |
| 亞股 | 上證 | `000001.SS` | 中國市場 |
| 亞股 | 韓國 KOSPI | `^KS11` | 亞股連動 |
| 美股 | 費城半導體（SOX） | `^SOX` | 台股電子最重要 |
| 美股 | 那斯達克 | `^IXIC` | 美股科技 |
| 美股 | 標普 500 | `^GSPC` | 美股大盤 |
| 美股 | 道瓊 | `^DJI` | 美股藍籌 |

### 回補策略（已定案）

- **回補 2 年**（訓練只用 2 年資料），非 10 年。
- yfinance 指數皆有超過 2 年歷史，一次回補 + 排程每日增量。
- 沿用 `research_download.py` 的 Celery task 模式，完全符合 G1/G3 guardrail。

### 資料庫規格

- **collection**：`market_index_daily`
- **key 慣例**：`{symbol}_{date}`（如 `TWII_2026-08-07`）
- **欄位**：`_key`、`symbol`（如 `TWII`）、`yf_symbol`（如 `^TWII`）、`name`（加權指數）、`category`（台股/亞股/美股）、`date`、`open`、`high`、`low`、`close`、`volume`
- **清單來源**：功能設置（`/admin/menu`）中維護的指數清單 collection（見第八章決策）

---

## 〇・參數化總則（重要）

- **MA[a]、MV[v] 的週期 a、v 是變數**（使用者可配置），不是固定值。
  特徵欄位名動態生成：`slope_ma{a}`、`slope_ma{b}`、`slope_mv{v}`、`spread[a,b]` …。
- 同一套計算函式套用到所有週期；實作時以參數傳入週期清單（如 MA [8,13,21]、MV [5,10]），
  不允許在計算邏輯中硬編碼週期。
- 三盤突破/跌破的「前兩根」（i-1, i-2）為固定窗口，不隨 MA 週期變動。
- RSI(14)、KDJ(9,3,3)、MACD(12,26,9) 亦為可配置參數（沿用 `IndicatorSettings` 預設）。

---

## 一、漲幅與 MA / MV 斜率、二次斜率

### 0. 漲幅 / 連續兩天漲幅

- **漲幅（pct_change）**：單日漲跌幅（%），最基礎的價格動能。
- **連續兩天漲幅**：拆成兩個特徵 — 兩日累計漲幅（數值）＋ 連續兩天收漲（布林）。

```
pct_change[i]     = (close[i] - close[i-1]) / close[i-1] * 100        # 單日漲幅（%）
pct_change_2d[i]  = (close[i] - close[i-2]) / close[i-2] * 100        # 兩日累計漲幅（%）
up_2d[i]          = close[i] > close[i-1] and close[i-1] > close[i-2] # 連續兩天收漲（0/1）
```

| 特徵 | 公式 | 意義 |
|---|---|---|
| `pct_change` | 單日漲跌幅（%） | 短線動能基礎 |
| `pct_change_2d` | 兩日累計漲幅（%） | 連續兩天漲幅（數值） |
| `up_2d` | 連續兩天收漲（0/1） | 連續兩天漲幅（布林） |

### 1. MA / MV 一次斜率、二次斜率

### 定義

- **一次斜率（slope）**：單位時間的百分比變化率，捕捉趨勢方向與速度。
- **二次斜率（slope2）**：一次斜率的斜率，捕捉「加速度」＝動能轉折前兆。

### 公式（MA[a] 為變數，a 為可配置週期）

```
MA[a][i]          = 週期 a 的移動平均（SMA 或 EMA）
slope_ma[a][i]    = (MA[a][i] - MA[a][i-1]) / MA[a][i-1] * 100     # 一次斜率（%）
slope2_ma[a][i]   = (slope_ma[a][i] - slope_ma[a][i-1]) / slope_ma[a][i-1] * 100   # 二次斜率（加速度）＝對一次斜率再套用一次
```

> ⚠️ **MA[a]、MV[v] 的週期 a、v 是變數**（使用者可配置），不是固定值。
> 特徵欄位名動態生成：`slope_ma{a}`、`slope2_ma{a}`、`slope_mv{v}`、`slope2_mv{v}`。
> 同一套計算函式套用到所有週期，實作時以參數傳入週期清單即可。

> 注意：二次斜率是「斜率的斜率」，不是「價格的二次差分」。

### 特徵清單（a ∈ MA 週期清單，v ∈ MV 週期清單）

| 特徵 | 公式 | 意義 |
|---|---|---|
| `slope_ma{a}` | `MA[a]` 一次斜率 | 短/中線動能 |
| `slope2_ma{a}` | `MA[a]` 二次斜率 | 動能加速/減速 |
| `slope_mv{v}` | `MV[v]` 一次斜率 | 量能趨勢 |
| `slope2_mv{v}` | `MV[v]` 二次斜率 | 量能加速 |

> 例：MA 週期 [8, 13, 21] → `slope_ma8`、`slope_ma13`、`slope_ma21`、`slope2_ma8`、...
> MV 週期 [5, 10] → `slope_mv5`、`slope_mv10`、`slope2_mv5`、`slope2_mv10`。

> 既有實作參考：`backend/src/indicators.py` 的 `_slope_series()` 已提供一次斜率，
> 二次斜率可對其輸出再套用一次。

---

## 二、RSI / MACD / KDJ 上下限均值

### 定義

把指標值放在「上下限之間」的相對位置，量化超買超賣程度與均值回歸潛力。

### RSI（有固定上下限 0~100，慣用 30 / 70）

| 特徵 | 公式 | 意義 |
|---|---|---|
| `rsi` | 原始 RSI(14) | 0~100 有界值 |
| `rsi_pos` | `rsi / 100` | 標準化位置（0~1） |
| `rsi_dist_upper` | `70 - rsi` | 距超買線距離（負 = 已超買） |
| `rsi_dist_lower` | `rsi - 30` | 距超賣線距離（負 = 已超賣） |

### KDJ（有固定上下限 0~100）

| 特徵 | 公式 | 意義 |
|---|---|---|
| `kdj_k` / `kdj_d` / `kdj_j` | 原始 K/D/J | 主值 |
| `kdj_pos` | `k / 100` | 標準化位置 |
| `kdj_golden` | `K 上穿 D`（0/1） | 黃金交叉 |
| `kdj_dead` | `K 下穿 D`（0/1） | 死亡交叉 |

### MACD（無固定上下限 → 用滾動分位當上下限）

| 特徵 | 公式 | 意義 |
|---|---|---|
| `macd_dif` / `macd_signal` / `macd_hist` | 原始 DIF / DEA / 柱 | 主值 |
| `macd_hist_norm` | `hist / close * 100` | 標準化柱體（跨股可比） |
| `macd_pos` | `percentile_rank(hist, 250)` | 柱體在近 250 日分位（0~1） |
| `macd_cross_up` / `macd_cross_down` | DIF 上穿/下穿 DEA（0/1） | 交叉訊號 |

> 關鍵設計：MACD 沒有天然上下限，`macd_pos` = 近 250 日 `percentile_rank(hist)`（0~1，
> 越大代表越接近歷史高值），比原始值穩定，適合 ML 特徵。5% / 95% 分位僅為解讀參考。

---

## 三、MA 均線發散

### 定義

多條 MA 之間的排列與張開程度。多頭排列（短 > 中 > 長，如 MA8 > MA13 > MA21）＝發散向上；
空頭排列（MA8 < MA13 < MA21）＝發散向下；交叉纏繞＝收斂整理。

### 學術基礎（2026 整理）

MA 發散強度有成熟的數學模型可參考，主流共識是「**短均線 / 長均線的比率（或離 1 的距離）**」+「**排列關係的連續打分**」：

| 模型 | 核心量 | 出處 | 對應設計 |
|---|---|---|---|
| **MAD**（Moving Average Distance） | `MA_short / MA_long` 比率、離 1 的距離 | Avramov, Kaplanski & Subrahmanyam (2023)：21/200 日均線距離對未來報酬有顯著預測力（錨定效應） | `spread_over` 的學術原型 |
| **MAR**（Moving Average Ratio） | `MA_short / MA_long` 比率 | Arena (2010, JFQA)：比率對報酬有預測力，與 52 週高點距離結合可解釋動能報酬 | 比率化設計 + 可加 `near_52w_high` 交互 |
| **MASS**（均線排列打分） | 依均線相對關係對市場狀態連續打分 | 申萬宏源：趨勢方向 + 強弱定量描述（上證綜指年化 22%、夏普 0.82） | 下方 B 的連續打分版本 |
| **趨勢估計標度** | `μ̂ ≈ 2/(n1−n2) · (MA_short − MA_long)` | Roncalli, "Trend Filtering Methods for Momentum"：標度因子 2/(n1−n2) 由報酬加權三角形核推導 | 下方發散度的加權方式 |
| **MA Slope 標準化** | `slope = (MA_c − MA_n) / n`，需除以 ATR 或百分比 | LuxAlgo 實務庫 / QuantifiedStrategies：原始斜率跨股不可比，角度（度）不可靠 | 斜率一律百分比化（可加 ATR 版） |

> 實證重點（MAD 論文）：**短均線偏離長均線越多 → 後續 drift 越大**（投資人錨定長均線而反應不足）。
> 這支持把「發散度」直接當連續特徵餵給 ML，而不是只看多空方向。

### A. 連續發散度（數值，抓「力度」）— 採 MAD / MAR 比率形式

> ⚠️ MA[a]、MA[b] 的週期 a、b 是**變數**（使用者可配置）。以下公式以 8/13/21 為例，
> 實際以設定傳入的週期清單動態生成所有成對組合。

```
spread[a,b]  = MA[a] / MA[b] - 1         # 任兩週期 a、b 的發散（負 = MA[a]<MA[b]）
spread_over  = MA[a_min] / MA[a_max] - 1 # 最短 vs 最長：整體多空力度（MAD/MAR 核心）
divergence   = Σ (w[a,b] · spread[a,b])  # 發散總強度（加權，見下）
divergence_delta = divergence - divergence[-1]       # 發散動量（張開中 or 收斂中）
```

加權方式（依 Roncalli 標度，讓不同週期組合可比）：
```
w[a,b] = 2 / (b - a)        # 週期差越大權重越小
```

以週期 [8, 13, 21] 為例：
```
spread[8,13]  = MA8 / MA13 - 1     w = 2/(13-8) = 0.4
spread[13,21] = MA13 / MA21 - 1    w = 2/(21-13) = 0.25
spread[8,21]  = MA8 / MA21 - 1     w = 2/(21-8) = 0.154
divergence    = 0.4·spread[8,13] + 0.25·spread[13,21] + 0.154·spread[8,21]
```

> 空頭排列（MA8 < MA13 < MA21）→ `spread[8,13] < 0` 且 `spread[13,21] < 0`；
> 多頭排列（MA8 > MA13 > MA21）→ 兩者皆 `> 0`，由符號即可捕捉。

### B. 排列狀態（離散，抓「形態」）— 連續打分 + bit 狀態

**B-1 連續排列打分（MASS 風格，平滑）**：

```
alignment_score = Σ ( sign(MA[a] - MA[b]) · |MA[a] / MA[b] - 1| )  for each pair (a, b)
```

→ 多頭排列為正值、空頭排列為負值、纏繞趨近 0；幅度越大代表發散越徹底。

**B-2 排列狀態編碼（離散，狀態分類）**：

對每對 MA 取 `sign(MA[a] - MA[b])`，N 條線 → C(N,2) 個 bit → 固定數量的排列狀態：

```
bit0 = MA8 vs MA13、bit1 = MA8 vs MA21、bit2 = MA13 vs MA21
（bit = 1 代表 MA[短] > MA[長]）
```

| 狀態 | bit | 含義 |
|---|---|---|
| `111` | 7 | 完全多頭排列（MA8 > MA13 > MA21） |
| `000` | 0 | 完全空頭排列（MA8 < MA13 < MA21） |
| 其他 | 1~6 | 纏繞 / 交叉中 |

→ one-hot 編碼或直接當整數狀態特徵。

> 建議：A（連續發散度）抓力度、B-1（連續打分）抓排列強度、B-2（bit 狀態）抓形態，三者並存。
> B-1 與 B-2 資訊有重疊（皆由排列決定），實作時可評估共線性後擇一或並存。

> 建議：A（連續值）抓力度、B（離散值）抓形態，兩者並存。

---

## 四、三盤突破 / 三盤跌破

### 定義（已對齊）

- **三盤突破**：「三盤」指連續三根 K 線（前兩根 + 最新一根）。
  最新一根 K 線的收盤價**向上突破前兩根 K 線的最高價**（「一過二」排列），
  通常伴隨成交量放大。意義：買方積極追價、多方優勢擴大，短線強勢、波段起漲或突破整理區的切入點。
- **三盤跌破**：最新一根 K 線**向下跌破前兩根 K 線的最低價**（「一破二」排列）。
  意義：短線賣壓湧現、情緒轉保守，漲多後的快速修正或突破回測失敗的警訊（不等於絕對空頭）。

### 公式（以 close 確認版為例）

```python
# 三盤突破（一過二）
three_up      = closes[i] > max(highs[i-1], highs[i-2])
three_up_str  = (closes[i] / max(highs[i-1], highs[i-2]) - 1) * 100      # 突破幅度（%）
three_up_vol  = three_up and volumes[i] > volumes[i-1] and volumes[i] > volumes[i-2]

# 三盤跌破（一破二）
three_down      = closes[i] < min(lows[i-1], lows[i-2])
three_down_str  = (closes[i] / min(lows[i-1], lows[i-2]) - 1) * 100
three_down_vol  = three_down and volumes[i] > volumes[i-1] and volumes[i] > volumes[i-2]
```

### 特徵清單

| 特徵 | 型別 | 說明 |
|---|---|---|
| `three_up` / `three_down` | 0/1 | 基本旗標 |
| `three_up_str` / `three_down_str` | 連續值 | 突破/跌破幅度（%），抓力道 |
| `three_up_vol` / `three_down_vol` | 0/1 | 帶量突破/跌破（更嚴格） |
| `three_state` | 0/1/2 | 0=無訊號、1=三盤突破、2=三盤跌破（可當 label） |

### 變體（可選）

- **high 突破版**：`high[i] > max(high[i-1], high[i-2])`（盤中即算，較寬鬆）vs close 版（收盤確認，較嚴格）
- **O1/C1 版**：用 o1、c1 取代 close 判三盤，捕捉盤中強弱

> 既有實作參考：Daniel MA（`calculate_ma_daniel`）的買進條件已內建 `cond3up`
> （`closes[i] > highs[i-1] and closes[i] > highs[i-2]`）＝三盤突破。
> 但 Daniel MA 的賣出條件用的是斜率加速度轉折，**沒有**三盤跌破——跌破是全新特徵。

---

## 五、K 線形態（酒田戰法可程式化子集）

### 定義

用 OHLC 的相對關係做布林判定，每個形態 = 0/1 特徵。

### 特徵清單（第一版建議）

| 形態 | 判定（簡化） | 意義 |
|---|---|---|
| `candle_long_body_up` | 收 > 開 且實體 ≥ 前 N 日平均實體 × 1.5 | 長紅 |
| `candle_long_body_down` | 收 < 開 且實體 ≥ 前 N 日平均實體 × 1.5 | 長黑 |
| `candle_doji` | \|收-開\| ≤ 全距 × 0.1 | 十字線（變盤） |
| `candle_hammer` | 下影 ≥ 2×實體 且上影短 | 錘子（底部轉折） |
| `candle_shooting_star` | 上影 ≥ 2×實體 且下影短 | 流星（頭部轉折） |
| `candle_engulf_up` | 今收>今開 且包覆昨 K 實體 | 多頭吞噬 |
| `candle_engulf_down` | 今收<今開 且包覆昨 K 實體 | 空頭吞噬 |
| `candle_morning_star` | 三 K：長黑→十字/小→長紅 收過第一根中點 | 晨星（底部） |
| `candle_evening_star` | 三 K：長紅→十字/小→長黑 收破第一根中點 | 夜星（頭部） |
| `candle_three_white` | 連三根長紅且收盤漸高 | 三白兵 |
| `candle_three_black` | 連三根長黑且收盤漸低 | 三黑鴉 |

> 注意：使用 O1/C1 資料時，K 線形態需以 o1/c1 版本的開高低收重新判定。

---

## 六、大師量價指標（補充）

### 1. 威廉·歐尼爾（CANSLIM）— 可程式化核心

| 特徵 | 公式 | 來源要素 |
|---|---|---|
| `near_52w_high` | `close >= 0.95 × max(近 250 日 high)` | N（新高） |
| `break_52w_high` | `close > max(近 250 日 high)` | N（突破） |
| `vol_surge` | `volume > 1.4 × MA5(volume)` | N（量能放大 1.4~1.5 倍） |
| `breakout_vol_confirm` | `break_52w_high and vol_surge` | 量價配合（有效突破） |

### 2. 李佛摩（Livermore）

| 特徵 | 公式 | 意義 |
|---|---|---|
| `pivot_break` | `close > max(前 20 日 high)`（N=20 固定） | 關鍵點突破 |
| `line_of_least_resistance` | `pivot_break` 且當日量 > 前日量 | 最小阻力線 |

### 3. 林則行（台灣飛彈理論）

| 特徵 | 公式 | 意義 |
|---|---|---|
| `fly_high_vol` | `volume ≥ 1.5 × MA5(volume)` 且創新高 | 量能 1.5~2 倍 |
| `above_200ma` | `close > MA200` | 站穩 200 日線 |
| `weekly_slope_30` | 週收盤重取樣 → 週 MA30 → 週斜率(%)；`atan(斜率) ≥ 30°` 且斜率 > 0 | 中長期趨勢 |
| `institution_accum` | 法人連續買超 N 日（來自 `stock_institutional_flows`） | 主力籌碼 |

### 4. 量價 8 法（教科書，全可算）

| 特徵 | 判定 | 意義 |
|---|---|---|
| `vp_price_up_vol_up` | close↑ 且 volume↑ | 價漲量增：趨勢健康 |
| `vp_price_up_vol_dn` | close↑ 且 volume↓ | 價漲量縮：漲勢乏力（背離） |
| `vp_price_dn_vol_up` | close↓ 且 volume↑ | 價跌量增：恐慌/出貨 |
| `vp_price_dn_vol_dn` | close↓ 且 volume↓ | 價跌量縮：跌勢趨緩 |
| `vp_top_divergence` | 價創新高但 OBV 未創新高 | 頂背離 |
| `vp_bottom_divergence` | 價創新低但 OBV 未創新低 | 底背離 |
| `vp_sky_vol` | volume 為近 250 日最大 | 天量（波段可能見頂） |
| `vp_ground_vol` | volume 為近 250 日最小 | 地量（可能見底） |

### 5. OBV / VR

| 特徵 | 公式 | 意義 |
|---|---|---|
| `obv` | 累積：收漲加量、收跌減量 | 能量潮方向 |
| `obv_slope` | OBV 一次斜率 | 量能方向 |
| `vr` | 近 26 日漲日量 / 近 26 日跌日量 × 100（VR(26)） | 量能與漲跌強度關係 |

---

## 七、參考文獻（MA 發散 / 趨勢量化）

1. **Avramov, D., Kaplanski, G., & Subrahmanyam, A. (2023)** — *Moving Average Distance as a Predictor of Equity Returns*（MAD：短/長均線距離預測報酬，錨定效應解釋）
2. **Arena, M. (2010)** — *The Moving Average Ratio and Momentum*, Journal of Futures Markets（MAR：短/長均線比率預測動能）
3. **申萬宏源 (2018)** — 《巧用均線：趨勢跟蹤新視角》（MASS 均線排列打分模型）
4. **Roncalli, T.** — *Trend Filtering Methods for Momentum Strategies*（MA 差值估計趨勢的標度因子 `2/(n1−n2)`）
5. **LuxAlgo** — *MA Slope Filter*（MA 斜率需以 ATR / 百分比標準化，角度不可靠）
6. **QuantifiedStrategies** — *Moving Average Slope Trading Strategy*（MA 斜率公式 `(MA_c − MA_n)/n`）
7. **Li, Y. (2025, arXiv 2509.21326)** — *Operator Analysis of MACD*（MACD = 相位校正後的平滑微分算子）

---

## 八、已定案決策（2026-08 對齊）

1. **MA 發散**：✅ 採用 A（連續發散度，MAD/MAR 比率 + Roncalli 加權）+ B-1（連續打分）+ B-2（bit 狀態）。
   MA 週期為**變數**（設定傳入，預設 8 / 13 / 21），MV 週期亦為變數（預設 5 / 10）。
2. **三盤變體**：❌ **暫時不做** high 突破版與 O1/C1 版，第一版僅收 close 版（如上定義）。
3. **K 線形態**：✅ **做第一版**（收錄第五章全部 11 種形態）。
4. **大師指標**：✅ **補充收錄**（歐尼爾量能 + 李佛摩 + 林則行三條件 + 量價 8 法 + OBV/VR 全部收納）；
   法人籌碼指標以 `stock_institutional_flows` 為源。
5. **輸出規格**：✅ 寫入 **`stock_daily_features`** collection，命名與缺值規則見下。
6. **符號/窗口定案（2026-08 檢討）**：`alignment_state` 111=多頭（MA8>MA13>MA21）、000=空頭；
   `alignment_score` = 有符號 Σ spread（多頭正、空頭負）；`vr` = VR(26) 窗口；
   `weekly_slope_30` = 週收盤重取樣 + 週 MA30 斜率 `atan≥30°`；`pivot_break` N=20；
   KDJ 未達週期（前 9 根）存 null（不填種子值）；`bollinger` 週期 20、2σ。

---

## 九、輸出規格（stock_daily_features）

### Collection 結構

- **collection**：`stock_daily_features`
- **key 慣例**：`{stock_id}_{date}`（與 `stock_daily_o1c1` 一致，如 `2330_2026-08-07`）
- **每檔股票每日一筆**，與 `stock_daily_o1c1` 的日期對齊

### 欄位命名規則

- **一律 snake_case**；來源欄位沿用既有名稱（`stock_id` / `date` / `open` / `high` / `low` / `close` / `volume` / `o1` / `c1`）
- **參數化特徵**以週期嵌入欄位名：`slope_ma8`、`slope2_ma8`、`slope_mv5`、`spread_8_13`
- **布林特徵存整數 0/1**（ArangoDB 友好，ML 直接可用）
- 原始指標值保留：`rsi` / `kdj_k` / `kdj_d` / `kdj_j` / `macd_dif` / `macd_signal` / `macd_hist`

### 建議欄位清單（v1）

| 群組 | 欄位 |
|---|---|
| 索引 | `_key`、`stock_id`、`date` |
| 原始 | `open`、`high`、`low`、`close`、`volume`、`o1`、`c1` |
| 漲幅 | `pct_change`、`pct_change_2d`、`up_2d` |
| MA/MV 斜率 | `slope_ma{8,13,21}`、`slope2_ma{8,13,21}`、`slope_mv{5,10}`、`slope2_mv{5,10}` |
| RSI | `rsi`、`rsi_pos`、`rsi_dist_upper`、`rsi_dist_lower` |
| KDJ | `kdj_k`、`kdj_d`、`kdj_j`、`kdj_pos`、`kdj_golden`、`kdj_dead` |
| MACD | `macd_dif`、`macd_signal`、`macd_hist`、`macd_hist_norm`、`macd_pos`、`macd_cross_up`、`macd_cross_down` |
| MA 發散 | `spread_8_13`、`spread_13_21`、`spread_8_21`、`divergence`、`divergence_delta`、`alignment_score`、`alignment_state` |
| 三盤 | `three_up`、`three_down`、`three_up_str`、`three_down_str`、`three_up_vol`、`three_down_vol`、`three_state` |
| K 線形態 | `candle_long_body_up`、`candle_long_body_down`、`candle_doji`、`candle_hammer`、`candle_shooting_star`、`candle_engulf_up`、`candle_engulf_down`、`candle_morning_star`、`candle_evening_star`、`candle_three_white`、`candle_three_black` |
| 大師指標 | `near_52w_high`、`break_52w_high`、`vol_surge`、`breakout_vol_confirm`、`pivot_break`、`line_of_least_resistance`、`fly_high_vol`、`above_200ma`、`weekly_slope_30`、`institution_accum`、`vp_price_up_vol_up`、`vp_price_up_vol_dn`、`vp_price_dn_vol_up`、`vp_price_dn_vol_dn`、`vp_top_divergence`、`vp_bottom_divergence`、`vp_sky_vol`、`vp_ground_vol`、`obv`、`obv_slope`、`vr` |
| 布林通道 | `bollinger_upper`、`bollinger_middle`、`bollinger_lower` |

### 缺值（None）處理

- 未達 warmup 期間的指標（如 RSI 前 14 根、MA 前 a 根、KDJ 前 9 根、MACD 前 34 根）→ 存 **`null`**，不填 0
- 布林特徵在無法判定時 → `null`（不當 0，避免假訊號）
- 填 0 只限「數值上真為 0」的場合（如 `three_up_str = 0` 代表平盤突破）
- ML 讀取時自行處理 null（drop / impute），寫入端不猜值

### 寫入方式

- 以 **`overwrite=True`** upsert（`col.insert(doc, overwrite=True)`），與 `research_download.py` 一致
- 支援「依區間重算覆寫」，重跑不產生重複文件
