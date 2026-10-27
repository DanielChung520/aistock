# 需求定位：證券帳務管理（Accounting Ledger）

> 狀態：討論收斂中，**帳務先行**，尚未進入實作
> 日期：2026-10-27
> 關聯：工作站需求（hermes `req-aistock-workstation`、`req-aistock-accounting-model`）
> 關聯 skill：`需求`（graph-guided requirements）
> 既有相關文件：`.docs/simulation-replay.md`（紙上模擬交易）

---

## 0. 為什麼需要這份文件

repo 目前有**三套彼此獨立、帳務語義互不相同**的「模擬/交易」系統，且**完全沒有持倉/帳務的持久層**：

| 系統 | 領域 | 帳務基礎 | 費用 | 現金/股數 |
|---|---|---|---|---|
| `backend/src/simulation.py` | 股票紙上下單 | 現金+股數+移動平均成本 | 股票 0.1425% / 0.1425%+稅 0.3% | ✅ |
| `backend/src/backtest.py` | 股票策略回測 | **純比例（%）** | ❌ 無 | ❌ |
| `backend/src/tasks/tx_rl_env.py` | 期貨 RL 訓練 | 口數+保證金+每日結算 | 期貨 滑價 0.3%×2 / 手續費 0.15%×2 | ✅ |

工作站需求中的「**工作站2：若已買入 → 分K 停利/停損/加倉監控**」缺少「持倉 / 成本」這個真相來源。
本文件定義**統一帳務核心（統一帳本）**，作為工作站2 的前置依賴。

---

## 1. 需求概述與關鍵面向

**核心動機**：建立一本**統一的持倉帳本**，服務多個訊號來源（策略掃描 / 紙上模擬 / 手動輸入 / 未來券商同步），
並支援「現在是模擬、未來轉正式」的演進。

**關鍵面向（3）**：
1. **統一持倉帳本** — 事件溯源：`ledger → positions → pnl`，一本帳、多來源。
2. **紙上 / 正式可區隔且可轉正** — 模型須能區隔且能安全晉升，不污染歷史。
3. **台股帳務正確性** — 稅費、移動平均成本、**除權息調整**、**T+2 交割**。

---

## 2. 已收斂決策

| # | 決策點 | 決策 | 理由 |
|---|---|---|---|
| 1 | 順序 | **帳務先行**，工作站後做 | 帳務不依賴 `G3`（禁盤中即時）爭議；工作站會被 G3 卡住 |
| 2 | 帳務深度 | **持倉帳**（a），非完整券商帳 | 先落地核心；交割款/融資券列為擴充 |
| 3 | 資料來源 | **手動記帳**（a），schema 對 `statement`/`broker_api` 相容 | 零門檻、不碰憑證；日後加來源不改模型 |
| 4 | 性質區隔 | `accounts.kind` = `paper` / `real` / `backtest`（**enum，非布林**） | 未來轉正式帳本；也是三套模擬共存的接縫 |
| 5 | 來源維度 | `accounts.source` = `manual` / `statement` / `broker_api`（**與 kind 正交**） | 「手動記的真實帳」需可組合，不可塞進同一欄位 |
| 6 | 帳本不可變 | **`ledger` append-only** | 正式帳本定義即不可竄改；現在做成本低，日後補要重建歷史 |
| 7 | 轉正方式 | **開新 `real` 帳 + 期初分錄**，不就地改 `kind` | 避免歷史模擬交易被語義污染 |
| 8 | 成本法 | **移動平均**（含買進費用），沿用 `simulation.py` | 台股券商慣例；既有實作已採用 |
| 9 | 事件來源 | **人工記錄為主，不做自動下單** | 與 `simulation.py`「signals are informational only」及工作站「人工決定買入」哲學一致 |
| 10 | 通知 | 本階段**延後**（暫無 LINE / 站內通知） | 使用者指示 |
| 11 | paper 帳轉正後處置 | **保留為唯讀存檔**（`status: archived`） | 保留審計軌跡；符合 append-only 精神 |

---

## 3. 圖譜摘要（既有資產）

