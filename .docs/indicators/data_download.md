# 資料下載規則（Data Download Rules）

> 位置：`.docs/indicators/data_download.md`
> 用途：定義 aiStock 所有資料的**下載來源、寫入位置與排程規則**，作為 K 線圖與 ML 特徵共用的資料基礎。
> 核心決策（方案A）：**yfinance 是唯一的 OHLCV 來源**（K線圖與 ML 特徵同源）；O1/C1 由 yfinance 60m 推導；FinMind 僅用於法人/融資/營收等非 OHLCV 資料。

---

## 0. 背景：為什麼要統一資料源

`stock_daily`（K線圖用，yfinance 下載）與 `stock_daily_features`（ML 特徵用）的 OHLCV 曾來自不同來源，導致同一檔股票同一日的 K 線數值不一致：

| 日期 | 欄位 | stock_daily (yfinance) | stock_daily_features (經 stock_daily_o1c1) |
|---|---|---|---|
| 2026-08-07 | close | 2360 | 2370 |
| 2026-08-07 | volume | 13,322,929 | 21,959,343 |

根因：`stock_daily_o1c1` 混用 **yfinance（日K + 60m O1/C1）**、**FinMind `TaiwanStockPrice`（18 檔 yfinance 解析失敗的股票）**、**TPEX `.TWO` 60m** 三個來源。方案A 之後一律以 yfinance 為唯一 OHLCV 來源。

---

## 1. 資料來源總表

| 資料 | 唯一來源 | 寫入 collection | 用途 |
|---|---|---|---|
| 日K OHLCV | yfinance | `stock_daily` | K線圖 + ML 特徵 |
| 分K（1m raw） | yfinance | `stock_minute_1m` | 分K線圖（保留 14 天，**不做 O1/C1 推導**） |
| O1 / C1 | yfinance **60m**（`period=60m`，無法由 1m 回補 >7 天） | 寫回 `stock_daily`（擴充欄位） | ML 特徵（三盤、盤中強弱） |
| 法人買賣超 | FinMind | `stock_institutional_flows` | ML 特徵 |
| 融資融券 | FinMind | `stock_margin` | ML 特徵 |
| 月營收 | FinMind | `stock_monthly_revenue` | ML 特徵 |
| 市場指數 | yfinance | `market_index_daily` | 大盤環境特徵 |
| 股票清單 | twstock.codes | `stock_codes` | 選股/代號 |

> **不再使用**：FinMind `TaiwanStockPrice`（OHLCV）與 `stock_daily_o1c1` collection 於遷移完成後停止寫入，保留歷史資料待確認後刪除。

---

## 2. 核心原則

1. **yfinance = 唯一 OHLCV 來源**：日K、分K、O1/C1 全部來自 yfinance，K線圖與 ML 特徵讀同一份資料。
2. **代號後綴**：上市 `{symbol}.TW`、上櫃 `{symbol}.TWO`（依 `twstock.codes` 或 universe JSON 的 market 欄位判斷）。
3. **yfinance `end` 為 EXCLUSIVE**：抓日K時 `end = date.today() + timedelta(days=1)`，避免漏掉今天。
4. **FinMind 只抓非 OHLCV**：法人買賣超、融資融券、月營收。限速 600 req/hr，實作採 0.7s delay。
5. **G1 / G3**：一切下載經 FastAPI / Celery；每日盤後批次（cron `1-5`），無即時輪詢。
6. **G7**：TWSE 來源限速 3 req/5s（`rate_limiter.py`）；yfinance/FinMind 以 polite delay 控制。

---

## 3. 各資料下載規則

### 3.1 日K OHLCV → `stock_daily`

- 入口：`src/data_fetcher.py::fetch_daily_history(symbol, months)`
- 行為：**快取優先**——讀 ArangoDB，若最新日期 ≥ 昨天則直接回傳；否則 yfinance 補抓缺漏日期並 merge + upsert（`overwrite=True`）。
- 欄位：`date` / `open` / `high` / `low` / `close` / `volume`；key `{stock_id}_{date}`。

### 3.2 分K（1m raw）→ `stock_minute_1m`

- 入口：`src/data_fetcher.py::fetch_minute_history`；回補腳本 `scripts/backfill_minute.py`。
- 儲存：一律存 **1m raw**；5m/10m/15m/30m/60m 由 1m 於查詢時即時聚合（不另存）。
- yfinance 限制：1m 最多回補 7 天、其餘區間 1 個月。
- 清理：`purge_old_minute_data`（保留 14 天，`history_cleanup` 排程執行）。

### 3.3 O1 / C1（開盤 1 小時價 / 收盤 1 小時價）

- 語義（對齊 `.docs/charact.md` 欄位表）：
  - `o1` = 開盤 1 小時收盤價（早盤動能）→ **10:00 價**
  - `c1` = 收盤 1 小時收盤價（尾盤動能）→ **13:00 價**（60m 語意；13:30 收盤前約 30 分鐘）
- **方案A 來源**：由 yfinance **60m** 推導（`period=60m`；不使用 `stock_minute_1m`——1m 只保留 14 天，無法回推 2 年窗）：
  - `o1` = 當日 **09:00 那根 60m** 的 close（= 10:00 價）
  - `c1` = 當日 **12:00 那根 60m** 的 close（= 13:00 價）
  - 當日無 60m 資料（停牌/缺資料）→ `o1`/`c1` 為 null，特徵以 null 處理。
