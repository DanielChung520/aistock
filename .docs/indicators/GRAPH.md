# 技術指標圖譜設計（Indicator Graph）

> 位置：`.docs/indicators/GRAPH.md`
> 目的：定義指標知識庫的圖譜結構，讓 AI 能沿著「指標 → 依賴 → 訊號 → 型態」的邊緣推斷。
> 對齊：`stock-investment-tw-v0.1.json`（基本面 ontology）的 entity_classes / object_properties 格式。
> 這份圖譜未來合併進 ontology v1，或獨立為 `indicator-graph` ontology。

---

## 一、Entity Classes（節點型別）

技術指標領域新增 4 個 entity class，加上既有 4 個基本面 class：

| Entity Class | 說明 | 代表節點 |
|---|---|---|
| `TechnicalIndicator` | 技術指標（數值/布林，可由 K 線計算） | rsi, ma21, macd_dif, vol_ratio, range3 |
| `Pattern` | 台股型態/訊號（由指標組合而成） | 三盤突破, 金叉, 超賣反彈, 創新高 |
| `Formula` | 計算公式（指標的數學定義，含參數） | RSI 公式, EMA 公式 |
| `Category` | 指標分類 | trend, momentum, volatility, volume, pattern |
| （既有）Company | 公司 | 台積電 2330 |
| （既有）Industry | 產業 | 半導體業 |
| （既有）NewsEvent | 事件 | 法說會 |
| （既有）FinancialItem | 財務項目 | EPS |

---

## 二、Object Properties（圖譜邊緣）

| Property | Domain | Range | 說明 |
|---|---|---|---|
| `depends_on` | TechnicalIndicator | TechnicalIndicator | 依賴關係（MACD depends_on EMA） |
| `has_formula` | TechnicalIndicator | Formula | 指標的計算公式 |
| `signals` | TechnicalIndicator | Pattern | 指標發出的訊號（RSI signals 超賣） |
| `combines_with` | TechnicalIndicator | TechnicalIndicator | 常搭配的指標（確認訊號用） |
| `composes` | Pattern | TechnicalIndicator | 型態由哪些指標組成（三盤突破 composes range3 + breakout_high3） |
| `belongs_to` | TechnicalIndicator | Category | 指標分類 |
| `implemented_in` | TechnicalIndicator | Formula | 後端實作函式（可執行性標記） |

### 邊緣語意

```
TechnicalIndicator --depends_on--> TechnicalIndicator
    (macd_dif) ------------------> (ema)

TechnicalIndicator --signals--> Pattern
    (rsi) ----------------------> (超賣)

Pattern --composes--> TechnicalIndicator
    (三盤突破) ----------------> (range3)
    (三盤突破) ----------------> (breakout_high3)
    (三盤突破) ----------------> (vol_ratio)

TechnicalIndicator --combines_with--> TechnicalIndicator
    (rsi) ------------------------> (kdj_k)
```

---

## 三、可執行性標記（關鍵）

圖譜中每個 `TechnicalIndicator` 節點帶 `implemented` 屬性：

```json
{
  "name": "range3",
  "type": "TechnicalIndicator",
  "properties": {
    "implemented": false,
    "function": null,
    "catalog_metric": null
  }
}
```

- `implemented=true` → AI 可直接用它生成條件（`_validate_conditions` 會放行）
- `implemented=false` → AI 只能理解、不能直接生成條件；或觸發動態公式生成（待執行層決定）

---

## 四、推斷流程（AI 如何使用圖譜）

使用者說「三盤突破的股票」：

```
1. LLM 檢索圖譜：Pattern(三盤突破)
2. 沿 composes 邊緣找到：range3 + breakout_high3 + vol_ratio
3. 檢查每個的 implemented：
   - range3: false → 觸發動態生成或提示未支援
   - breakout_high3: false → 同上
   - vol_ratio: true → 直接可用
4. 組合條件：range3 小 + price > 前三日高 + vol_ratio > 1.2
```

這就是「從查表升級到推理」：**AI 不是背答案，而是沿著圖譜邊緣自己組合**。

---

## 五、與既有 ontology 的關係

- 基本面（v0.1）：Company / Industry / NewsEvent / FinancialItem → 用於「基本面選股」檢索
- 技術面（本設計）：TechnicalIndicator / Pattern / Formula / Category → 用於「技術面選股」檢索
- 兩者可透過 `NewsEvent --mentions--> Company --has_indicator_snapshot--> TechnicalIndicator` 串起（未來）

---

## 六、實作載體

| 層 | 載體 | 內容 |
|---|---|---|
| 文件層 | `.docs/indicators/*.json` | 每個指標一份（schema 見 SCHEMA.md） |
| 圖譜層 | ontology JSON（合併進 v1）或獨立 `indicator-graph` ontology | entity_classes + object_properties + edges |
| 檢索層 | kag HybridRAG（Qdrant 向量 + ArangoDB 圖譜） | 上傳 `.docs/indicators/*.json` 建 KB |
| 執行層 | `compute_snapshot` + `_validate_conditions` | implemented=true 的指標才可執行 |

---

## 七、待決定

1. 圖譜要「合併進 stock-investment-tw v1」還是「獨立 indicator-graph ontology」？
   - 合併：單一 ontology 好維護，但 v0.1 是 draft 待 PM 確認
   - 獨立：技術面/基本面各自演進，用 inherits_from 串
2. Pattern 節點清單（金叉/死叉/超買/超賣/三盤突破/創新高/破底…）是否要第一批就建？
