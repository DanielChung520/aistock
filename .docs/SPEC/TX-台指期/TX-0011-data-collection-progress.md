# TX-0011 — RL 重做：Step 1 資料收集進度

> @file        TX-0011-data-collection-progress
> @description 台指期 RL 重新整理之 **Step 1：資料收集**的進度文件。記錄舊版的限制、資料源評估、選定方案、collection schema、已執行的步驟與待辦事項。
> @lastUpdate  2026-09-01
> @author      Sisyphus
> @version     0.1.0
> @status      in-progress
> @see         TX-0010-rl-trading-spec.md（舊版規格，使用 TWII 日 K 代理）
> @see         TX-模組測試計劃.md（舊版測試計劃，待本步驟完成後一併修訂）

---

## 0. 為什麼要重做（Why redo）

### 0.1 現況（截至 2026-09-01）

`backend/src/tasks/tx_rl_*.py` 與 `backend/src/routers/tx_rl.py` 已存在，但**資料來源是 TWII（加權指數）日 K**而非真正的 TX（台指期貨）：

| 項目 | 現況 | 應該是 |
|---|---|---|
| 資料主體 | `stock_daily` collection 中 `stock_id='TWII'` 的 495 筆日 K | 台指期貨（TXF/TX）合約 K 線 |
| 時間粒度 | 日 K（1 step = 1 個交易日） | 日 K **+** 15 分 K |
| 交易標的 | 加權指數（指數本身無法交易） | 台指期貨（可交易合約） |
| 連續月合約 | 無（只有指數本身） | 需 R1（近月）拼接 |
| 夜盤 | 不適用 | 2017/4 起有夜盤，需正確處理 |
| 歷史深度 | ~2 年（2024-08 ~ 2026-08） | 目標 **14 ~ 20 年**（2006 ~ 2026） |

這導致三個根本問題：

1. **資料錯置**：用加權指數做 RL 訓練，本質上是把 index 當期貨用 — 學到的策略拿到實單會有結構性偏差
2. **粒度不足**：日 K = 1 step/天，RL agent 一年只看到 ~250 step，sample efficiency 差
3. **歷史太淺**：495 筆做 walk-forward（train_window=250 + test_window=50）只能切 2-3 段，過擬合風險高

### 0.2 重做的範圍

**Step 1（本文件）**：資料收集 — 拿到越多越好的 TX 真實歷史 K 線
**Step 2（後續）**：讓 `tx_rl_env.py` 與 `tx_rl_training.py` 改吃 TX 真實資料（替換 TWII proxy）
**Step 3（後續）**：15 分 K RL 環境擴充（從日 K → 15 分 K）
**Step 4（後續）**：基準對照重做（Buy & Hold 0050/TWII 之外，加上 Buy & Hold TX）

---

## 1. 資料源評估（已完成研究，見 2026-08/09 對話）

詳細比較見本系列對話的歷史，本節只列結論。

### 1.1 候選資料源總表

