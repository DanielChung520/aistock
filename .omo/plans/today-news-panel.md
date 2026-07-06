# 台股儀表板「今日消息」區塊實作計畫

## TL;DR
> 將 dashboard 的 `<MyStocksList />` 換成 `<TodayNewsPanel />`，4:6 分割（上：AI 摘要 mock / 下：新聞列表），底部顯示設定狀態。

---

## Context

使用者要求：
- 「現在台股儀表板的我的股票區域顯示今日消息」
- 上半部：AI 解析摘要（mock placeholder）
- 下半部：依 watchlist 股票代號查詢的新聞列
- 管理區：顯示更新時間、關鍵字、提示、關注網站

---

## Files

### 新增
1. `backend/src/routers/news.py` — `/api/news/today` endpoint
2. `frontend/src/app/api/news/today/route.ts` — Next.js API proxy
3. `frontend/src/components/stocks/TodayNewsPanel.tsx` — 主要 UI 元件

### 修改
4. `frontend/src/app/page.tsx` — 將 `<MyStocksList />` 換成 `<TodayNewsPanel />`
5. `backend/src/main.py` — register news router

---

## Component Specs

```
+--------------------------------+
| 今日消息                  ⚙️   |  ← Header (32px)
+----------------+---------------+
|                | 新聞 1 (時間)  |
|   AI 摘要      |   標題        |
|  (40%)         |   摘要        |
|  mock          +---------------+
|                | 新聞 2 ...    |
+----------------+---------------+
| 更新時間 / 關鍵字 / 提示  (設定) |  ← Footer (32px)
+--------------------------------+
```

---

## Backend News API

### Route: `GET /api/news/today?symbols=2330,2454`
呼叫 FinMind `TaiwanStockNews` dataset：
- stock_id: symbols
- start_date: today
- end_date: today
- token: from env (already exists)

Fallback: 若 API 失敗或無資料，回傳 mock 新聞。

### Response Schema
```json
{
  "updated_at": "2026-07-06T08:30:00Z",
  "news": [
    {
      "symbol": "2330",
      "stock_name": "台積電",
      "title": "台積電 Q2 法說會重點...",
      "summary": "...",
      "source": "工商時報",
      "url": "https://...",
      "published_at": "2026-07-06T08:00:00Z"
    }
  ]
}
```

---

## TodayNewsPanel Props
```ts
interface TodayNewsPanelProps {
  watchlistSymbols: string[]  // 從 /api/watchlist 拿
  onSelectStock?: (symbol: string, name: string) => void
}
```

## Verification
- [ ] ts-check 通過
- [ ] dashboard 顯示 TodayNewsPanel
- [ ] 新聞資料可載入（mock 或 FinMind）
- [ ] 4:6 比例正確
- [ ] 設定 footer 顯示更新時間 / 關鍵字數量
- [ ] 截圖驗證