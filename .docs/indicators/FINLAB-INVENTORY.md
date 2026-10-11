# FinLab 指標盤點（Inventory）

> 來源：PyPI finlab v2.0.17（finlab.tw / finlab.finance，GPL-3.0-or-later，2026-08-02 釋出）
> 抓取日期：2026-08-10｜官方文件 https://finlab.finance/docs/ 與 https://doc.finlab.tw
> 目的：TA-Lib 之外的第二個公式來源，補台股特有指標與交叉驗證公式。
> 授權：GPL-3.0，本文件僅整理公式/文件/參數慣例，不複製任何 code。

---

## 〇、身分確認（重要）

**唯一相關的 FinLab = PyPI 的 `finlab`（台灣股市資料 + 選股 + 回測庫，finlab-python org）。**
「GitHub glamp/finlab（Financial Indicators Laboratory 純指標公式庫）」**不存在**——已驗證
`repos/glamp/finlab` 404，且 glamp 使用者名下無任何 finlab repo；`TauricResearch/finlab`
（Rust）亦 404。因此不存在第二個「純公式庫 FinLab」，所有對照均以 PyPI finlab 為準。

**關鍵結構發現**：finlab 的技術指標層 `data.indicator()` 是 **TA-Lib 的包裝（wrapper）**，
TA-Lib 無對應函式時才 fallback 到 **pandas_ta**。
→ 技術指標公式層與本知識庫（TA-Lib 64 JSON）重疊 ≈ 100%；FinLab 的獨特價值在於：
**(a) 台股資料欄位、(b) pandas_ta 補遺指標、(c) 文件化的台股合成公式、(d) FinlabDataFrame accessor**。

---

## 一、技術指標層：與 TA-Lib 的重疊

`data.indicator('RSI', timeperiod=14)`、`data.indicator('STOCH')`（KD 回傳 K/D 兩矩陣）、
`data.indicator('MACD')`（回傳 3 矩陣）、`data.indicator('BBANDS', timeperiod=40, nbdevup=2.5)`…
名稱與參數完全等同 TA-Lib。本知識庫 A/B 級已收錄者（RSI/KDJ/MACD/BBANDS/ATR/OBV/MFI/CMF…）
在 FinLab 中即為同一批公式，可直接交叉驗證，無需新增。

**TA-Lib 官方函式清單（ta-lib.org/functions/，2026-08-07 更新）新增、但本知識庫未收錄者：**

| TA-Lib 函式 | 類別 | 中文 | 建議 |
|---|---|---|---|
| NVI / PVI | Volume | 負/正成交量指標 | 建議補入（D 級原未列） |
| ACCBANDS | Overlap | 加速度通道 | 建議補入 |
| BOP | Momentum | 多空力道平衡 | 可補 |
| IMI | Momentum | 日內動量指標 | 可補 |
| CMO / CMOU | Momentum | 錢德動量（未平滑） | 可補 |
| ADXR / STOCHF / AROONOSC / MACDEXT / MACDFIX / PLUS_DI / MINUS_DI / PLUS_DM / MINUS_DM | Momentum | 家族變體 | 依用途取捨 |
| T3 / TRIMA / MAMA / HT_TRENDLINE / MIDPOINT / MAVP / SAREXT | Overlap | 均線家族 | 依用途取捨 |
| LINEARREG_ANGLE / LINEARREG_INTERCEPT | Statistic | 回歸角度/截距 | 可補 |
| AVGDEV | Price Transform | 平均絕對偏差 | 工具 |

> 註：HMA 已於 TA-Lib 官方清單（Overlap）—本知識庫 hma.json 的「TA-Lib HMA」標記正確。

---

## 二、FinLab 獨有（TA-Lib 無）指標/因子對照表

### A. pandas_ta fallback 指標（`data.indicator()` 可直接算）

| FinLab 指標 | 類別 | 公式/定義 | 參數慣例 | 與 TA-Lib 對應 | 來源 URL |
|---|---|---|---|---|---|
| supertrend | 趨勢 | ATR-based 趨勢線：上/下軌 = (H+L)/2 ± mult×ATR(period)，價格穿越翻轉 | period=10, multiplier=3（文件範例） | **獨有**（TA-Lib 無） | https://finlab.finance/docs/details/tech_ind/ |
| ssf | 趨勢/平滑 | Super Smoother（遞迴低通濾波） | len=10（文件範例） | **獨有** | https://finlab.finance/docs/reference/data/ |
| psl | 動能 | 心理線 = N 日內上漲天數 / N × 100 | N=12 | **獨有**（台股常見） | https://twopirllc.github.io/pandas-ta/ |
| vwap | 量價 | Σ(典型價×成交量)/Σ成交量 | anchor 日內 | **獨有** | 同上 |
| ichimoku | 趨勢 | 一目均衡表（雲帶） | 9/26/52 | **獨有** | 同上 |
| alma / kc / donchian / squeeze / vortex / qstick / fisher / rvi / tsi / eom / zscore / slope 等 | 均線/動能/波動 | pandas_ta 130+ 指標族 | 見 pandas_ta 文件 | **獨有**（批次） | https://twopirllc.github.io/pandas-ta/#indicators-by-category |