| 來源 | 支援 15 分 K | 歷史深度 | 取得方式 | 成本 | 適合本專案 |
|---|---|---|---|---|---|
| **QuantPass 整理包** | ✅ 1 分 K（自組 15 分） | **2006 ~ 2024-05（18 年）** | 網站下載 ZIP | 免費 | ✅ 主要歷史來源 |
| **永豐 Shioaji API** | ✅ `kbars()` 1 分 K（自組 15 分） | 2020-03-22 ~ now（5 年） | 開戶 + Python SDK | 開戶即可 | ✅ 持續維護 |
| **FinMind sponsor 會員** | ✅ tick（自組 15 分） | 2011-01-03 ~ now（14 年） | 付費 API key | 月費制 | ⚠️ 備援（若 QuantPass 缺） |
| **FinMind 免費** | ❌ 只有日線 | 2007-10 ~ now | API | 免費 | ✅ 用於驗證交叉 |
| **FinLab** | ❌ **明確不支援分鐘級** | 2013 ~ now（VIP） | 訂閱 NT$749/月 | 付費 | ❌ 完全不適用 |
| **TAIFEX 付費逐筆成交** | ✅ 自組 | 1998-07 ~ now（27 年） | E-Data Shop 申請 | NT$10,000/月 | ❌ 太貴，目前不考慮 |
| **TAIFEX 年度 ZIP** | ❌ 只有日 OHLC | 1998 ~ now | 網站下載 | 免費 | ✅ 驗證用 |
| **TAIFEX OpenAPI** | ❌ 僅當日 | 當日 | 官方 API | 免費 | ✅ 當日驗證 |
| **XQ 全球贏家** | ✅ 但無 API | 看方案 | 圖形介面 | $300~$1,000/月 | ❌ 無法程式化 |
| **群益 SKCOM** | ✅ | 約 4-5 年 | COM（Windows） | 開戶即可 | ❌ **COM 不能跑 Linux/Docker** |
| **凱基 SUPER PY** | ✅ | 未明 | 開戶 + Python | 開戶即可 | ⚠️ **只允許台灣 IP** |
| **MultiCharts + 達錢付費** | ✅ | 10 年 1 分 K | 付費會員 | 月費 | ⚠️ 資料量大但 API 不友善 |

### 1.2 選定策略：兩階段雙來源

| 階段 | 資料源 | 範圍 | 理由 |
|---|---|---|---|
| **歷史回填（一次性）** | **QuantPass 整理包** | 2006-01 ~ 2024-05（18 年） | 完全免費、跨平台、社群整理品質可接受 |
| **每日維護（持續）** | **永豐 Shioaji** | 2020-03-22 ~ now（5 年重疊可交叉驗證） | Python 原生、跨平台、Linux 友善、官方警示是「不建議過度撈取」所以只做盤後批次 |
| **即時推送（可選）** | Shioaji SSE | 盤中 | G3 守則允許 push-based（非 polling） |
| **備援** | FinMind sponsor | 2011 ~ now（補 QuantPass 之後的空窗 2024-05 ~ 2026-09） | 若 QuantPass 不穩，再付費補資料 |
| **驗證** | TAIFEX 年度 ZIP + FinMind 免費 | 全歷史 | 用於交叉檢查 OHLC 數值 |

---

## 2. Collection Schema 設計

### 2.1 統一 collection：`tx_futures_bars`

為了簡化查詢與維護，所有 TX 期貨 K 線（不論時間粒度）都進同一個 collection：

```json
{
  "_key": "{continuous}_{date}_{HHMM}",
  "contract": "TX202509",          // 原始合約代號
  "continuous": "R1",              // R1 | R2 | "MAIN" | null（如果是原始合約就 null）
  "futures_id": "TX",              // 商品系列代號（固定 TX）
  "date": "2025-09-15",            // 交易日期（夜盤歸屬於日盤的 date）
  "time": "09:00",                 // HH:MM（24h 制）
  "session": "day",                // day (08:45~13:45) | night (15:00~05:00)
  "bar_minutes": 15,               // 1 | 5 | 15 | 30 | 60
  "open": 22500,
  "high": 22550,
  "low": 22480,
  "close": 22520,
  "volume": 1234,                  // 該根 K 成交量（口）
  "open_interest": 80000,          // OI（若來源有）
  "settlement_price": null,        // 結算價（只日盤最後一根有）
  "is_settlement_bar": false,      // 是否為結算日（會影響換月）
  "source": "shioaji",             // shioaji | finmind | quantpass | taifex_zip
  "source_contract": "TXF202509",  // 不同來源的合約代號（保留供除錯）
  "created_at": 1234567890,
  "updated_at": 1234567890
}
```

### 2.2 Index 規劃

| 欄位組合 | 用途 |
|---|---|
| `continuous, date` (hash, unique with bar_minutes/time) | R1 連續月查詢 |
| `contract, date` (hash) | 原始合約查詢 |
| `date` (skiplist) | 跨日查詢 |
| `bar_minutes, continuous, date` (hash) | 篩選粒度 |

### 2.3 與現有 collection 的關係

