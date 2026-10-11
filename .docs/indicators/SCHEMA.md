# 指標知識庫 Schema（Indicator Knowledge Base）

> 位置：`.docs/indicators/{metric}.json`
> 用途：給 LLM 檢索、給後端判斷可執行性、給圖譜建關係。每個指標一份 JSON。
> 與 ontology（`.docs/ontology/`）關係：此目錄是「指標領域的 source of truth」，ontology v0.1 是「基本面領域」。未來合併到同一個 `stock-investment-tw` ontology 的 v1。

---

## 目的（為什麼需要這個）

LLM 生成選股條件時，只能使用它「知道」的指標。知識庫提供：

1. **定義與公式** — LLM 理解「這個指標是什麼、怎麼算」（網路知識的補充）
2. **可執行性標記** — 哪些指標後端 `compute_snapshot` 真的算得出（`implemented=true`），哪些只是知識（`implemented=false`）
3. **圖譜關係** — 指標間依賴（MACD 依賴 EMA）、型態組合（三盤突破需要 range3+breakout）、訊號意義
4. **參數慣例** — 台股常用參數（如 RSI 6/12/24、KD 9/3/3），讓 LLM 生成合理條件

---

## 檔案結構（每指標一個 JSON）

```json
{
  "metric": "rsi",
  "name": "RSI 相對強弱指標",
  "category": "momentum",
  "tags": ["超買超賣", "動能", "反轉"],
  "llm_intent": "偵測超買超賣區間，尋找價格反轉時機",
  "definition": "一段時間內漲跌幅度的相對強弱，衡量超買超賣",
  "formula": "RSI = 100 - 100/(1+RS)；RS = 平均漲幅/平均跌幅（Wilder 平滑）",
  "parameters": [
    { "name": "period", "default": 14, "range": [2, 100], "tw_convention": "台股常看 6/12/24 或 9" }
  ],
  "inputs": ["close"],
  "outputs": { "type": "number", "range": [0, 100], "meaning": ">70 超買，<30 超賣" },
  "implementation": {
    "implemented": true,
    "function": "calculate_rsi",
    "catalog_metric": "rsi"
  },
  "depends_on": [],
  "signals": [
    { "pattern": "超買", "condition": "RSI > 70" },
    { "pattern": "超賣", "condition": "RSI < 30" }
  ],
  "combines_with": ["kdj", "macd"],
  "notes": "台股慣例 RSI(6) 看短線、RSI(24) 看長線"
}
```

---

## 欄位說明

### 識別與分類
| 欄位 | 型別 | 說明 |
|---|---|---|
| `metric` | string | **唯一 ID**。與 `INDICATOR_CATALOG` 的 `metric` 一致（已實作時）；未實作時用 snake_case 慣例命名（如 `range3`） |
| `name` | string | 中文全名 |
| `category` | string | `trend` / `momentum` / `volatility` / `volume` / `pattern` / `statistical` |
| `tags` | string[] | 多標籤（可搜尋、分類）。衍生慣例：category 同義詞 + signals[].pattern + 常用別名；可人工擴充 |
| `llm_intent` | string | **給 LLM 的「這個指標用來幹嘛」**。一句話說明使用情境／決策意圖（例：偵測超買超賣、確認趨勢反轉、量價背離） |
| `definition` | string | 一段話定義，供 LLM 理解 |

### 數學定義
| 欄位 | 型別 | 說明 |
|---|---|---|
| `formula` | string | 數學公式（含變數說明） |
| `parameters` | array | 參數清單：`name` / `default` / `range` / `tw_convention`（台股慣例） |
| `inputs` | array | 需要的 K 線欄位：`open` / `high` / `low` / `close` / `volume` / `amount` |
| `outputs` | object | `type`（number/bool/object）+ `range` + `meaning`（數值意義） |

### 可執行性（關鍵！）
| 欄位 | 型別 | 說明 |
|---|---|---|
| `implementation.implemented` | bool | 後端 `compute_snapshot` 是否真的算得出 |
| `implementation.function` | string \| null | `indicators.py` 或 `strategy.py` 裡的函式名 |
| `implementation.catalog_metric` | string \| null | 對應 `INDICATOR_CATALOG` 的 metric 名（若在目錄內） |

**規則**：LLM 只能對 `implemented=true` 的指標生成條件。`implemented=false` 的指標僅供理解（未來可動態生成公式）。

### 圖譜關係
| 欄位 | 型別 | 說明 |
|---|---|---|
| `depends_on` | array | 此指標依賴的指標（如 MACD 依賴 EMA）→ 圖譜 `depends_on` edge |
| `signals` | array | 此指標發出的訊號：`pattern` + `condition` → 圖譜 `signals` edge |
| `combines_with` | array | 常搭配的指標（確認訊號用）→ 圖譜 `combines_with` edge |

### 補充
| 欄位 | 型別 | 說明 |
|---|---|---|
| `notes` | string | 台股慣例、注意事項、參考來源 |

---

## 來源規範

- 公式以 **TA-Lib 為基準**（業界標準，BSD 授權，可直接引用公式）
- 台股慣例補充（如扣抵值、量比定義）以 `indicator001.md`、`charact.md` 及台股實務為準
- 第二來源：**FinLab**（GPL-3.0 — **只整理公式與文件，不複製其 code**；公式本身不受版權保護）
- 每個指標在 `notes` 標記參考來源（如 `TA-Lib RSI` / `FinLab docs`）

---

## 已實作指標（對照 `INDICATOR_CATALOG`，應有對應 JSON）

| metric | 函式 | 來源 |
|---|---|---|
| price / pct_change | strategy.py snapshot | 內建 |
| ma8 / ma21 / ma55 / ma89 | calculate_ma_daniel | TA-Lib SMA |
| slope8 / slope21 | calculate_ma_daniel | 內建 |
| close_offset | calculate_ma_daniel | 台股扣抵值 |
| kdj_k / kdj_d / kdj_j | calculate_kdj | TA-Lib STOCH |
| rsi | calculate_rsi | TA-Lib RSI |
| macd_dif / macd_signal / macd_hist | calculate_macd | TA-Lib MACD |
| bb_upper / bb_middle / bb_lower / bb_width | calculate_bollinger | TA-Lib BBANDS |
| vol_ratio | strategy.py snapshot | 內建（量比） |
| trend / ma_bull / buy_signal / sell_signal | calculate_ma_daniel | 內建 |

---

## 尚未實作但台股常見（知識庫先收錄，`implemented=false`）

- `range3`（三日振幅）— 三盤突破核心積木
- `breakout_high3`（突破前三日高點）— 三盤突破核心積木
- `atr`（平均真實波幅）— 停損/波動
- `obv`（能量潮）— 量價關係
- `cci`（順勢指標）— 動能
- `williams_r`（威廉指標）— 超買超賣
- `dmi` / `adx`（趨勢強度）— 多頭趨勢確認
- `roc`（變動率）— 動能
- `momentum`（動量）— 動能
- `trix`（三重指數平滑）— 趨勢
- `psar`（拋物線轉向）— 趨勢反轉
- `vwap`（成交量加權均價）— 成本基準
- `supertrend`（超級趨勢）— 趨勢跟蹤
