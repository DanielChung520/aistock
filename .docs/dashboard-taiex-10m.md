# 首頁大盤 K 線 — 加權指數盤中走勢（10 分K，真即時）

> 狀態：已實作（日K→10分K：2026-10-27；歷史+即時合併與 SSE 推播：2026-10-28）
> 關聯：`AGENTS.md`「G3 例外1」、`.docs/accounting/REQUIREMENTS.md`（工作站2 亦將消費盤中/分K）

---

## 1. 變更摘要

首頁（`/`，台股儀表板）的「加權指數走勢」K 線為 **10 分K**（預設顯示近一個月盤中走勢），資料為
**歷史（已完成交易日）+ 當日盤中即時**合併，並以 **SSE** 主動推播給前端。

| 項目 | 規格 |
|---|---|
| 時間框架 | 10 分K |
| 歷史（過去完整日） | 富邦 Neo REST `historical.candles`（`IX0001`, `timeframe="10"`） |
| 當日盤中即時 | 富邦 Neo **WebSocket** `candles` 頻道（1 分K）→ 後端聚合成 10 分K |
| 推播 | **SSE** `GET /api/market/taiex/stream`（斷線退化為 60 秒輪詢） |
| 預設區間 | 30 日（約一個月）；時間按鈕 5日 / 10日 / 20日 / 1月 |
| 指標 | 10 分K 計算（同一時間框架，疊圖對齊）；後端計算 |

---

## 2. 為何需要即時層（2026-10-28 修正）

`historical.candles` **只回「已收盤完成」的交易日，不含當日進行中的盤**。因此盤中此 API 的最新
bar 永遠是「前一個交易日」——2026-10-28 盤中（市場確實開著）圖表卻停在 10/27 13:30。修正方式為
疊加一層即時來源。

實測（2026-10-28）：

- `historical.candles("IX0001","10", from=10/27, to=10/28)` → 最新只到 `2026-10-27 13:30`。
- `rest.intraday.candles("IX0001", timeframe="10")` → 直接回**當日** 10 分K。
- WebSocket `candles`（`IX0001`）→ **只推 1 分K**（要求 `timeframe=10/5/1`，snapshot 一律回 `"timeframe":"1"`）。
- 富邦即時 WebSocket 需 **Normal 模式**；**Speed 模式會拒絕 `candles`/`aggregates` 頻道**
  （見 `fubon_neo/adapter.py`）。`init_realtime()` 預設為 Speed，故 `fubon_market` 一律以 Normal 初始化。
- 訂閱順序：必須先 `connect()` 再 `subscribe()`（否則 `Connection is already closed`）。

---

## 3. 後端架構

### 3.1 即時來源 — `backend/src/realtime/live_feed.py`

- `LiveCandleFeed` 單例（`get_live_feed()`，加權指數為永久標的）：FastAPI lifespan 啟動／停止（`src/main.py`）。
- 交易時段（週一–五 09:00–13:35，台北時間）才訂閱 `{"channel":"candles","symbol":"IX0001","timeframe":"1"}`；
  非交易時段退訂。每 30 秒 supervise，交易時段若超過 3 分鐘無更新則重訂。
- 收到 `snapshot` 覆蓋當日 1 分K、`data` 逐筆更新；`aggregate_bars()` 以 **09:00 對齊**將 1 分K聚合成 10 分K
  （open=首、close=末、high/low=極值、volume=加總）。**已驗證與富邦 `intraday.candles(timeframe="10")` 完全一致（28 根、0 誤差）**。
- 執行緒模型：SDK callback 在自身執行緒觸發；狀態以 `threading.Lock` 保護，SSE 訂閱者以
  `loop.call_soon_threadsafe` 喚醒（coalescing `asyncio.Queue(maxsize=1)`）。
- `get_today_bars(minutes)`：回當日即時（聚合後）bars；`subscribe()/unsubscribe()`：SSE 訂閱。

### 3.2 合併與指標 — `backend/src/routers/market.py`

- `_get_taiex_intraday_historical(resolution, days)`：歷史 REST（記憶體快取 TTL 60 秒）。
- `_get_taiex_intraday(resolution, days)`：`_merge_bars(historical, live)`——歷史 + 當日即時，同日即時優先、依 `date` 去重排序。
- `_compute_taiex_minute_indicators(...)`：MA/KDJ/RSI/MACD/BB 指標包（REST 與 SSE 共用）。
- 既有日K 端點（`/market/taiex`、`/market/taiex/indicators`）保留不動。

### 3.3 API

| 端點 | 方法 | 說明 |
|---|---|---|
| `/market/taiex/bars` | GET | 加權指數分K（歷史 + 當日即時合併）。`resolution`（預設 `10`）、`days`（1–60，預設 `30`）。 |
| `/market/taiex/minute-indicators` | GET | 分K 指標（MA/KDJ/RSI/MACD/BB），同上時間框架。 |
| **`/market/taiex/stream`** | GET | **SSE**。連上先送一包 `{title, data, indicators}`，之後每次即時 bar 更新再推一包；其間以 `: keep-alive` 心跳維持連線。參數同 `minute-indicators`。 |

> Next.js proxy：`frontend/src/app/api/market/taiex/stream/route.ts`（串流 passthrough，**不** `await res.json()`、不套 90 秒 timeout）。
> 靜態路由 `/api/market/taiex/stream` 優先於 catch-all `/api/market/[...path]`（已 build 驗證）。

---

## 4. 前端（`frontend/src/app/page.tsx`）

- 初始載入沿用 `/api/market/taiex/bars` + `/api/market/taiex/minute-indicators`（快速出圖）。
- 以 `EventSource('/api/market/taiex/stream?interval=10m&days=N&<indicatorParams>')` 接收即時
  `{title, data, indicators}`，直接覆寫圖表 state；`selectedDays`／指標設定變更時重建 EventSource。
- SSE 連線中 → 原 60 秒輪詢**跳過**（fallback）；`onerror` → 恢復輪詢並由瀏覽器自動重連。
- `MultiPaneChart` 以 `date` 含空白判定為分鐘資料（`isMinuteData`），自動轉 epoch 秒。

---

## 5. 限制 / 注意

- **單一 process 假設**：目前部署為單一 uvicorn（無 `--workers`）。若未來 `--workers > 1`，每個 worker 會各開一條 WS 訂閱（需加 process guard 或改為外部 feed 服務）。
- 富邦不可用（憑證缺失 / 429）→ 即時層回空，圖表退回「歷史（前一交易日）」；富邦指數分K僅 1 分粒度，10 分K 由後端聚合。
- 未判斷台股國定假日（假日 supervise 僅嘗試訂閱，成本可忽略）。
- 首頁摘要卡「漲跌」為**最後一根 10 分K vs 前一根**（10 分鐘變動），非當日漲跌。
- 時間範圍上限 `days ≤ 60`。

---

*相關程式碼：`backend/src/realtime/live_feed.py`、`backend/src/routers/market.py`、`backend/src/fubon_market.py`、`backend/src/main.py`、`frontend/src/app/page.tsx`、`frontend/src/app/api/market/taiex/stream/route.ts`。*
*相關文件：`sdk/fubon/README.md`、`.docs/simulation-replay.md`、`AGENTS.md`（G3 例外1）。*