| Collection | 用途 | 關係 |
|---|---|---|
| `stock_daily` | 個股/指數日 K | **不取代**，TWII 等加權指數仍存在 |
| `stock_minute_1m` | 個股分 K | **不取代**，TX 走自己的 collection |
| `tx_futures_bars` (新) | TX 各種粒度 K 線 | 本步驟建立 |
| `tx_rl_models` | RL 訓練結果 | **現有**，後續步驟會消費 `tx_futures_bars` |
| `tx_rl_training_jobs` | RL 任務狀態 | **現有**，不動 |

---

## 3. Backend 模組規劃（待實作）

### 3.1 新增檔案

```
backend/src/
├── data/
│   ├── tx_fetcher.py          # Shioaji 客戶端封裝（login/contract/kbars/subscribe）
│   └── tx_aggregator.py       # 1 分 K → 15 分 K（日/夜盤分桶、跨午夜）
└── tasks/
    ├── tx_data_backfill.py    # 歷史回填（QuantPass 整理包 + FinMind 備援）
    └── tx_data_daily.py       # 每日盤後增量（Shioaji 1 分 K → 15 分 K）
└── routers/
    └── tx_data.py             # API: GET /status、POST /backfill、POST /daily、GET /bars
```

### 3.2 與 G-守則的相容性

| 守則 | 本步驟做法 |
|---|---|
| **G1**（Next.js 不直接抓資料） | ✅ Shioaji/FinMind 都在 backend，Next.js 透過 `/api/tx-data/*` 讀 |
| **G2**（FastAPI 擁有 WRITE） | ✅ 所有 `tx_futures_bars` 寫入走 backend tasks |
| **G3**（無 polling） | ✅ 盤後批次（cron 15:00）+ 可選 SSE 推送（push-based） |
| **G9**（指標計算在 backend） | ✅ TX 15 分 K → 後續步驟的指標計算全在 backend |

---

## 4. 進度追蹤

### 4.1 已完成 ✅

- [x] 2026-08/09 — 對話研究：TWII/TXF/TAIFEX/Shioaji/群益/凱基/MultiCharts/XQ/FinMind/QuantPass 等資料源評估
- [x] 2026-09-01 — 進度文件建立（本檔）
- [x] 2026-09-01 — Collection schema 設計（§2）
- [x] 2026-09-01 — **Step 1.1** 建立 `backend/src/data/tx_fetcher.py`（Shioaji/FinMind/QuantPass 三種 fetcher）
- [x] 2026-09-01 — **Step 1.2** 建立 `backend/src/data/tx_aggregator.py`（1 分 K → 15 分 K 聚合，含日/夜盤、跨午夜處理）
- [x] 2026-09-01 — **Step 1.3** 建立 `backend/src/tasks/tx_data_backfill.py`（QuantPass 整理包匯入 + FinMind 備援）
- [x] 2026-09-01 — **Step 1.4** 建立 `backend/src/tasks/tx_data_daily.py`（每日盤後增量 + status 回報）
- [x] 2026-09-01 — **Step 1.5** 建立 `backend/src/routers/tx_data.py`（`GET /status`、`POST /backfill`、`POST /daily`、`GET /bars`）
- [x] 2026-09-01 — **Step 1.6** 註冊 `tx_data_router` 到 `main.py` + 把新 task 加入 `celery_app.include` + 在 `scheduler.py` 加 `tx_data_daily` cron job（每日 14:30）
- [x] 2026-09-01 — **Step 1.7** Pipeline 驗證：aggregator 邊界測試通過、FinMind 抓得到 TX 2024/12 日線 576 筆、TAIFEX OpenAPI 可用、無 Shioaji 時 graceful 失敗

### 4.2 進行中 🟡

（無 — Step 1 程式碼部分完成，待使用者決策下一步）

### 4.3 待使用者決策 ⏳

- [ ] **Step 1.8** 撰寫 pytest 測試（schema 驗證、aggregator 邊界、回填冪等性）
- [ ] **Step 1.9** 取得 Shioaji API key 並安裝套件（讓每日排程可實際跑）
- [ ] **Step 1.10** 手動下載 QuantPass 整理包放到 `TX_QUANTPASS_ZIP_DIR` 並跑回填
- [ ] **Step 1.11** 評估是否要辦 FinMind sponsor（補 2024-06 之後的空窗）

