# TA-Lib 指標盤點（Inventory）

> 來源：TA-Lib 官方文件（https://ta-lib.org/functions/，2026-08 抓取）
> 目的：從 TA-Lib 約 158-170 個函式中，挑出台股選股場景常用的指標，定義知識庫收錄範圍。
> 分級：**A** = 已實作於 `compute_snapshot`（可直接生成條件）｜**B** = 台股常用但未實作（知識庫先收錄，`implemented=false`）｜**C** = 型態/積木（圖譜節點）｜**D** = 工具類（不單獨收錄）

---

## 一、分類總覽（TA-Lib 官方 10 類）

| 類別 | 數量 | 台股實用度 | 說明 |
|---|---|---|---|
| Cycle Indicators | 5 | 低 | Hilbert Transform 系列，專業週期分析，台股少用 |
| Math Operators | 11 | 工具 | ADD/DIV/MAX/MIN/SUM…，是積木不是指標 |
| Math Transform | 15 | 工具 | 三角/指數函數，積木 |
| **Momentum Indicators** | 31 | **高** | RSI/KDJ/MACD/CCI/WILLR/ADX… 選股主力 |
| **Overlap Studies** | 23 | **高** | 各類均線/布林/SAR/通道，趨勢核心 |
| **Pattern Recognition** | 61 | **中** | 61 個 K 線型態（CDL*），台股常用約 15-20 個 |
| Price Transform | 5 | 工具 | AVGPRICE/MEDPRICE/TYPPRICE… 中間價 |
| Statistic Functions | 9 | 中 | STDDEV/VAR/LINEARREG 回歸斜率… |
| **Volatility Indicators** | 3 | **高** | ATR/NATR/TRANGE，停損與波動 |
| **Volume Indicators** | 7 | **高** | OBV/MFI/CMF/AD… 量價關係 |

---

## 二、分級清單

### A 級：已實作（13 個 metric → 已對應 `INDICATOR_CATALOG`）

| metric | 對應 TA-Lib | 函式 | 備註 |
|---|---|---|---|
| price | — | strategy.py snapshot | 收盤價 |
| pct_change | ROCP | strategy.py snapshot | 漲跌幅 |
| ma8 / ma21 / ma55 / ma89 | SMA | calculate_ma_daniel | 斐波那契均線 |
| slope8 / slope21 | LINEARREG_SLOPE(近似) | calculate_ma_daniel | 均線斜率 % |
| close_offset | — | calculate_ma_daniel | 台股扣抵值（無 TA-Lib 對應） |
| kdj_k / kdj_d / kdj_j | STOCH | calculate_kdj | 台股慣用 9/3/3 |
| rsi | RSI | calculate_rsi | Wilder 平滑 |
| macd_dif / macd_signal / macd_hist | MACD | calculate_macd | 12/26/9 |
| bb_upper / bb_middle / bb_lower / bb_width | BBANDS | calculate_bollinger | 20/2 |
| vol_ratio | — | strategy.py snapshot | 量比（台股自定義） |
| trend | — | calculate_ma_daniel | A/B/C 趨勢權重 |
| ma_bull | — | calculate_ma_daniel | 多頭排列布林 |
| buy_signal / sell_signal | — | calculate_ma_daniel | MA Daniel 訊號 |

### B 級：台股常用、未實作（知識庫先收錄 → 後續實作或動態生成）

**動能類（Momentum）**
- `cci` — CCI 順勢指標（TA-Lib CCI）
- `willr` — 威廉指標（TA-Lib WILLR）
- `adx` — 平均趨向指標（TA-Lib ADX，趨勢強度）
- `dx` — 趨向指標（TA-Lib DX）
- `mom` — 動量（TA-Lib MOM）
- `roc` — 變動率（TA-Lib ROC）
- `trix` — 三重指數平滑（TA-Lib TRIX）
- `stochrsi` — 隨機 RSI（TA-Lib STOCHRSI）
- `ultosc` — 終極擺盪指標（TA-Lib ULTOSC）
- `mfi` — 資金流量指標（TA-Lib MFI，量能型動能）
- `aroon` — 阿隆指標（TA-Lib AROON，趨勢年齡）
- `apo` / `ppo` — 絕對/百分比價格振盪（TA-Lib APO/PPO）

**波動類（Volatility）**
- `atr` — 平均真實波幅（TA-Lib ATR，停損/波動）
- `natr` — 正規化 ATR（TA-Lib NATR）

