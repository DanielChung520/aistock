# 模擬交易與重播（Replay & Paper Trading）操作說明

> 台股 K 線重播 + 紙上模擬交易系統。使用者可回到歷史任一交易日，逐步推進，
> 依 Daniel MA 指標與 AI 建議自行決定買賣，體驗「T 收盤確認訊號、T+1 開盤成交」
> 的真實交易節奏，且圖表同步隱藏未來資料（無偷看未來）。

---

## 一、整體流程

```mermaid
flowchart TD
    A[進入個股頁面] --> B[底部「模擬交易」欄]
    B --> C{選擇區間與資金}
    C --> D[3月/6月/9月/1年/18月/2年/3年/4年/5年]
    C --> E[初始資金 預設 1,000,000]
    D --> F[按「開始模擬」]
    E --> F

    F --> G[後端載入資料]
    G --> H[往前多抓 5 個月暖機<br/>MA89 需 ~89 根]
    H --> I[圖表回到區間起點<br/>未來資料隱藏]

    I --> J{推進方式}
    J --> K[下一步 1日]
    J --> L[快進 5日]
    J --> M[自動下一步<br/>跳到下一個買/賣訊號日]
    J --> N[上一步<br/>回溯還原]

    K --> O[看到 T 日收盤<br/>+ Daniel MA + AI 建議]
    L --> O
    M --> O
    N --> O

    O --> P{手動操作}
    P --> Q[買入/加倉 掛單]
    P --> R[賣出/減倉/平倉 掛單]
    P --> S[不理會，讓自動訊號跟單]
    Q --> T[按「下一步」推進至 T+1]
    R --> T
    S --> T

    T --> U{T+1 開盤成交判定}
    U --> V[買單: 當日最低 ≤ 掛單價]
    U --> W[賣單: 當日最高 ≥ 掛單價]
    V --> X[成交 以掛單價]
    W --> X
    V --> Y[未到價 拒絕]
    W --> Y
    X --> Z[更新持倉/現金/權益/交易明細]
    Y --> Z
    Z --> J
```

---

## 二、啟動流程

```mermaid
sequenceDiagram
    participant U as 使用者
    participant FE as 前端 Footer
    participant BE as FastAPI
    participant DB as ArangoDB

    U->>FE: 選擇區間(如 1年) + 資金
    U->>FE: 點「開始模擬」
    FE->>BE: POST /api/backtest/simulate/init
    BE->>DB: 讀 stock_daily (months + 5 暖機)
    DB-->>BE: K線 + Daniel MA 訊號
    BE-->>FE: 全歷史 days + 起始 state
    FE->>FE: 圖表資料對齊 (months+5)
    FE->>FE: 圖表回到區間起點 (未來隱藏)
```

**要點**
- 暖機：`WARMUP_MONTHS = 5`（約 110 交易日），確保模擬起點時 MA89 已完整。
- 圖表：`onMonthsChange(months+5)` 讓圖表資料涵蓋暖機期；`replayData` 截斷到當前模擬日，未來 K 線隱藏。

---

## 三、推進與回溯

```mermaid
stateDiagram-v2
    [*] --> Ready: 開始模擬
    Ready --> Active: 下一步 / 快進 / 自動
    Active --> Active: 掛單 / 取消 / 加倉 / 平倉
    Active --> Back: 上一步
    Back --> Active: 下一步（重新決策）
    Active --> Done: 已推進至最新交易日
    Done --> Ready: 重新開始
    Active --> Ready: 重新開始
```

| 按鈕 | 行為 | 備註 |
|---|---|---|
| **下一步 (1日)** | 推進一個交易日，T 收盤 → T+1 開盤成交 | 核心節奏 |
| **快進 5日** | 一次推進 5 天 | |
| **自動下一步** | 跳到下一個出現 **買/賣訊號** 的交易日 | `stop_on_signal` |
| **上一步** | 退回上一個交易日，還原當時持倉/現金/掛單 | 歷史快照 |
| **重新開始** | 回到起點，清空所有狀態 | |

**上一步的歷史快照**
- 每次成功推進後，前端保存「推進前的 state + 當日」至記憶體陣列。
- 上一步 = pop 最後一個快照並還原，可連續回退。
- 回退後可重新決策（產生分支模擬）。

---

## 四、下單與成交判定

### 4.1 掛單流程

```mermaid
flowchart TD
    A[T 日收盤] --> B{持倉?}
    B -- 無持倉 --> C[買入 N張 + 報價]
    B -- 有持倉 --> D[加倉 N張 + 報價]
    A --> E[賣出 N張 + 報價]
    A --> F[平倉 全部持股]

    C --> G[按「掛單」]
    D --> G
    E --> G
    F --> G

    G --> H{同側已有掛單?}
    H -- 無 --> I[掛單成功<br/>按鈕變 預加倉或預平倉]
    H -- 有 --> J[取消掛單<br/>狀態恢復]

    I --> K[按「下一步」推進至 T+1]
    K --> L{成交判定}
```

