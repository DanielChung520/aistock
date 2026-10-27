# 首頁大盤 K 線 — 10 分K（加權指數盤中走勢）

> 狀態：已實作（2026-10-27）
> 關聯：`AGENTS.md`「Documentation Discipline」、`.docs/accounting/REQUIREMENTS.md`（工作站2 亦將消費盤中/分K）

---

## 1. 變更摘要

首頁（`/`，台股儀表板）的「加權指數走勢」K 線由 **日K** 改為 **10 分K**，初始化（預設）顯示**近一個月**的盤中走勢。

| 項目 | 變更前 | 變更後 |
|---|---|---|
| 時間框架 | 日K | **10 分K** |
| 資料來源 | TWSE `MI_5MINS_HIST`（日 OHLC，volume=0） | **富邦 Neo `IX0001`（TSE 加權指數）**，timeframe `"10"` |
| 預設區間 | 6 個月 | **30 日（約一個月）** |
| 時間範圍按鈕 | 1月 / 3月 / 6月 / 1年 / 5年 | **5日 / 10日 / 20日 / 1月** |
| 指標 | 日K 計算 | 10 分K 計算（同一時間框架，疊圖對齊） |

---

## 2. 資料來源與可行性（2026-10-27 實測）

- 加權指數在富邦 Neo 的代碼為 **`IX0001`**；`marketdata.rest_client.stock.historical.candles(symbol="IX0001", timeframe="10", from, to)` **可直接取得 10 分K**。
- 實測近 35 日：**588 根 10 分K**（`2026-09-22 09:00` ~ `2026-10-27 13:30`），涵蓋約一個月。
- 其他代碼（`TSE01` / `TWII` / `TSE`）回傳 0 筆，**僅 `IX0001` 有效**。
- **yfinance 無 10m 原生解析度**（僅 1/2/5/15/30/60m），故指數分K **一律走富邦**；`IX0001` 亦不在 `stock_codes`，不走個股 `stock_minute_1m` 聚合路徑。
- 富邦不可用（憑證缺失 / 429 限流）→ 回傳空陣列，前端顯示「暫無圖表資料」。

> 注意：行情不需富邦交易權限；只需要憑證登入即可（見 `sdk/fubon/README.md`）。

---

## 3. 後端 API（`backend/src/routers/market.py`）

| 端點 | 方法 | 說明 |
|---|---|---|
| `/market/taiex/bars` | GET | 加權指數分K。`resolution`（1/5/10/15/30/60，預設 `10`）、`days`（1–60，預設 `30`）。回傳 `{title, data:[{date,open,high,low,close,volume}]}`，`date` 為 `YYYY-MM-DD HH:MM:SS`。 |
| `/market/taiex/minute-indicators` | GET | 分K 指標（MA/KDJ/RSI/MACD/BB）。參數同個股 minute-indicators（`interval`、`days`、`ma_*`、`kdj_*`、`rsi_period`、`macd_*`、`bb_*`）。 |

- 指標以 **分K bar 同一時間框架** 計算，前端疊圖才會對齊。
- 快取：分K 變化快，記憶體快取 TTL **60 秒**（日K 舊路徑為 300 秒）。
- 既有日K 端點（`/market/taiex`、`/market/taiex/indicators`）**保留不動**（向後相容）。

## 4. 前端（`frontend/src/app/page.tsx`）

- `selectedMonths` → `selectedDays`（預設 `30`）。
- 資料抓取改打 `/api/market/taiex/bars?resolution=10&days=N` 與 `/api/market/taiex/minute-indicators?interval=10m&days=N&…`。
- 快取沿用 `taiex-history` / `taiex-indicators` 類別（key 含 `res=10&days=`，與日K key 不衝突）。
- `MultiPaneChart` 以 `date` 含空白判定為分鐘資料（`isMinuteData`），自動轉 epoch 秒，無需改圖表元件。

---

## 5. 盤中自動刷新

- 台股交易時段（**週一–五 09:00–13:35 台北時間**）且分頁可見時，每 **60 秒**重抓一次 10 分K（前端 `force` 略過 IndexedDB 快取；後端仍為 60 秒記憶體快取）。
- 分頁切回前景（`visibilitychange`）時立即刷新一次。
- 非交易時段 / 分頁隱藏 → 不輪詢。
- 此為 `G3`（禁即時輪詢）的**唯一盤中例外**，已於 `AGENTS.md` 明列：僅限此指數圖表、display-only、不下單、不影響其他資料路徑。
- 未判斷台股國定假日（假日輪詢僅重抓相同資料，成本極低）。

## 6. 已知限制

- 首頁摘要卡「漲跌」為**最後一根 10 分K vs 前一根**（10 分鐘變動），非當日漲跌。
- 時間範圍上限 `days ≤ 60`（富邦單次 candles 有筆數上限，一個月 ~588 根安全）。

---

*相關程式碼：`backend/src/routers/market.py`、`backend/src/fubon_market.py`、`frontend/src/app/page.tsx`。*
*相關文件：`sdk/fubon/README.md`、`.docs/simulation-replay.md`。*