**量能類（Volume）**
- `obv` — 能量潮（TA-Lib OBV）
- `cmf` — 蔡金資金流（TA-Lib CMF）
- `adosc` — 蔡金振盪（TA-Lib ADOSC）
- `pvo` — 百分比成交量振盪（TA-Lib PVO）

**均線家族（Overlap，除 SMA 外）**
- `ema` — 指數移動平均（TA-Lib EMA）
- `wma` — 加權移動平均（TA-Lib WMA）
- `vwma` — 成交量加權均線（TA-Lib VWMA）
- `hma` — 赫爾移動平均（TA-Lib HMA）
- `tema` / `dema` — 三/雙重指數均線（TA-Lib TEMA/DEMA）
- `kama` — 考夫曼自適應均線（TA-Lib KAMA）
- `sar` — 拋物線轉向（TA-Lib SAR）
- `midprice` — 週期中點價（TA-Lib MIDPRICE）

**統計類（Statistic）**
- `stddev` — 標準差（TA-Lib STDDEV）
- `linearreg_slope` — 線性回歸斜率（TA-Lib LINEARREG_SLOPE）
- `linearreg` — 線性回歸值（TA-Lib LINEARREG）
- `tsf` — 時間序列預測（TA-Lib TSF）
- `correl` — 相關係數（TA-Lib CORREL，比價用）
- `beta` — Beta 係數（TA-Lib BETA）

### C 級：型態積木與 K 線型態（圖譜節點，`implemented=false` 直到實作）

**型態積木（台股型態學基礎件，部分無 TA-Lib 直接對應）**
- `range3` — 三日振幅（三盤突破前置）※已寫範例
- `breakout_high3` — 突破前三日高點（三盤突破核心）
- `day_high` / `day_low` — 單日最高/最低（基本件）
- `new_high_n` — N 日新高（突破確認）
- `max_n` / `min_n` — N 日最高/最低（TA-Lib MAX/MIN）

**K 線型態（Pattern Recognition 61 個中，台股常用的 18 個）**
| TA-Lib | 中文 | 意義 |
|---|---|---|
| CDLDOJI | 十字 | 多空均衡 |
| CDLDRAGONFLYDOJI | 蜻蜓十字 | 底部反轉訊號 |
| CDLGRAVESTONEDOJI | 墓碑十字 | 頂部反轉訊號 |
| CDLHAMMER | 錘子 | 底部反轉 |
| CDLINVERTEDHAMMER | 倒錘 | 底部反轉 |
| CDLHANGINGMAN | 吊人 | 頂部反轉 |
| CDLSHOOTINGSTAR | 射擊之星 | 頂部反轉 |
| CDLENGULFING | 吞噬 | 強反轉（多/空） |
| CDLHARAMI | 母子 | 趨勢減弱 |
| CDLHARAMICROSS | 母子十字 | 趨勢減弱 |
| CDLMORNINGSTAR | 晨星 | 底部反轉 |
| CDLEVENINGSTAR | 暮星 | 頂部反轉 |
| CDL3WHITESOLDIERS | 三白兵 | 強多 |
| CDL3BLACKCROWS | 三黑鴉 | 強空 |
| CDLMARUBOZU | 長體 | 強趨勢 |
| CDLSPINNINGTOP | 陀螺 | 猶豫 |
| CDLDARKCLOUDCOVER | 烏雲罩頂 | 頂部反轉 |
| CDLPIERCING | 穿刺 | 底部反轉 |

### D 級：工具類（不單獨收錄，作為積木存在）
- Math Operators（11）：MAX/MIN/SUM/SUB… → 用於實現 C 級積木
- Math Transform（15）：三角/指數 → 用於實現指標
- Price Transform（5）：AVGPRICE/MEDPRICE/TYPPRICE → 某些指標的輸入
- Cycle Indicators（5）：Hilbert Transform → 台股少用，暫不收錄
- 其餘 Pattern Recognition（43 個少見型態）→ 暫不收錄

---

## 三、收錄決策

1. **優先建知識庫**：A 級 13 個（補齊正式 JSON）+ B 級約 35 個 = **約 48 個指標 JSON**
2. **C 級型態**：先收錄 6 個積木 + 18 個 K 線型態（可後續分批）
3. **D 級工具**：不單獨建 JSON，實作時在 code 內註明
4. **第二來源**：FinLab 盤點時，對照此清單補台股特有（如扣抵值、量比、三盤突破）

> 待確認：B 級 35 個的取捨是否合理？C 級 K 線型態 18 個是否夠用？