### 3.1 可重用
| 模組 | 角色 |
|---|---|
| `backend/src/simulation.py` `_buy` / `_sell` | 台股成本·稅費·損益數學（可抽成 pure function） |
| `backend/src/simulation.py` `SimState` | 單檔持倉狀態形狀（`cash`/`shares`/`avg_cost`/`total_fees`） |
| `backend/src/simulation.py` `trades[]` | **交易流水雛形**（`date`/`action`/`price`/`shares`/`fee`/`pnl`/`avg_cost`） |
| `backend/src/backtest.py` `stop_loss_pct` / `max_hold_bars` | 停損 / 最大持倉語義 |
| `backend/src/services/*_store.py` | ArangoDB 集合存取模式（`ensure_collection` / `_doc` / CRUD） |
| `sdk/fubon/` | 未來 `ledger` 寫入來源（券商 API；需憑證＋交易權限） |
| `.docs/simulation-replay.md` | 紙上交易既有規格（下單/成交/費用/均價） |

### 3.2 必須新造
`accounts` / `positions` / `ledger` / `corporate_actions` 集合、持久化、除權息調整、T+2 交割、費用規則表。

### 3.3 保持獨立（**不整合**）
- `backend/src/backtest.py` — 比例制回測（策略品質評估器，非帳務）。
- `backend/src/tasks/tx_rl_env.py` — 期貨 RL 訓練環境（保證金/每日結算，語義不同）。
- `auction/*` — 競拍投標（非次級市場持倉）。

> 未來若需要，backtest / tx_rl 可透過 `kind` 掛入同一帳務核心（`kind: backtest`），但**不在本階段**。

---

## 4. 資料模型（ArangoDB 集合）

> 命名與存取慣例沿用 `backend/src/services/strategy_store.py`（`ensure_collection` + `_doc` 投影 + 參數化 AQL）。

### 4.1 `accounts` — 帳戶主體

| 欄位 | 型別 | 說明 |
|---|---|---|
| `_key` | string | `acc_<hex>` |
| `name` | string | 例：「紙上帳-富邦」 |
| `kind` | enum | `paper` \| `real` \| `backtest` — **帳的性質** |
| `source` | enum | `manual` \| `statement` \| `broker_api` — **資料來源（正交）** |
| `broker` | string\|null | `fubon` \| `yuanta` \| …；`real` 才需要 |
| `currency` | string | `TWD`（預設） |
| `status` | enum | `active` \| `archived` |
| `promoted_from` | string\|null | 轉正來源 paper 帳 `_key`（審計） |
| `promoted_at` | number\|null | 轉正時間（epoch 秒） |
| `opened_at` | number | 開帳時間 |
| `created_at` / `updated_at` | number | 稽核 |

> **kind 與 source 不可合併**：一本 `real` 帳可以是 `manual`；`paper` 帳恆為 `manual`。

### 4.2 `ledger` — 流水（**append-only**）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `_key` | string | `led_<hex>`，或 `uuid` 保證唯一 |
| `account_id` | string | → `accounts._key` |
| `seq` | number | 帳內單調序號（同一帳內唯一遞增） |
| `posted_at` | number | 記帳時間（系統時間） |
| `trade_date` | string | 成交/事件日（YYYY-MM-DD） |
| `settle_date` | string\|null | 交割日（股票 = trade_date + 2 交易日） |
| `action` | enum | `buy` \| `sell` \| `dividend` \| `corporate_action` \| `fee` \| `deposit` \| `withdraw` \| `opening` |
| `symbol` | string\|null | 股票代碼（非證券事件為 null） |
| `price` | number\|null | 成交單價 |
| `shares` | number\|null | 股數（買正、賣正；方向由 `action` 決定） |
| `gross` | number\|null | 價金（`price × shares`） |
| `fee` | number | 手續費 |
| `tax` | number | 交易稅 |
| `net` | number | 現金淨流量（買為負、賣/股利為正） |
| `source` | enum | `manual` \| `statement` \| `broker_api`（entry 層級來源） |
| `external_ref` | string\|null | 對帳單/券商成交編號（未來對帳用） |
| `reversal_of` | string\|null | 沖銷指向的原分錄 `_key`（見 §5） |
| `note` | string | 備註 |

### 4.3 `positions` — 持倉（由 `ledger` 推導，可物化快取）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `_key` | string | `<account_id>_<symbol>` |
| `account_id` | string | → `accounts._key` |
| `symbol` | string | 股票代碼 |
| `shares` | number | 現有股數 |
| `avg_cost` | number | 移動平均成本（**含買進費用**） |
| `realized_pnl` | number | 該檔累計已實現損益 |
| `last_trade_at` | number | 最後一筆交易時間 |
| `updated_at` | number | 推導時間 |

