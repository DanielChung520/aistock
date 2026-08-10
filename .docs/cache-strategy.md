# aiStock 快取策略

> 最後更新: 2026-07-07 (實作完成)
> 範圍: Frontend IndexedDB cache + Backend ArangoDB 儲存策略

---

## 一、核心哲學

```
ArangoDB = Source of Truth（全部歷史，永久的）
IndexedDB = Frontend 加速層（TTL 內不重複打 API）
Memory  = Session 內加速（同頁切換不重複讀 IndexedDB）
```

---

## 二、Backend Storage（ArangoDB）

| Collection | 保存策略 | 用途 |
|---|---|---|
| `stock_daily` | 全部歷史，永久 | 日K、週K、月K 由後端聚合; AI 訓練 |
| `stock_minute_1m` | **近 2 週**，滾動刪除 | 1 分K raw data，前端自行聚合各分K |
| `stock_indicators` | **不存**，按需計算 | MA/KDJ/MACD/RSI/BB，每次請求即時算 |

### AI 分析

ArangoDB 保有完整日K，AI 特徵工程直接 `SELECT * FROM stock_daily` 不用等前端。

---

## 三、Frontend Cache（IndexedDB）

### 底層

- 使用 [`idb-keyval`](https://github.com/jakearchibald/idb-keyval)（輕量 key-value wrapper）
- Namespace: `aistock:v1`

### 介面

```typescript
cachedFetch<T>({ key, category, fetcher, force? })
// → { data, isStale, didFetch, refetch, storedAt }
```

### 行為流程

```
請求 → 檢查 IndexedDB
  ├─ 命中且新鮮（TTL 內）→ 直接回傳 data，不發 API
  ├─ 命中但過期（stale） → 回傳舊 data + 背景發起 refresh
  └─ 未命中 / force      → 發起 fetch → 存入 cache → 回傳
```

### TTL 表

定義在 `frontend/src/lib/cache/cache-keys.ts`

| Category | TTL | 典型資料 |
|---|---|---|
| `strategy-unread-count` | 30 秒 | 未讀數 badge 計數 |
| `stock-quote` | 1 分鐘 | 即時報價 |
| `stock-minute` | 1 分鐘 | 分K OHLCV |
| `stock-minute-indicators` | 1 分鐘 | 分K 指標 |
| `taiex-quote` | 5 分鐘 | 加權指數報價 |
| `taiex-history` | 5 分鐘 | 加權歷史 |
| `taiex-indicators` | 5 分鐘 | 加權指標 |
| `strategy-hits` | 5 分鐘 | 條件命中歷史清單 |
| `news-today` | 10 分鐘 | 今日新聞 |
| `search` | 30 分鐘 | 搜尋結果 |
| `stock-history` | 1 小時 | 日K OHLCV |
| `stock-indicators` | 1 小時 | 日K 技術指標 |
| `stock-analysis` | 1 小時 | 四大買賣點分析 |
| `stock-catalog` | 24 小時 | 1845+ 股票清單 |
| `menu` | 24 小時 | 側邊欄選單 |
| `watchlist` | 0（不快取） | 自選股清單 |

> `strategy-hits` 與 `strategy-unread-count` 兩類為通知中心（strategy drawer）新增：
> 策略掃描命中歷史清單與未讀數 badge 皆來自後端策略 API，短 TTL 確保畫面切換後能快速反映最新掃描結果。

### Cache Key 結構

```
makeCacheKey(category, ...parts)
→ "stock-history:2330:months=6"
→ "stock-indicators:2330:months=6&ma_periods=5,10,20,60"
→ "stock-minute:2330:days=14&interval=5m"
→ "search:q=2330"
→ "stock-analysis:2330:best-four-point"
```

### 去重在途請求（inflight dedup）

同一個 key 的多個同時請求只發起一次 fetch，後續呼叫 join 同一支 Promise。
定義在 `cache-fetch.ts` 的 `inflight` Map。

### 手動失效

```typescript
import { invalidate, invalidateCategory } from '@/lib/cache/cache-fetch'

invalidate('stock-history:2330:months=6')   // 刪除特定 key
invalidateCategory('watchlist')              // no-op（idb-keyval 不支援 prefix scan）
```

---

## 四、個股資料快取明細

所有呼叫集中在 `StockDetailPanel.tsx`，共 6 個 `cachedFetch`：

### 頁面載入順序

```
StockDetailPanel mount
  │
  ├─ (1) /api/stocks/search?q={symbol}             cache: search       TTL 30min
  │      → 取得股票名稱
  │
  ├─ (2) /api/stocks/{symbol}/analysis/best-four-point  cache: stock-analysis  TTL 1h
  │      → 四大買賣點分析（drawer 用）
  │
  └─ (3)+(4) Promise.all
       ├─ /api/stocks/{symbol}/history?months=N    cache: stock-history TTL 1h
       └─ /api/stocks/{symbol}/indicators?...       cache: stock-indicators TTL 1h

當 timeframe = minute 時額外：
  ├─ (5) /api/stocks/{symbol}/minute-history?...   cache: stock-minute  TTL 1min
  └─ (6) /api/stocks/{symbol}/minute-indicators?.. cache: stock-minute-indicators TTL 1min
```

### 設定變更時的行為

Indicator settings 變更 → `settingsChanged` 偵測 → `debounce 500ms` → 重打 history + indicators。
由於 cache key 包含 `indicatorParams`，不同設定是不同 key，各自獨立快取。

---

## 五、單支股票儲存預估

實測台積電 2330 數據：

### 日K（11.5 年 = 2795 交易日）

| 資料 | JSON | IndexedDB 估 |
|---|---|---|
| OHLCV | 295 KB | ~400 KB |
| MA 5 條線 | 253 KB | ~350 KB |
| KDJ | 145 KB | ~200 KB |
| MACD | 178 KB | ~250 KB |
| 布林通道 | 185 KB | ~260 KB |
| RSI | 92 KB | ~130 KB |
| 全部指標合計 | 833 KB | ~1.2 MB |
| **OHLCV + 全部** | **1.1 MB** | **~1.6 MB** |

### 分K（2 週）

| 資料 | JSON | IndexedDB 估 |
|---|---|---|
| 5分K OHLCV（743 筆） | 80 KB | ~120 KB |
| 5分K + 全部指標 | 306 KB | ~460 KB |
| 1分K OHLCV（1855 筆） | 200 KB | ~300 KB |
| 1分K + 全部指標 | ~770 KB | ~1.2 MB |

### 20 支股票全開預估

| 情境 | IndexedDB |
|---|---|
| 日K 10年 + 2~3 指標 × 20 支 | ~20 MB |
| 日K + 全指標 × 20 支 | ~40 MB |
| 含分K 2週（只看 5 支） | +~3 MB |

### 瀏覽器容納

| 瀏覽器 | 配額 | 風險 |
|---|---|---|
| Chrome | 可用磁碟 80%（至少數 GB） | 無 |
| Firefox | 無上限 | 無 |
| Safari macOS | ~1 GB | 無 |
| Safari iOS | ~50 MB | ⚠️ 接近但仍在範圍 |

---

## 六、已實作狀態（2026-07-07）

### Backend: ArangoDB 持久化

```
ArangoDB
├── stock_daily      全部歷史，永久保存  ← AI 分析直接讀
├── stock_minute_1m  近 2 週，可定期清理
└── stock_indicators 不存，按需計算
```

`fetch_daily_history()` 流程：
```
1. 檢查 ArangoDB stock_daily 是否已有資料
2. 有 → 回傳（若最新資料在 7 天內）
3. 無或過舊 → 從 yfinance 抓 → 存入 ArangoDB → 回傳
```

`fetch_minute_history()` 流程：
```
1. 嘗試從 ArangoDB stock_minute_1m 讀取
2. 無或過舊 → 從 yfinance 抓 1m raw → 存入 ArangoDB
3. 從 1m raw 依 interval 參數即時聚合（1→5/10/15/30/60）
```

### Backend: `/bars` 端點

```http
GET /api/stocks/{symbol}/bars?resolution=D|W|M|1|5|15|30|60&from=DATE&to=DATE&months=N&days=N
```

| resolution | 來源 | 說明 |
|---|---|---|
| `D` | stock_daily | 原始日K |
| `W` | stock_daily 聚合 | ISO 週 OHLCV |
| `M` | stock_daily 聚合 | 月 OHLCV |
| `1/5/15/30/60` | stock_minute_1m 聚合 | 分K（後端從 1m raw 即時聚合） |

### Frontend: Memory Cache

`frontend/src/lib/cache/memory-cache.ts`
- Session-level `Map<string, T>` cache
- 預設 TTL 5 分鐘
- 優先於 API 請求，同一頁 session 內不重複 fetch

### Frontend: StockDetailPanel 重構

- 日K 改用 `GET /bars?resolution=D&months=N` + Memory Cache
- 分K 改用 `GET /bars?resolution=5&days=N` + Memory Cache
- 技術指標仍走 `cachedFetch`（屬後端計算，非純讀取）
- `StockHistoryItem` type 修正：`stock_id/change/turnover/transaction` 改為 optional

### 對 AI 分析的影響

```
AI 訓練 → SELECT * FROM stock_daily WHERE stock_id = '2330' ORDER BY date
           → 完整日K，不經過前端，不經過快取
```

### 清理任務

```python
# 排程：刪除超過 14 天的分K資料
from src.data_fetcher import purge_old_minute_data
purge_old_minute_data(retain_days=14)
```