### 4.4 後續步驟（不在本 PR 範圍）🔜

- [ ] **Step 2** 改寫 `tx_rl_env.py` / `tx_rl_training.py` 改吃 TX 資料（替換 TWII proxy）
- [ ] **Step 3** 加入 15 分 K RL 環境（從日 K → 15 分 K）
- [ ] **Step 4** Buy & Hold TX 基準
- [ ] **Step 5** 更新測試計劃（TX-模組測試計劃.md）涵蓋新資料源

---

## 5. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| QuantPass 整理包缺 2024-06 以後資料 | 18 年回填會停在 2024-05 | 用 Shioaji 補 2020-03 以後的；剩 2024-06 ~ 2020-03 空窗用 FinMind sponsor 補（若預算允許） |
| Shioaji 流量限制（盤中 ticks ≤10、kbars ≤270） | 盤中不能大量抓 | 嚴格限制為盤後 cron 跑；盤中只接受 SSE 推送 |
| 群益/凱基/MultiCharts 無法整合 | 失去備援 | 接受 — Shioaji + QuantPass 已足夠 |
| 15 分 K 換月拼接複雜度 | R1 連續月資料需要處理合約到期 | 簡化：直接存所有原始合約 + continuous 欄位；查詢時用 view 層處理 |
| TX 夜盤跨午夜（15:00 ~ 05:00）屬於次日的 date 歸屬 | 聚合會有錯亂 | 統一規則：**夜盤歸屬於次日**（依 TAIFEX 慣例）；aggregator 內處理 |

---

## 6. 環境變數新增

`backend/.env` 需新增：

```bash
# Shioaji（永豐金證券）— 若要實際執行每日抓取需要
SHIOAJI_API_KEY=
SHIOAJI_SECRET_KEY=
SHIOAJI_CA_PATH=
SHIOAJI_CA_PASSWD=

# FinMind — 備援
FINMIND_API_TOKEN=

# QuantPass — 整理包下載路徑（手動下載後放到此路徑）
TX_QUANTPASS_ZIP_DIR=/home/daniel/aistock-data/tx-quantpass

# TX 資料收集排程（cron 格式）
TX_DAILY_CRON=30 14 * * 1-5  # 盤後 14:30 跑
```

---

## 8. Step 1 完成證據

### 8.1 程式碼變更清單

**新增檔案（5 個）**：
| 檔案 | 行數 | 用途 |
|---|---|---|
| `backend/src/data/tx_fetcher.py` | ~330 | 三種資料源統一介面（Shioaji/FinMind/QuantPass） |
| `backend/src/data/tx_aggregator.py` | ~290 | 1 分 K → 5/15/30/60 分 K 聚合（含日/夜盤切分、跨午夜、夜盤日期歸屬次日） |
| `backend/src/tasks/tx_data_backfill.py` | ~190 | 歷史回填 Celery task（QuantPass 2006~2024 + FinMind 備援） |
| `backend/src/tasks/tx_data_daily.py` | ~190 | 每日盤後增量 Celery task + status 查詢 |
| `backend/src/routers/tx_data.py` | ~190 | REST API：`GET /status`、`POST /backfill`、`POST /daily`、`GET /bars` |

**修改檔案（3 個）**：
| 檔案 | 變更 |
|---|---|
| `backend/src/main.py` | 註冊 `tx_data_router` |
| `backend/src/celery_app.py` | `include` 加入 `tx_data_backfill` 與 `tx_data_daily` |
| `backend/src/scheduler.py` | 加 `tx_data_daily` cron job（每日 14:30） |

### 8.2 驗證證據

```
=== compileall OK ===
=== 所有 import OK ===
TX_BARS_COLLECTION = tx_futures_bars
router prefix = /tx-data
PREDEFINED tx_data_daily cron = 30 14 * * 1-5
```