> `positions` 是 ledger 的**投影**，可隨時由 ledger 完整重建。物化僅為讀取效能；**ledger 才是真相來源**。

### 4.4 `corporate_actions` — 除權息事件

| 欄位 | 型別 | 說明 |
|---|---|---|
| `_key` | string | `<symbol>_<ex_date>` |
| `symbol` | string | 股票代碼 |
| `ex_date` | string | 除權息交易日 |
| `type` | enum | `dividend`（除息）\| `right`（除權）\| `both` |
| `cash_dividend` | number | 每股現金股利（元） |
| `stock_ratio` | number | 每股配股率（股/股） |
| `source_ref` | string\|null | 資料來源（twstock / 公開資訊觀測站） |

---

## 5. Append-only 與沖銷規則

1. `ledger` **只增不改不刪**。任何更正以**反向分錄**為之：新增一筆 `reversal_of` 指向原分錄、金額/股數取負。
2. 原分錄永不刪除，保留完整審計軌跡。
3. `positions` 為投影，可重建；重建邏輯須能處理 `reversal_of`。
4. 禁止以 UPDATE 改寫 `ledger` 的既有欄位（`posted_at` 等一經寫入即固定）。

---

## 6. 轉正流程（paper → real）

**原則：不就地改 `kind`；開新帳 + 期初分錄。**

```
1. 使用者在 paper 帳（kind=paper）操作一段時間
2. 決定轉正式：
   a. 建新帳 kind=real，source=manual（或 broker_api），promoted_from=<paper_acc_id>
   b. 對 paper 帳「當下狀態」寫入新 real 帳的期初分錄：
      - action=opening，逐檔帶入當時 shares + avg_cost
      - action=opening，帶入當時現金餘額（deposit）
   c. paper 帳 status → archived（唯讀存檔）
3. 只搬「當下狀態（持倉+現金）」，不搬流水歷史
```

> 概念等同會計的「**開帳分錄**」：新帳自某時點狀態起算，兩本帳各自自洽。

---

## 7. 費用規則表（股票，保留期貨擴充）

> 現行 `simulation.py` 以常數寫死（`BUY_FEE_RATE=0.001425`、`SELL_TAX_RATE=0.003`）。
> 帳務須改為**可查表的規則**，依商品/稅別選用。

| 商品 / 情境 | 手續費 | 交易稅 |
|---|---|---|
| 股票 — 買進 | 0.1425%（可券商折扣） | — |
| 股票 — 賣出 | 0.1425%（可券商折扣） | 0.3% |
| ETF — 賣出 | 0.1425% | **0.1%** |
| 現股當沖 — 賣出 | 0.1425% | **0.15%** |
| 零股 | 0.1425%（不足 20 元以 20 元計） | 同現股 |
| **期貨（擴充點，本階段不做）** | 依合約 | 期交稅 |

規則需支援：券商折扣係數、手續費最低 20 元、稅別選擇。**不得在帳務邏輯硬編碼常數。**

---

## 8. 除權息調整 + T+2 交割

### 8.1 除權息調整
持倉於 `ex_date` 當日，依 `corporate_actions` 自動產生分錄：

- **除息（cash_dividend）**：`action=dividend`，`net = shares × cash_dividend`（現金入帳）；**持倉股數不變、`avg_cost` 不變**（股利認列為收益）。
- **除權（stock_ratio）**：`action=corporate_action`，`shares ×= (1 + stock_ratio)`；**`avg_cost /= (1 + stock_ratio)`**（總成本不變、股數增加）。
- **兩者並存（both）**：先除息再除權（依公開資訊觀測站定義之順序）。

> ⚠️ `simulation.py` **完全沒有**除權息處理 → 長期持倉成本與損益會失真。此為**必要**補強項。

### 8.2 T+2 交割
- `trade_date` 為成交日；`settle_date = trade_date + 2 交易日`。
- **持倉**於 `trade_date` 即反映（T+0）。
- **現金**於 `settle_date` 實際動用（交割款）。
- 本階段採簡化模型：現金以 `trade_date`（T+0）即時反映，並**保留 `settle_date` 欄位**以利未來切換為真實 T+2（含交割帳、違約交割）。

---

## 9. 與 `simulation.py` 的重用邊界