- 寫入：回寫 `stock_daily` 的 `o1` / `c1` 欄位，供特徵生成直接讀取。
- 實作：`src/tasks/research_download.py::_fetch_ohlcv_incremental`（yfinance 60m → O1/C1）。

### 3.4 法人 / 融資 / 營收（FinMind）

- `scripts/fetch_finmind_features.py`（研究 universe 回補，2 年窗）+ `src/tasks/research_download.py`（增量）。

| FinMind dataset | collection |
|---|---|
| `TaiwanStockInstitutionalInvestorsBuySell` | `stock_institutional_flows` |
| `TaiwanStockMarginPurchaseShortSale` | `stock_margin` |
| `TaiwanStockMonthRevenue` | `stock_monthly_revenue` |

- 全部 resumable（已有日期跳過）、`overwrite=True` upsert、key `{stock_id}_{date}`。

### 3.5 市場指數 → `market_index_daily`

- yfinance 代號：`^TWII`、`^TWO`、`^N225`、`^HSI`、`000001.SS`、`^KS11`、`^SOX`、`^IXIC`、`^GSPC`、`^DJI`。
- 回補 2 年（`market_index_backfill`）+ 每日增量（`market_index_daily`）。

---

## 4. ML 特徵資料流（`stock_daily_features`）

```
yfinance 日K  ──→ stock_daily ──┐
yfinance 60m ─→ 推導 o1/c1 ─→ 回寫 stock_daily ──┤
FinMind      ──→ stock_institutional_flows / stock_margin / stock_monthly_revenue ──┘
                                                                        ↓
                                              src/features.compute_features（純計算, G9）
                                                                        ↓
                                              stock_daily_features（key {stock_id}_{date}）
```

- 特徵生成：`src/tasks/feature_generate.py::generate_features`（Celery）。
- 讀取窗：`start - 400 天`（MA200 / 52 週高 / 250 日分位 warmup），只寫入 `[start_date, end_date]`。
- 特徵欄位定義：`.docs/charact.md`（§九）。

---

## 5. 排程（APScheduler，Asia/Taipei，cron 週一至五）

| Job | 內容 | Cron |
|---|---|---|
| `data_download` | watchlist 日K + 分K | `30 14 * * 1-5` |
| `vp_calculation` | 當日分價圖 + 清理 50 天 | `45 14 * * 1-5` |
| `tech_indicators` | watchlist 技術指標預計算 | `0 15 * * 1-5` |
| `research_ohlcv` | 研究 universe 日K + O1/C1（2 年窗增量） | `0 15 * * 1-5` |
| `research_flows` | 法人買賣超增量 | `30 15 * * 1-5` |
| `research_margin` | 融資融券增量 | `0 16 * * 1-5` |
| `research_revenue` | 月營收增量 | `30 16 * * 1-5` |
| `market_index_daily` | 市場指數每日增量 | `45 15 * * 1-5` |
| `market_index_backfill` | 市場指數回補 2 年 | `15 15 * * 0`（週日） |
| `history_cleanup` | 清理 14 天前分K + 50 天前 VP | `0 16 * * 4`（週四） |
| `strategy_hits_cleanup` | 清理已讀且 >30 天策略命中 | `0 17 * * 1-5` |

> cron 由原本 `0-4`（週日-四）改為 `1-5`（週一-五），確保盤後資料在下一個交易日晚上下載。

---

## 6. 驗證規則

1. **同源一致性**：`stock_daily_features.close == stock_daily.close`（相同 stock_id / date）——兩者讀同一份 yfinance OHLCV。
2. **新鮮度**：`stock_daily` 最新日期 ≥ 前一交易日；`stock_minute_1m` 最新 1m ≥ 當日 13:30。
3. **O1/C1 覆蓋率**：每檔研究股票 O1/C1 有值日數 ≥ 日K 日數的 95%（停牌除外）。
4. **回補可重入**：所有下載腳本可中斷重跑（resumable），不產生重複/覆寫錯誤。

---

## 7. 遷移清單（方案A 落地）

- [x] `feature_generate.py` 改讀 `stock_daily`（含 o1/c1）取代 `stock_daily_o1c1`
- [x] O1/C1 由 yfinance 60m 推導並回寫 `stock_daily`（`research_download.py::_upsert_daily`）
- [x] `research_ohlcv` 改寫：日K 寫 `stock_daily`、O1/C1 由 60m 推導（移除 `stock_daily_o1c1` 寫入）
- [x] `data_fetcher._store_daily` 寫入時保留既有 o1/c1（`overwrite=True` 不再抹除）
- [x] 一次性遷移腳本：`backend/scripts/migrate_o1c1_to_stock_daily.py`（將 o1/c1 複製入 `stock_daily`）
- [x] 4 個舊腳本加 DEPRECATED banner（`fetch_research_universe` / `fetch_missing_finmind` / `fetch_missing_twstock` / `fetch_o1c1_tpex`）
- [x] 移除已下市股票 6287（旺詮）於 universe JSON
- [x] 執行遷移腳本（o1/c1 複製入 `stock_daily`：27,990 rows）
- [x] 重算研究 universe `stock_daily_features`（28,420 rows）並驗證 §6.1（close 0 mismatch）
- [x] 刪除 `stock_daily_o1c1`（138,358 docs）