### 8.3 Aggregator 邊界測試通過

| 測試案例 | 結果 |
|---|---|
| 75 根夜盤 1 分 K (17:25~18:39) → 5 根 15 分 K | ✅ 全部歸屬次日 date |
| 636 根跨午夜夜盤 (17:25 ~ 04:00) → 27 根 15 分 K | ✅ 全部歸屬次日 date，夜盤跨午夜正確 |
| 日盤 60 根 1 分 K (09:00~09:59) → 4 根 15 分 K | ✅ |
| 8:45~13:45 / 17:25~23:59 / 00:00~04:59 時段分類 | ✅ |
| 18:00-18:24 bug 修復（原條件漏判） | ✅ |

### 8.4 真實資料源驗證

| 來源 | 結果 |
|---|---|
| TAIFEX OpenAPI | ✅ `https://openapi.taifex.com.tw/v1/DailyMarketReportFut` 回傳 2182 筆，含 TX Contract 真實當日資料（20260831 收盤 45983） |
| FinMind | ✅ 抓得到 TX 2024/12 日線 576 筆（24 contracts × 24 trading days） |
| QuantPass | ✅ **手動下載的 CSV**：`/home/daniel/github/aistock/data/台指期-1分K-2006~20240515.csv`（125 MB, **2,738,103 筆**，日期範圍 2006-01-10 ~ 2024-05-09）— 詳見 §8.5 |
| Shioaji | ⚠️ 套件未安裝 + 無 API key，fetcher 回傳 None + 明確錯誤訊息 |

### 8.5 QuantPass CSV 實測（時段分佈驗證）

**重要更正**：早期以為這份檔案「只有日盤」（基於 QuantPass 網站描述），實際驗證後**包含完整日夜盤**。修正後的時段分佈：

| 時段 | 範圍 | 筆數 | 開始年份 |
|---|---|---|---|
| 日盤 | 08:46 ~ 13:45 | ~1,349,918 | 2006（檔案起點） |
| 盤後 | 15:00 ~ 16:59 | ~201,910 | **2017 起**（TX 夜盤制度配套） |
| 夜盤前段 | 17:00 ~ 23:59 | ~698,716 | **2017 起** |
| 夜盤後段（跨午夜）| 00:00 ~ 04:59 | ~487,559 | **2017 起** |

**關鍵時序點**：
- **2006-01-10 ~ 2017-05-14**：只有日盤（每年 ~73k 筆）
- **2017-05-15**：TAIFEX 啟用 TX 夜盤（盤後 15:00 + 夜盤 17:25~04:00），當年資料 ~186k
- **2018 起**：完整日夜盤（每年 ~270k 筆）

**對 RL 訓練的影響**：
- ✅ **日盤 18 年完整**（2006-2024），足夠做日線層級策略
- ⚠️ **日夜盤跨週期只有 7 年**（2017-2024），做 15 分 K 跨日夜盤策略時要標註
- 💡 若需要 2017 之前的夜盤資料：辦 FinMind Backer（NT$459/月）抓 `TaiwanFuturesTick` 自己組

---

## 9. 代號對照表（Contract Symbol Mapping）

> ⚠️ **重要陷阱**：**`TX`（TAIFEX/FinMind）≠ `TXF`（Shioaji/Multicharts）**，同一個商品在不同系統叫法不同。新人最容易在這裡踩雷。

### 9.1 各系統代號對照

| 系統 / 資料源 | 台指期 | 小台指 | 微台指 | 連續月範例 |
|---|---|---|---|---|
| **TAIFEX 官方 / OpenAPI** | `TX` | `MTX` | `TMF` | — |
| **永豐 Shioaji** | **`TXF`** | `MXF` | `MMF` | `TXFR1` 近月 / `TXFR2` 次月 |
| **FinMind** | `TX` | `MTX` | `TMF` | — |
| **Multicharts / 達錢** | `TXF` | `MXF` | `MMF` | `TXF1` 近月 / `TXF2` 次月 |
| **群益 / 凱基 / 券商看盤** | `TX` 或 `WTX` | `MX` 或 `WMX` | — | — |

