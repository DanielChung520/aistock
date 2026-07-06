# 右側 Sidebar 新增「我的股票」抽屜計畫

## TL;DR
> 在 Right Sidebar 最上方新增「我的股票」icon 按鈕，點擊後從右側滑出抽屜（與 AI 抽屜同樣的 slide pattern），內容顯示現有 `MyStocksList` 元件。

---

## Context

### 使用者請求
「RL 最上方做一個我的股票，點擊後出現我的股票的抽屜，顯示現在我的股票的頁面」

### 現狀
- Right Sidebar 目前只有底部一個 AI 按鈕（45x45 Sparkles icon）
- MyStocksList 元件已存在於 dashboard 中（抓 `/api/watchlist` + 各 stock history）
- AI Drawer 已建立（z-[100] / 420px / slide from right）

### 設計決定（待使用者確認）
- Icon: `Star`（與現有 menu「自選股」一致）
- 按鈕尺寸: 45x45（與 AI 按鈕一致）
- Drawer 寬度: 380px（比 AI 略窄）
- z-index: 100（同 AI；互斥開啟，一次只開一個）

---

## Files

### 新增
1. `frontend/src/lib/my-stocks-drawer-context.tsx` — Context: `{ isOpen, open, close, toggle }`
2. `frontend/src/components/my-stocks-icon-button.tsx` — 45x45 Star 按鈕，呼叫 `useMyStocksDrawer().open()`
3. `frontend/src/components/my-stocks-drawer.tsx` — 380px 抽屜，內容嵌入 `<MyStocksList />`

### 修改
4. `frontend/src/components/right-sidebar.tsx` — 最上方加 `<MyStocksIconButton />`，底部保留 `<AIIconButton />`
5. `frontend/src/components/app-shell.tsx` — 在 `<AIDrawer />` 旁加 `<MyStocksDrawer />`
6. `frontend/src/app/layout.tsx` — 在 `<AIDrawerProvider>` 旁加 `<MyStocksDrawerProvider>`

---

## 結構

```
Right Sidebar (60px)
  ┌─────────┐
  │  ⭐ My  │  ← 新增 MyStocksIconButton (頂)
  │         │
  │  (空)   │
  │         │
  │         │
  │         │
  │         │
  │  [AI]   │  ← AIIconButton (底)
  └─────────┘
```

點 MyStocksIconButton：
```
                                    ┌───────────────┐
                                    │ 我的股票   [X] │  ← 380px drawer
                                    ├───────────────┤
                                    │ 台積電 2330   │
                                    │ +2.5%  +50   │
                                    │ ──────────── │
                                    │ 聯發科 2454   │
                                    │ ...           │
                                    └───────────────┘
                                    ▲ overlay z-[99]
```

---

## 互斥邏輯（drawer 之間）

簡單做法：兩個 drawer 共用同一個「current drawer」狀態由父層管理，或各自獨立但加：
- 開 MyStocks → 若 AI 開著則關閉 AI
- 開 AI → 若 MyStocks 開著則關閉 MyStocks

實作：在每個 Context 的 `open()` 內呼叫另一個的 `close()`。

---

## Verification

- [ ] `pnpm run ts-check` 通過
- [ ] 點 MyStocks icon → 抽屜滑入，內容顯示 watchlist
- [ ] ESC 關閉
- [ ] 點 AI 時 MyStocks 自動關閉
- [ ] 截圖存到 `/tmp/aistock-screenshots/`