### B. 台股資料欄位（`data.get()` 的「指標語彙」，知識庫全缺）

| FinLab 欄位 | 中文慣稱 | 定義 | 參數 | 與 TA-Lib 對應 | 來源 URL |
|---|---|---|---|---|---|
| price_earning_ratio:本益比 | 本益比 PE | 股價/每股盈餘 | — | **獨有（基本面）** | https://finlab.finance/docs/reference/data/ |
| price_earning_ratio:股價淨值比 | 股價淨值比 PB | 股價/每股淨值 | — | **獨有** | 同上 |
| fundamental_features:ROE稅後 / 股東權益報酬率 | ROE 股東權益報酬率 | 稅後淨利/股東權益 | — | **獨有** | 同上 |
| fundamental_features:ROA稅後息前 | ROA | 稅後息前淨利/總資產 | — | **獨有** | 同上 |
| fundamental_features:營業利益成長率 | 營業利益成長率 | (本期-前期)/前期 | — | **獨有** | 同上 |
| financial_statement:每股盈餘 | EPS | 盈餘/股數 | — | **獨有** | 同上 |
| financial_statement:合約負債_流動 | 合約負債（營建業） | 已簽約未認列預售收入 | — | **獨有** | https://finlab.finance/docs/tools/construction_sector/ |
| institutional_investors_trading_summary:投信買賣超股數 | 投信買賣超 | 投信淨買超股數 | — | **獨有（籌碼面）**（本專案已有 FinMind 法人資料） | https://finlab.finance/docs/reference/data/ |
| etl:外資持股比例 | 外資持股比例 | 外資持股/股本 | — | **獨有（籌碼面）** | 同上 |
| margin_transactions:融資使用率 | 融資使用率 | 融資餘額/可融資額度 | — | **獨有（籌碼面）** | 同上 |
| monthly_revenue:當月營收 | 月營收 | 每月 10 號公告 | — | **獨有（營收）** | 同上 |
| monthly_revenue:去年同月增減(%) | 月營收年增率 | (當月-去年同月)/去年同月 | — | **獨有（台股核心因子）** | 同上 |
| etl:adj_close | 還原權值股價 | 除權息調整後價格 | — | **獨有（計算基底）**：均線/通道/ATR 建議用還原價 | https://finlab.finance/blog/python-talib-158-technical-indicators |
| etl:market_value | 市值 | 股價×股數 | — | **獨有** | 同上 |

### C. 文件化台股合成公式（FinLab 策略頁面，知識庫缺）

| FinLab 指標 | 類別 | 公式/定義 | 參數慣例 | 與 TA-Lib 對應 | 來源 URL |
|---|---|---|---|---|---|
| BIAS 乖離率 | 趨勢 | (close − MA(n)) / MA(n) | n=60（文件）；台股慣用 20/60 | **獨有**（close_offset 扣抵值≠乖離率，可互補） | https://finlab.finance/docs/details/tech_ind/ |
| 60 日動能 | 動能 | close/close.shift(60) − 1，取 is_largest(30) | 60 日≈一季；前 30 強 | **獨有**（合成） | https://finlab.finance/docs/tools/deviation_rate_roe_filter/ |
| PEG 本益成長比 | 評價 | PE / 營業利益成長率，取 is_smallest(10) | 營收趨勢多頭濾網後排序 | **獨有** | https://finlab.finance/docs/tools/peg_ratio_strategy/ |
| 月營收成長 | 營收 | YoY = rev/rev.shift(12)−1；MoM = rev/rev.shift(1)−1；3M/12M = avg(3)/avg(12)−1 | 3 月均值 vs 12 月均值 | **獨有** | https://finlab.finance/docs/details/tech_ind/ |
| 營收趨勢多頭 | 營收 | avg(3)/avg(12) > 1.1 且 rev/rev.shift(1) > 0.9 | 月頻換股 | **獨有** | https://finlab.finance/docs/tools/peg_ratio_strategy/ |
| 便宜股比率（PB） | 大盤寬度 | Σ(PB<0.6) / Σ(notna) | 門檻 0.6 | **獨有**（市場底部訊號） | https://finlab.finance/docs/tools/cheap-stock-ratio/ |
| 便宜股比率（PE） | 大盤寬度 | Σ(PE<10) / Σ(notna) | 門檻 10 | **獨有** | 同上 |
| 大盤多空排列 | 大盤寬度 | Σ(MA5≥MA10≥MA30) > Σ(MA5<MA10<MA30) | 5/10/30 | **獨有**（ma_bull 為單股；此為全市場家數寬度） | https://finlab.finance/docs/tools/market_index_filter/ |
| 合約負債佔股本比率 | 產業特有 | 合約負債/股本 > 0.5，且成長率 5%~50%，取前 5 | 建材營造類股 | **獨有** | https://finlab.finance/docs/tools/construction_sector/ |
| 量價背離 | 量價 | close==rolling(60).max() 且 volume < avg(20) | 60/20 | **獨有**（new_high_n + vol_ratio 之合成） | https://finlab.finance/docs/details/tech_ind/ |
| 創新高動能 | 動能 | close ≥ rolling(300).max() | 300 日 | ≈ new_high_n（參數差異） | https://pypi.org/project/finlab/ |