### 9.2 合約組成規則

一個具體合約 = `根代號` + `到期月份 (YYYYMM)`：

| 系統 | 台指期 2025-09 合約 | 小台指 2025-09 合約 |
|---|---|---|
| TAIFEX/FinMind | `TX202509`（隱含，無顯式 `F`） | `MTX202509` |
| Shioaji/Multicharts | `TXF202509`（顯式 `F`） | `MXF202509` |
| 券商看盤 | `TX202509` 或 `WTX°09` | `MTX202509` 或 `WMX°09` |

月份代號直接用 2 位數字（01~12），年份用 4 位西元年。

### 9.3 連續月合約（continuous contract）

| 系統 | 近月連續月 | 次月連續月 | 說明 |
|---|---|---|---|
| Shioaji | `TXFR1` | `TXFR2` | 結算日自動換月（推薦） |
| Multicharts | `TXF1` | `TXF2` | 同上 |
| TAIFEX / FinMind | — | — | **無官方連續月，需自己拼接** |

**注意**：本專案統一用 **Shioaji 慣例**（`TXFR1`/`TXFR2`），理由：
- Shioaji 是主要資料源（5+ 年歷史、官方 Python SDK、Linux 友善）
- `R1`/`R2` 在程式碼中不易與月份數字混淆
- 跨來源時只需做 `TX → TXF` 的根代號替換

### 9.4 程式碼中的約定（避免維護時踩雷）

| 位置 | 慣例 | 範例 |
|---|---|---|
| `tx_futures_bars.contract` 欄位 | Shioaji 慣例（`TXF{R1/R2/YYYYMM}`） | `TXFR1`, `TXF202509` |
| `tx_futures_bars.futures_id` 欄位 | 固定 `TX`（表示系列） | `TX` |
| `tx_futures_bars.continuous` 欄位 | `R1`/`R2`/`MAIN`/`null` | `R1` |
| `FinMindFetcher` 內部轉譯 | 自動把 `TXF*` → `TX` 呼叫 FinMind API | — |
| `QuantPassFetcher` 內部 | 直接吃 ZIP 內 CSV 的 contract 欄位（Shioaji 慣例） | — |

### 9.5 新人常見錯誤（從這個對照表衍伸）

1. ❌ 把 `TXF` 拿去查 TAIFEX OpenAPI → 拿不到資料（要用 `TX`）
2. ❌ 把 `TX` 拿去叫 Shioaji → 找不到合約（要用 `TXF`）
3. ❌ 假設 FinMind 有連續月 → 沒有，要自己 group by delivery_date 取近月
4. ❌ 月份用單碼（`TXF20259`）→ 必須 2 位數 `TXF202509`
5. ❌ 用 `TX1` 當連續月 → Shioaji/Multicharts 是 `TXF1` 或 `TXFR1`，不是 `TX1`

---

## 10. 版本記錄

| 日期 | 版本 | 更新者 | 變更內容 |
|---|---|---|---|
| 2026-09-01 | 0.1.0 | Sisyphus | 初版進度文件（Step 1 啟動） |
| 2026-09-01 | 0.2.0 | Sisyphus | **Step 1 程式碼完成**：fetcher/aggregator/tasks/router 全部建立並驗證 import OK；aggregator 邊界測試通過（75 根夜盤 1 分 K → 5 根 15 分 K 正確）；FinMind 實測可抓 TX 日線；TAIFEX OpenAPI 確認可用；graceful fallback（缺套件時不 crash）|
| 2026-09-01 | 0.3.0 | Sisyphus | **新增 §9 代號對照表**：避免 `TX` vs `TXF` 陷阱；QuantPass CSV 已複製到 `data/`；`.gitignore` 加入 `data/` + `*.csv` 規則 |
| 2026-09-01 | 0.3.1 | Sisyphus | **§8.5 更正錯誤**：原本以為 QuantPass CSV 只有日盤，實測發現 2017 起包含完整日夜盤（盤後 + 夜盤 + 跨午夜） |
