# 資料源註冊表 Schema（Data Source Registry）

> 位置：`.docs/datasources/`
> 用途：**市場資料源的 source of truth**。給後端做「來源解析/備援」、給 LLM/AI 判斷「某資料該用哪個來源」、給測試驗證無漂移。
> 前例：`.docs/indicators/`（指標知識庫）——同一範式：一份 JSON 同時餵 LLM 檢索 + 後端可執行性 + 前端顯示。
> 與 `sdk/` 關係：`sdk/` 存**券商 SDK / 二進位**；本目錄是**邏輯層**（能力、優先序、成本、限流），不存程式。

---

## 1. 目的（為什麼需要）

目前資料源散落 22 個檔案，且 `data_fetcher.py` 以「Fubon first, yfinance fallback」**把優先序寫死在程式裡**。多來源下，需要一個外部化的註冊表，讓：

1. **後端**：`resolve(dataset)` 依 JSON 決定來源與備援順序（不再硬編碼）。
2. **AI/LLM**：可檢索每個來源的**能力/成本/限流/新鮮度/覆蓋**，判斷該用哪個來源（如：除權息 → FinMind vs MOPS）。
3. **測試**：斷言 `datasets.json` 引用的每個來源/adapter 真實存在（防 JSON 與程式漂移）。

---

## 2. 檔案結構

| 檔案 | 內容 |
|---|---|
| `SCHEMA.md` | 本檔（欄位規範、原則） |
| `datasets.json` | **正規資料集詞彙**（canonical dataset ids）＋各來源優先序。**核心。** |
| `{source}.json` | 每個來源一份（`fubon.json`、`finmind.json`、`twse.json`、`mops.json`、`yfinance.json`、`shioaji.json`、`twstock.json`…） |

> 詞彙（`datasets.json`）先凍結；`{source}.json` 可**增量**補齊。`datasets.json` 可引用「尚無 JSON」的來源（代表規劃中），但**不得引用不存在的 dataset id**。

---

## 3. `datasets.json` 欄位

```json
{
  "version": 1,
  "datasets": {
    "<dataset_id>": {
      "desc": "人類可讀說明",
      "sources": [
        { "id": "<source_id>", "priority": 1, "note": "可選註記",
          "status": "active|planned", "symbols": ["IX0001"] }
      ]
    }
  }
}
```

- **`dataset_id`**：`<領域>.<對象>[.<粒度>]`，小寫、點分。領域：`quote` / `index` / `institutional` / `margin` / `shareholding` / `daytrading` / `short_sale` / `dividend` / `futures` / `news` / `auction` / `symbols`。
- **`sources[].priority`**：`1` = 首選，數字越小越優先；同 dataset 內**唯一**。runtime 依序 fallback。
- **`status`**：`active`（可用）／`planned`（規劃中，runtime 略過）。
- **`symbols`**：可選；該來源僅適用特定代碼（例：富邦指數 `IX0001`）。

---

## 4. `{source}.json` 欄位

```json
{
  "id": "finmind",
  "name": "FinMind",
  "kind": "aggregator",            // broker_api | open_data | aggregator | library | scrape
  "status": "active",              // active | planned | deprecated
  "module": "src/finmind.py",      // 實作位置（可多個，逗號分隔）
  "base_url": "https://…",
  "auth": { "type": "token", "env": ["FINMIND_TOKEN"] },
  "rate_limit": { "…": "…" },
  "cost": "free-tier",
  "markets": ["TWSE", "TPEx"],
  "freshness": "T+1",
  "provides": [
    { "dataset": "dividend.policy", "dataset_id": "TaiwanStockDividend", "history_from": "2009" }
  ],
  "notes": ["…"],
  "docs": "https://…"
}
```

- **`auth.env`**：**僅列環境變數名稱**，**絕不放值**（憑證/金鑰一律經 `.env`；見 `AGENTS.md`）。
- **`provides[].dataset`**：必須存在於 `datasets.json`；`dataset_id` 為該來源對外的原生代號（如 FinMind dataset 名）。
- **`rate_limit` / `cost` / `freshness` / `markets`**：**給 AI 判斷的維度**（便宜/新鮮/權威/限流）。

---

## 5. 原則

1. **JSON 為真相來源**：改來源/優先序 → 改 JSON，不改 code（adapter 實作除外）。
2. **守則不變**：抓取一律在 backend（`G1`）；前端不直連外部資料源。
3. **機密不入 JSON**：只放 `env` 變數名。
4. **命名區隔**：本註冊表是「**市場資料源**」；帳務的 `accounts.source`（manual/statement/broker_api）是「**帳的來源**」，兩者不同域，勿混。
5. **漸進遷移**：先「詞彙 + registry + 薄 resolver」，adapter 逐步靠攏；**不重寫**既有 22 檔。

---

## 6. 消費方式（規劃）

- **後端**：`src/datasources/registry.py` 載入 JSON → `resolve(dataset_id) -> [source_id…]`；adapter 於 `src/datasources/{id}.py`。
- **AI**：`GET /api/datasources` ＋ 一段 prompt block（比照指標 KB 的 `CATALOG_TEXT`），讓助理能回答「某資料用哪個來源」。
- **測試**：斷言 `datasets.json` 每個 `sources[].id` 皆有 `{source}.json` 或標 `planned`；每個 `provides[].dataset` 皆存在於詞彙表。

---

## 7. v0 範圍與進度

- 詞彙表 `datasets.json`：覆蓋**現有已驗證**的資料集（見該檔），未確認者標 `planned`。
- 範例來源：`finmind.json`、`twse.json`（本 v0）；其餘（`fubon`/`yfinance`/`mops`/`shioaji`/`twstock`/`quantpass`）後續補。
- ✅ **`src/datasources/registry.py`**（載入 + `resolve()`）＋ **`GET /api/datasources`** ＋ 漂移測試（2026-10-27）。
- ⬜ adapter 遷移（`src/datasources/{id}.py`）與 `data_fetcher` 改用 resolver — 後續。

---

*相關：`AGENTS.md`（G1/G2/G7 守則）、`.docs/indicators/SCHEMA.md`（同範式前例）、`sdk/README.md`（券商 SDK 存放）、`backend/src/data_fetcher.py`（現行硬編碼 fallback）。*