### D. FinlabDataFrame accessor（選股工具，非 K 線指標）

| 方法 | 定義 | 參數 | 與 TA-Lib 對應 |
|---|---|---|---|
| average(n) | SMA | n | = SMA（重疊） |
| rise(n) / fall(n) | 連續 N 期上漲/下跌（連漲/連跌） | n=1..N | **獨有** |
| sustain(n) | 條件連續 N 期成立 | n | **獨有** |
| is_largest(n)/is_smallest(n) | 每日橫截面前/後 N 名 | n | **獨有**（選股） |
| rank(pct) / industry_rank() | 百分位排名 / 產業內排名 | — | **獨有** |
| neutralize_industry() | 產業中性化 | — | **獨有** |
| .cs（rank/winsorize/bucket/zscore/demean） | 橫截面因子預處理 | winsorize(0.05,0.95) | **獨有** |
| .sector（rank/zscore/… + mean/std/median/…） | 產業內轉換與聚合 | — | **獨有** |
| .weight（inverse_volatility/risk_parity/cap_industry/limit_turnover/drawdown_control 等 8 法） | 組合權重 | window=60, cap=0.3, turnover=0.3 | **獨有** |

---

## 三、常用參數慣例（FinLab 台股回測）

| 慣例 | 值 | 說明 |
|---|---|---|
| resample | `'M'` 為主（月頻換股），`'W'`、`'Q'` | 月頻與月營收公布節奏吻合，控交易成本 |
| adjust_price | `True`（價格類指標） | 用還原權值避免除權息跳空污染均線/通道/ATR |
| RSI | timeperiod=14（選股範例用 20） | 20 較不敏感 |
| STOCH（KD） | fastk_period=9（slowk/slowd 3,3） | **確認台股慣用 9/3/3 與本專案一致** |
| MACD | 12/26/9 | 標準 |
| BBANDS | timeperiod=40, nbdevup/dn=2.5（抄底例）；一般 20/2 | 68-95-99.7 法則 n∈1~3 |
| 交易成本 | 手續費 0.1425%（5 折）、證交稅 0.3% | 回測預設 |
| 換股時點 | 月營收截止日（reindex ffill） | 避免前視偏差；財報延後 14 天 |
| 流動性濾網 | 近 60 日成交金額前 50% | 選股池 |

---

## 四、收錄決策（FinLab 補源建議）

**優先補入（台股特有、公式層可實作、知識庫缺）：**
1. `bias` 乖離率 — 台股最常用、TA-Lib 無；與 close_offset（扣抵值）互補
2. `institutional_buy` 投信/外資買賣超 — 籌碼面；本專案已有 FinMind 法人資料，可直接對接
3. `revenue_yoy` 月營收年增率（+MoM、3M/12M）— 台股核心因子
4. `breadth` 大盤多空排列（MA5/10/30 全市場家數）— 大盤濾網
5. `cheap_stock_ratio` 便宜股比率（PB<0.6、PE<10）— 市場底部寬度
6. `rise/fall` N 日連漲/連跌 — TA-Lib 無
7. `supertrend`（pandas_ta）— 台股零售常用趨勢指標
8. `psl` 心理線（pandas_ta）— 台股常用
9. `divergence` 量價背離（新高+量縮合成）

**順帶補入（TA-Lib 官方新增、知識庫未收錄）：** NVI、PVI、ACCBANDS、BOP、IMI、CMO。

**交叉驗證（FinLab 與既有公式互相校驗）：** RSI、STOCH(KD 9/3/3)、MACD、BBANDS、ATR、
MFI、OBV、SAR、ADX — FinLab 即 TA-Lib 包裝，數值應一致。

> 補入後知識庫 JSON 的 notes 標記來源為 FinLab（GPL-3.0，僅公式/文件，不複製 code）。
