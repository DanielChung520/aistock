# 個股看盤即時（圖表 tab + 我的股票清單）

> 狀態：已實作（2026-10-29）
> 關聯：`AGENTS.md`「G3 例外3」、`.docs/dashboard-taiex-10m.md`（首頁指數，同機制）

---

## 1. 目標

依**選定股票**即時刷新（盤中）：

- **個股圖表 tab**（`StockDetailPanel`）：分K圖（預設 **60 分K**，可切 1/5/10/15/30/60）+ 指標。
- **我的股票清單**（`MyStocksList`）：成交價／漲跌幅／成交量即時。

「一般交易系統如何設量」的取法：**以根數封頂 + 依解析度分層 + 即時只推 delta + 前端快取**。

## 2. 資料量（有界）

| 項目 | 規格 |
|---|---|
| 圖表週期 | 預設 60 分K；上限 `cap`（預設 **200 根**，`/stream` 參數） |
| 歷史 | `stock_minute_1m`（ArangoDB，**保留 14 天**）→ 所有分K由 1m 聚合，故實際上限定死 14 交易日 |
| 即時 | 只推**當日** bar（60m 一天 ≤ 5 根）+ 當日指標點 |
| 清單 | 只推每檔**最新價 + 當日累積量**（小物件） |

## 3. 後端

- **`backend/src/realtime/live_feed.py`**（`get_live_feed()`）：單一富邦 WS（Normal 模式），**多標的、興趣制**訂閱。
  - `ensure(symbol, ttl)`：HTTP 讀取 / fallback 輪詢維持興趣（TTL 120s）。
  - `add_listener/remove_listener(symbol, queue)`：SSE 訂閱（連線期間訂閱、斷線即退訂）。
  - 交易時段才訂閱；每 5 秒同步一次訂閱集合；靜默 300s 重連。
  - `TAIEX_INDEX_SYMBOL` 為永久標的；其餘（個股）依興趣。
- **`GET /api/stocks/{stock_id}/stream`**（`routers/stocks.py`）：SSE，參數 `interval`（預設 `60m`）、`days`、`cap` + 指標參數。payload `{symbol, interval, data:[{datetime,ohlcv}], indicators}`。合併 `fetch_minute_history`（DB）+ feed 當日即時（1m→週期聚合），指標由共用 `_compute_taiex_minute_indicators` 計算。
- **`GET /api/watchlist/stream?symbols=a,b,c`**（`routers/watchlist.py`）：SSE，payload `{quotes:{symbol:{close,volume}}}`（當日即時價與累積量，前端以已知昨收算漲跌）。

## 4. 前端

- Proxy（串流 passthrough，不 `await res.json()`）：`frontend/src/app/api/stocks/[stockId]/stream/route.ts`、`frontend/src/app/api/watchlist/stream/route.ts`。
- `StockDetailPanel`：`minuteInterval` 預設 `60m`；分K模式對 `/api/stocks/{symbol}/stream` 開 `EventSource`，即時覆寫 `minuteData`/`minuteIndicators`；原 REST 抓取保留為初始載入 / fallback。
- `MyStocksList`：`EventSource('/api/watchlist/stream?symbols=…')` 覆寫 `close/change/changePercent/volume`（以 `prevClose`/`prevVolume` 重算）；連線中停用原 30 秒輪詢（fallback）。
- 快取：圖表仍用既有 `cachedFetch`（IndexedDB）作初始歷史；即時 delta 併入記憶體 state。

## 5. 限制 / 注意

- 富邦 WS 僅給 **1 分K**（index 與個股皆然）→ 週期聚合在後端（`aggregate_bars`，已驗證與富邦 10m 完全一致）。
- 個股分K歷史受 **14 天** 保留限制。
- 目前單一 uvicorn；`--workers > 1` 會重複訂閱（待處理）。
- G3 例外再放寬一級（個股即時）——本次更新 AGENTS.md。

---

## 6. Live bar 語意（含日K）

**不論週期，即時只更新「當前那一根」K 棒**，歷史 K 棒不動（標準看盤行為）：

- 日K = 今天那根：開盤固定、最高/最低即時擴張、收=最新、量累加。
- 分K = 當前週期那根。

實作：

- 後端 `/api/stocks/{symbol}/stream?interval=D` → DB 日K（**60 秒記憶體快取**）+ 今日即時合成 bar（`LiveCandleFeed.today_daily_bar`）+ 指標；分K 走 `interval=1m..60m`。
- 前端 `StockDetailPanel`：**日K 與分K 都開 SSE**，只覆寫 bars/indicators。
- `MultiPaneChart`：資料變動時**就地 `setData` 更新**（不 `chart.remove()` 重建），crosshair/縮放保留；若原本貼在最右緣，新 bar 自動向右跟隨。

## 7. 已知限制

- 富邦 WS 每連線可訂閱數上限未知；「我的股票」清單一次可能訂閱數十檔（`/watchlist/stream?symbols=…`），量大時需改輕量來源或節流。
- 日K 即時依賴當日 1m 聚合；非交易時段由 DB 日K 供應。
- Dev：uvicorn `--reload` 遇長連線 SSE 會卡 graceful shutdown → 已於 `scripts/dev.sh` 加 `--timeout-graceful-shutdown 5`。

---

*相關程式碼：`backend/src/realtime/live_feed.py`、`backend/src/routers/{stocks,watchlist,market}.py`、`frontend/src/components/stocks/{StockDetailPanel,MyStocksList,MultiPaneChart}.tsx`、`frontend/src/app/api/{stocks/[stockId],watchlist}/stream/route.ts`。*