### 4.2 成交判定（T+1 開盤比對）

```mermaid
flowchart LR
    subgraph Buy[買入/加倉]
        B1[掛單價 P] --> B2{T+1 最低價 ≤ P?}
        B2 -- 是 --> B3[成交 @ P]
        B2 -- 否 --> B4[未成交 拒絕]
    end
    subgraph Sell[賣出/平倉]
        S1[掛單價 P] --> S2{T+1 最高價 ≥ P?}
        S2 -- 是 --> S3[成交 @ P]
        S2 -- 否 --> S4[未成交 拒絕]
    end
```

**費用計算**
| 項目 | 費率 |
|---|---|
| 買進手續費 | 0.1425% |
| 賣出手續費 | 0.1425% |
| 賣出證交稅 | 0.3% |

**平均成本**
- 首次買入：`(成交價 × 股數 + 手續費) ÷ 股數`
- 加倉：加權平均 = `(舊股數×舊均價 + 新股成本 + 手續費) ÷ 總股數`
- 損益% = `(賣出每股淨額 ÷ 持倉均價 − 1) × 100`（含全部費用）

**資金不足**：掛單張數超過現金時，自動降為最大可負擔股數（避免負現金）。

---

## 五、UI 佈局

```mermaid
flowchart TD
    subgraph Collapsed[折疊列]
        C1[模擬交易 — 股票 · 日期]
        C2[權益 %]
    end

    subgraph Expanded[展開面板]
        E1[控制列]
        E2[持倉單行]
        E3[下單區]
    end

    E1 --> E1a[上一步 下一步 快進5日 自動下一步 重設]
    E1 --> E1b[AI 建議標籤<br/>買入/賣出/續抱/觀望 顏色區分]
    E1 --> E1c[交易明細按鈕]

    E2 --> E2a[現金 / 持股+均價 / 權益 / MA8 / MA21 / 強度 / 成本]

    E3 --> E3a[加倉(或買入) 張數 報價 掛單 = 金額]
    E3 --> E3b[賣出 張數 報價 掛單 = 金額 平倉]
```

### AI 建議
- 每個交易日收盤後顯示操作建議：**買入 / 賣出 / 續抱 / 觀望**（顏色區分）。
- 點擊標籤 → Modal 顯示詳細理由（均線排列、斜率、扣抵、大量區距離、參考價位）。
- AI 僅供參考，操作權在使用者。

### 交易明細
- 點「交易明細」→ 無遮罩浮動視窗（DOM 外部點擊關閉）。
- 顯示：日期 / 操作 / 張數 / 成交價 / 均價 / 累計交易成本。

---

## 六、後端 API

| 端點 | 方法 | 說明 |
|---|---|---|
| `/api/backtest/simulate/init` | POST | 初始化模擬，回傳全歷史 days + 起始 state |
| `/api/backtest/simulate/advance` | POST | 推進 N 天；`stop_on_signal=true` 停在訊號日 |
| `/api/backtest/simulate/order` | POST | 掛單（買/賣 + 報價 + 張數），**不推進** |
| `/api/backtest/simulate/cancel-order` | POST | 取消已掛單 |
| `/api/backtest/run` | POST | 回測（批次驗證策略） |
| `/api/backtest/suggest` | GET | AI 建議策略參數 |

**advance 關鍵參數**
```
manual_order: { action, limit_price?, lots? }   # 手動單優先於自動訊號
stop_on_signal: boolean                          # 停在買/賣訊號日
```

---

## 七、資料與指標

```mermaid
flowchart LR
    A[yfinance] --> B[backfill_daily_arango.py]
    B --> C[(ArangoDB stock_daily<br/>2010 年起)]
    C --> D[fetch_daily_history]
    D --> E[calculate_ma_daniel<br/>MA8/21/55/89 + 斜率 + 訊號]
    E --> F[模擬交易引擎]
    F --> G[圖表 + 交易]
```

- 日K 自 **2010-01** 起（watchlist 新增股票時異步補齊，`backfill_daily_history` Celery 任務）。
- Daniel MA 計算自 2010 起，暖機期 MA 為 None，之後完整有效。
- 模擬載入資料往前多加 **5 個月**暖機，確保起點指標完整。

---

*相關程式碼：`backend/src/simulation.py`、`backend/src/routers/backtest.py`、
`backend/src/ai_advice.py`、`backend/src/tasks/backfill_daily.py`、
`frontend/src/components/stocks/SimulationFooter.tsx`。*
