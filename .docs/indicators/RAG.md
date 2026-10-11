# indicatorRAG — 指標知識庫檢索層

> 位置：`.docs/indicators/RAG.md`
> 目標：AI 搜索（選股條件生成）、監控（每日掃描）、解釋（為什麼選這檔）都有一個「推斷依據」——
> 不是靠 LLM 背答案，而是先檢索指標知識庫，再據此生成/驗證/解讀。
> 獨立於 kag：不依賴 kag 部署狀態，知識庫就在 repo（`.docs/indicators/*.json`）。

---

## 一、設計原則

1. **知識庫為權威**：64 個指標 JSON 是唯一事實來源，RAG 只讀不寫。
2. **本地優先**：embedding 用 dllm `bge-m3`（`http://localhost:11400/v1/embeddings`，1024 維），零外部 API 成本。
3. **注入而非取代**：檢索結果是「證據」，注入 LLM prompt 讓它據此推斷；不覆寫 LLM 的組合能力。
4. **可追溯**：每次檢索回傳 `score` 與來源，解釋時可引用「依據 range3 < 3% + 突破前三日高點」。

## 二、檢索單元（document）

每份指標 JSON 轉成一筆 document：

```
metric (id)
name
category
definition            ← 語意主體
formula               ← 公式（向量化的關鍵）
parameters.tw_convention
signals[].pattern     ← 訊號語意
combines_with         ← 組合關係（連帶拉取用）
implementation.implemented  ← 可執行性（執行層過濾）
```

嵌入文本（embed_text）= `name + definition + formula + signals + tw_convention` 的繁中拼接。

## 三、檢索流程

```
查詢（自然語言 or 指標名）
  → embed query（bge-m3）
  → cosine similarity × 64 份 document
  → top-k（預設 5，門檻 score > 0.3）
  → 連帶拉取：top-k 的 combines_with 指向的指標也帶上（組合推斷）
  → 過濾：只留 implemented=true 的進「可執行候選」；其餘標記「知識庫僅收錄」
  → 輸出 JSON：{results: [{metric, name, category, definition, formula,
                           implemented, signals, combines_with, score}]}
```

### 組合推斷範例

查詢「三盤突破」：
- 語意檢索命中：`range3`（三日振幅）、`breakout_high3`（突破前三日高點）、`vol_ratio`（量比）
- `combines_with` 連帶：`ma_bull`、`vol_ratio` 互相引用
- 注入 LLM 的證據：range3 的「<3% 窄幅」、breakout_high3 的「close > max(high[-4:-1])」公式
- LLM 據此生成：`range3 < 3` + `breakout_high3 is_true` + `vol_ratio > 1.2`

## 四、注入點（AI 搜索 / 監控 / 解釋）

| 場景 | 流程 | 注入位置 |
|---|---|---|
| 搜索 | `ai_screen_translate` / `ai_screen` | 檢索 query=description，證據併入 SYSTEM_PROMPT 的「可用指標目錄」之後 |
| 監控 | 每日掃描（daily_update，Wave 4） | 對異常訊號檢索解釋依據，附在監控報告 |
| 解釋 | 前端條件展示 / AI 回覆 | 檢索每個 metric 的 definition/signals，附在 note 或 explanation |

## 五、API

`POST /api/strategy/indicator-search`
```json
// request
{ "query": "三盤突破", "top_k": 5 }
// response
{
  "query": "三盤突破",
  "results": [
    { "metric": "breakout_high3", "name": "突破前三日高點", "category": "pattern",
      "definition": "...", "formula": "...", "implemented": true,
      "signals": ["三盤突破（突破確認）"], "combines_with": ["range3","vol_ratio","ma_bull"],
      "score": 0.87 }
  ],
  "executable_metrics": ["range3","breakout_high3","vol_ratio"],
  "knowledge_only_metrics": ["cci","adx"]
}
```

## 六、實作載體（backend）

- `backend/src/indicator_rag.py` — 模組：載入 JSON → build index → embed → search
  - `load_knowledge_base(path)` → list[document]
  - `IndicatorRAG` class：`__init__`（lazy build）、`search(query, top_k, threshold)`、`_embed(texts)`
  - embedding 失敗時 graceful fallback：純關鍵字比對（metric/name/definition 子字串）避免服務掛掉
- `backend/src/routers/strategy.py` — 新增 `/indicator-search` endpoint + `ai_screen*` 注入
- 知識庫路徑：`../.docs/indicators/*.json`（相對 backend/），或環境變數 `INDICATOR_KB_PATH`

## 七、未來

- 向量持久化（ArangoDB / 磁碟 cache），避免每次重啟重算 64 筆 embedding
- kag 修好後可平行驗證（同一知識庫送 kag HybridRAG，對比分數）
- 圖譜邊緣（GRAPH.md 的 depends_on/signals/composes）接入組合推斷