| 對象 | 處置 |
|---|---|
| `_buy` / `_sell` 的成本·稅費·損益數學 | **抽成 `accounting/core.py` pure functions**（搭配 §7 費用規則表） |
| `SimState`（單檔） | **不改原檔結構**；帳務層以「帳戶 → 多持倉」承載，`SimState` 可視為單持倉的視圖 |
| `simulation.py` `advance()` 回放迴圈 | **保留**（回放是模擬器職責，非帳務） |
| `trades[]` | 升級為 `ledger` entry 形狀 |
| 紙上帳 | `simulation.py` 的模擬掛在 `kind=paper` 帳戶下，寫入同一本 ledger |

> 帳務核心**不得** import `simulation.py` 的回放邏輯；兩者共用的是 §7 + core 數學。

---

## 10. 與工作站2 的介面契約

```
工作站2（分K 停利/停損/加倉 監控）
   │  只讀
   ├──▶ positions.avg_cost / positions.shares   （計算停利停損基準）
   │
   └── 觸發 → 通知使用者（本階段延後；人工決定）
              │
              └─ 使用者於帳務 UI 記錄買/賣 ──▶ ledger（寫入）
```

- **工作站2 對帳務為唯讀**：不寫 `ledger`、不改 `positions`。
- 工作站2 綁定「帳戶」；同一工作站2 可切換掛在 `paper` 帳（試跑）或 `real` 帳（實戰）。
- 停利/停損條件以 `avg_cost` 為基準（相對成本的價格條件）；此需求**需要**現有條件 DSL 擴充（見 §11）。

---

## 11. 未決問題

| # | 問題 | 現況 |
|---|---|---|
| 1 | 條件 DSL 需支援 **OR**（停利 or 停損 or 加倉）與**相對成本運算元** | 現行 `_scan` 純 AND；腳本語言明文「不支援 or」 |
| 2 | 手續費精度（券商折扣、最低 20 元）採用到什麼程度 | 待定 |
| 3 | 幣別/精度（元 vs 分） | 暫定 TWD、整數元以下 2 位 |
| 4 | 帳務 REST API 與前端頁面位置（sidebar / 新 tab） | 待定（受 `G16` tab 模型約束） |
| 5 | 多帳戶/多券商是否本階段支援 | 建議 schema 保留 `account_id`，先單帳 |
| 6 | 帳務資料的隱私/加密（ArangoDB 明文？） | 待定（守則未涵蓋） |

---

## 12. 實作順序建議（草）

1. `accounting/core.py`：抽 `_buy`/`_sell` 數學 + 費用規則表（pure，附測試）。
2. `services/account_store.py` / `ledger_store.py` / `position_store.py`：ArangoDB 集合 + append-only + 投影重建。
3. `routers/accounting.py`：帳戶 CRUD、手動分錄、持倉查詢。
4. `corporate_actions` 匯入 + 除權息自動分錄。
5. 前端帳務頁（帳戶 / 持倉 / 流水 / 損益）。
6. （後續）工作站2 讀 `positions`；接 `sdk/fubon` 作為 ledger 來源。

> 期間盤面紀錄：實作須遵守 AGENTS.md「文件同步規範」（程式碼變更須同步更新文件）。

---

## 13. 實作進度

| 步驟（見 §12） | 狀態 | 產出 |
|---|---|---|
| 1. `accounting/core.py`（費用規則 + 成本/損益，pure） | ✅ 完成（2026-10-27） | `backend/src/accounting/core.py`、`__init__.py`、`backend/tests/test_accounting_core.py`（19 測試） |
| 2a. `services/account_store.py` + `ledger_store.py`（帳戶 + append-only 流水） | ✅ 完成（2026-10-27） | `account_store.py`、`ledger_store.py`、`tests/test_accounting_stores.py`（6 測試） |
| 2b. `services/position_store.py`（由 ledger 投影持倉） | ⬜ 待做 | — |
| 3. `routers/accounting.py`（帳戶 CRUD／手動分錄／持倉查詢） | ⬜ 待做 | — |
| 4. `corporate_actions` 匯入 + 除權息自動分錄 | ⬜ 待做 | — |
| 5. 前端帳務頁（帳戶／持倉／流水／損益） | ⬜ 待做 | — |
| 6. 工作站2 讀 `positions`；接 `sdk/fubon` 作為 ledger 來源 | ⬜ 待做 | — |

---

*相關程式碼（既有）：`backend/src/simulation.py`、`backend/src/backtest.py`、`backend/src/routers/backtest.py`、
`backend/src/services/strategy_store.py`、`backend/src/services/hit_persistence.py`、`sdk/fubon/`。*
*相關文件：`.docs/simulation-replay.md`。*
