# Ontology Evolution Log

> **目的**：記錄 `stock-investment-tw` ontology 的每一次變化，**為什麼變、誰觸發、基於什麼對話或文件**。
> 這份 log 是 ontology 的「記憶」— 半年後回頭看，能回答「為什麼這個 entity 存在」、「當時為什麼決定不加入 X」。
>
> **運作方式**：
> - aiStock 在發佈新版本 / 與 AI 對話結論 / 拒絕某個提議時，呼叫 kag 的 `POST /api/v1/ontology-evolution` 介面記錄
> - 這份 `.md` 檔由 aistock 端同步產生（每收到一筆 evolution event 就 append 一段）
> - 這份 log 本身是「海馬體」：它是 ontology 為什麼變成現在這個樣子的長期記憶
>
> **相關介面**：kag `POST /api/v1/ontology-evolution` (見 `kag/docs/API.md`)

---

## 格式約定

每個版本段落含：
- **觸發原因**（trigger）：為什麼這版存在
- **變更清單**（changes）：新增 / 修改 / 移除的 entity / property
- **討論引用**（refs）：相關 AI 對話或文件
- **拒絕的提議**（rejected）：這版考慮過但沒採納的

---

## [v0.1] — 2026-07-08（initial draft）

### 觸發原因

PM 提問：「台股散戶最常問的問題是什麼？」聚焦 4 類高頻查詢：

1. **個股辨識**：「台積電是 2330 對嗎？」
2. **產業歸屬**：「台積電屬於哪個產業？同產業還有哪些公司？」
3. **新聞追蹤**：「聯發科最近有什麼重要消息？」
4. **財務查詢**：「台積電 2026 Q2 EPS 多少？」

設計原則：先有最小可用版本（4 entity + 3 property），上線後依實際提問逐步擴展。

### 包含

| 類型 | 名稱 | 用途 |
|---|---|---|
| entity_class | Company | 個股辨識（含 stock_code, market） |
| entity_class | Industry | 產業歸屬（含 code） |
| entity_class | NewsEvent | 新聞追蹤（含 date, category） |
| entity_class | FinancialItem | 財務查詢（含 metric, value, period） |
| object_property | operates_in | Company → Industry |
| object_property | mentions | NewsEvent → Company |
| object_property | reported_in | FinancialItem → Company |

### 故意排除（等真實觸發再加）

| entity / 概念 | 預期觸發情境 |
|---|---|
| Person | PM 問「台積電董事長是誰？」|
| Policy | 開始追蹤法規對個股的影響 |
| AnalystRecommendation | PM 問「分析師怎麼看？」或文件開始大量出現評等 |
| ReturnMetric | 開始追蹤投資組合或個股報酬 |
| FinancialConcept | PM 問「本益比多少？」或「ROE 是什麼？」 |
| TechnicalSignal | 開始有技術面分析需求（可能永遠不會，因為目標是散戶） |

### 觸發記錄（會呼叫 kag 的 evolution API）

```json
{
  "events": [
    {
      "event_type": "created",
      "target_type": "ontology",
      "target_name": "stock-investment-tw",
      "reason": "Initial minimal-viable version based on PM's first 4 use case categories",
      "context": {
        "source_type": "user_request",
        "user_story": "Build a stock investment ontology for Taiwan retail investors"
      },
      "created_by": "daniel@dllm.ai",
      "created_at": "2026-07-08T10:30:00Z"
    },
    {
      "event_type": "added",
      "target_type": "entity_class",
      "target_name": "Company",
      "reason": "個股辨識是散戶最基本查詢",
      "context": {
        "source_type": "user_request",
        "trigger_question": "台積電是 2330 對嗎？"
      }
    },
    {
      "event_type": "added",
      "target_type": "entity_class",
      "target_name": "Industry",
      "reason": "需要回答產業歸屬與同產業比較",
      "context": {
        "source_type": "user_request",
        "trigger_question": "台積電屬於哪個產業？"
      }
    },
    {
      "event_type": "added",
      "target_type": "entity_class",
      "target_name": "NewsEvent",
      "reason": "散戶最常問的 '最近怎麼樣' 屬於新聞類",
      "context": {
        "source_type": "user_request",
        "trigger_question": "聯發科最近有什麼重要消息？"
      }
    },
    {
      "event_type": "added",
      "target_type": "entity_class",
      "target_name": "FinancialItem",
      "reason": "財務數字是基本面分析必備",
      "context": {
        "source_type": "user_request",
        "trigger_question": "台積電 2026 Q2 EPS 多少？"
      }
    }
  ]
}
```

### 設計紀錄

- **單層架構**：無 Basic/Domain/Major 三層 — 股票投資是單一 domain，三層只增加複雜度
- **保留 `inherits_from`**：欄位保留但 v0.1 不使用，未來若擴展到債券 / 期貨等 domain 可啟用
- **4 entity 順序**：依照「PM 提問頻率」排序，散戶問最多的優先納入
- **3 property 設計**：
  - `operates_in` — 最常見的 entity 關係
  - `mentions` — 新聞 → 公司的核心關係
  - `reported_in` — 財務 → 公司的核心關係

---

## [v0.2] — 待觸發

### 預期觸發情境

| 觸發問題 | 預期新增 |
|---|---|
| 「台積電董事長是誰？」| entity: Person；property: is_director_of |
| 「魏哲家還有哪些職位？」| property: also_holds_role (Person → Company) |
| 「0050 跟台積電有什麼關係？」| entity: FundOrETF；property: holds_share_of |
| 「台積電最近的目標價？」| entity: AnalystRecommendation（Layer 3 引入） |

### 不會自動新增的（需要明確決策）

- Person 細分為 Director / Executive / FundManager（拆太細會讓 LLM 抽取變難）
- FinancialConcept 預載詞彙表（先讓 LLM 自動識別術語，必要時再手動收斂）
- 跨 ontology 引用（v0.x 維持單一 ontology）

---

## 未來章節（預留）

- [v0.5] — 預期加入 Layer 3 (Decision/Outcome) 軸
- [v1.0] — 完整 12 entity + 15 relations（第一個「成熟」版本）
- [v2.0] — 多 ontology 並行（債券 / 期貨 / ETF / 海外）
