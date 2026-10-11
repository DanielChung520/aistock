# Sidebar-Right Drawers — 需求定位

> **v2.0 — Major Revision** (2026-08-10)
> v1.0 假設需要從頭建 rule engine + LLM prompt + collection。
> **codegraph 驗證後發現 `strategy-screener.tsx` 已經實作 80% 功能**，本版大幅精簡。
>
> Status: Draft v2.0 — 待 user review
> 對應 session: `wip-sidebar-right-drawers`

---

## 概述

在 aiStock **sidebar-right** 區域新增兩個右側抽屜：

1. **抽屜 1：策略選股（Screener Drawer）** — 包裝既有 `StrategyScreener`（546 行）為右側抽屜，新增 scope 過濾（全部 / 類股 / 關注股）並把命中結果寫入歷史
2. **抽屜 2：通知中心（Notifications Drawer）** — 全新功能，讀歷史命中記錄 + 已讀 / 未讀狀態

**關鍵認知**：抽屜 1 不是新功能，是 **既有 `StrategyScreener` 的容器改造 + scope 補強 + 歷史持久化**。

---

## 決策摘要

| 項目 | 決策 |
|---|---|
| 元件 | 複用既有 `<aside translate-x>` drawer pattern（`my-stocks-drawer.tsx`），**不**用 radix `Sheet` |
| 抽屜 1 內容 | 嵌入既有 `StrategyScreener` + scope filter + 寫入 strategy_hits |
| 抽屜 2 用途 | 通知中心（讀 strategy_hits 歷史 + 已讀未讀） |
| LLM | 沿用 `StrategyScreener` 既有兩階段（`/ai-screen/translate` → `/ai-screen`），**不重寫** |
| 資料儲存 | 只新增 collection `strategy_hits`（通知歷史），其餘 collection 不動 |
| 排程 | **不新增排程** — screener 是 on-demand，按按鈕就跑 + 寫入 strategy_hits |

---

## 圖譜影響範圍（v2.0 精簡版）

### 新增檔案

**Frontend**
- `frontend/src/lib/strategy-drawer-context.tsx` — 抽屜 1 context（mirror `my-stocks-drawer-context.tsx`）
- `frontend/src/lib/notifications-drawer-context.tsx` — 抽屜 2 context（同上 pattern）
- `frontend/src/components/strategy-drawer.tsx` — 抽屜 1 本體，包 `<StrategyScreener scope=... onHit=...>`
- `frontend/src/components/notifications-drawer.tsx` — 抽屜 2 本體，讀 `/api/strategy-hits`
- `frontend/src/components/strategy-icon-button.tsx` — RightSidebar icon（mirror `my-stocks-icon-button.tsx`）
- `frontend/src/hooks/use-unread-count.ts` — 輪詢 `/api/strategy-hits/unread-count`
- `frontend/src/app/api/strategy-hits/[...path]/route.ts` — Next.js proxy

**Backend**
- `backend/src/routers/strategy_hits.py` — `/api/strategy-hits` 查詢 + 已讀狀態
- `backend/src/services/hit_persistence.py` — `StrategyScreener` 跑完後寫入 strategy_hits（service layer）
- `backend/src/tasks/strategy_hit_cleanup.py`（可選）— 清理超過 N 天的命中記錄

### 修改檔案（**極小**）

- `frontend/src/components/app-shell.tsx` — 加兩個 context provider + 兩個 drawer 渲染
- `frontend/src/components/right-sidebar.tsx` — 加 `StrategyIconButton`（在 MyStocks 後、AI 前）
- `frontend/src/components/header.tsx` — `Bell` button 改為受控（移除 hardcoded badge "7"，接 notifications drawer + dynamic unread）
- `frontend/src/components/strategy-screener.tsx` — **小改**：
  - 新增 `scope` prop（`'all' | 'watchlist' | 'sector:<code>'`）
  - 新增 `onHit` callback（在掃描完成時把 `ScreenResult[]` 傳出，由 `strategy-drawer.tsx` 接到後端寫入）
  - 將現有 query 加上 `scope` 參數傳給後端
- `backend/src/routers/strategy.py` — `/api/strategy/screen` 與 `/api/strategy/ai-screen` 加 `scope` 參數支援
- `backend/src/main.py` — 註冊 `strategy_hits` router
- `.docs/cache-strategy.md` — TTL 表加 `strategy-hits` / `strategy-unread-count` 兩個 category

### 既有資源完整複用（**不重複實作**）

- `frontend/src/components/strategy-screener.tsx` — 7 條件 + AI 兩階段 + 表格結果
- `frontend/src/components/my-stocks-drawer.tsx` — `<aside translate-x>` drawer pattern 範本
- `frontend/src/components/my-stocks-icon-button.tsx` — icon button pattern
- `frontend/src/lib/my-stocks-drawer-context.tsx` — drawer context pattern（`isOpen/open/close/toggle`）
- `frontend/src/hooks/use-system-settings.ts` — `StrategyScreener` 已用，接 LLM 設定
- `backend/src/routers/strategy.py` — `/api/strategy/screen`, `/api/strategy/ai-screen/translate`, `/api/strategy/ai-screen` 已存在
- `backend/src/llm.py` — OpenAI-compatible LLM client
- `aistock` ArangoDB collections: `stock_codes`, `stock_daily`, `watchlist`, `system_settings`, `schedule_jobs`

### **重大簡化**（v1 → v2）

| v1 規劃 | v2 結論 | 原因 |
|---|---|---|
| 新增 rule engine | ❌ 不需要 | `backend/src/routers/strategy.py` 已有 screener 邏輯 |
| 新增 LLM 翻譯 prompt | ❌ 不需要 | `StrategyScreener` + `/ai-screen/translate` 已實作 |
| 新增 strategy_conditions collection | ❌ 不需要 | screener 用 query string 即時傳條件，不持久化 |
| 新增 strategy_scan 排程 job | ❌ 不需要 | screener 是 on-demand |
| 新增 strategy_hits collection | ✅ 仍需要 | 給通知中心查歷史（**唯一新增 collection**） |
| 新增 Celery task | ⚠️ 可選 | 只有 cleanup 任務可能需要 |
| 新增 rule engine 測試 | ❌ 不需要 | 既有 screener 已有覆蓋 |

---

## 抽屜 1：策略選股（Screener Drawer）

### 設計

**完全包裝既有 `StrategyScreener`**，加：

- `scope` prop（default = `'all'`）
- `onHit(results)` callback（掃描完成時把結果往外拋）

### UI 結構

```
┌─ RightSidebar (60px) ─┐
│ [MyStocks]            │  ← 既有 MyStocksIconButton
│ [Strategy]            │  ← 新增 StrategyIconButton（target / Sparkles icon）
│       ⇩ 空白彈性       │
│ [AI]                  │  ← 既有 AIIconButton
└───────────────────────┘
        ↓ click
┌─ Drawer (right, w-[450px]) ──────────────────┐
│ Header: 策略選股 [Scope: 全部 ▼]              │
│ ─────────────────────────────────────────────  │
│ ┌─────────────────────────────────────────┐   │
│ │ 篩選條件（複用 StrategyScreener UI）    │   │
│ │ ☑ MA 多頭排列    ☐ MA8 斜率            │   │
│ │ ☐ KDJ 金叉       ☐ RSI 中段            │   │
│ │ ...                                       │   │
│ └─────────────────────────────────────────┘   │
│ ┌─────────────────────────────────────────┐   │
│ │ ✨ AI 選股（兩階段）                    │   │
│ │ [自然語言輸入框]                         │   │
│ │ [AI 生成條件 → 確認並搜索]               │   │
│ └─────────────────────────────────────────┘   │
│ [執行掃描]                                     │
│ ─────────────────────────────────────────────  │
│ 結果表格（複用 StrategyScreener UI）         │
│ 2330 台積電  1,025  ↑5.2%  ✓✓✓             │
│ ...                                            │
└───────────────────────────────────────────────┘
```

### 互動

1. User 點 `StrategyIconButton` → `StrategyDrawer` 開啟
2. Drawer 內嵌 `<StrategyScreener scope="all" onHit={persistHits} />`
3. User 設條件 → 點「執行掃描」或「AI 生成條件 → 確認並搜索」
4. 後端跑 `/api/strategy/screen?scope=all&...` 或 `/api/strategy/ai-screen`
5. 回傳 `ScreenResponse` → `StrategyScreener` 渲染表格 + **觸發 onHit**
6. `strategy-drawer.tsx` 的 `persistHits()` 把 `ScreenResult[]` 寫入 `/api/strategy-hits`（POST 批次寫入）
7. 命中記錄變成通知中心可查的歷史

### API（既有，**只加 scope 參數**）

- `GET /api/strategy/screen?ma_bull=true&kdj_golden=true&...&scope=all&limit=50`
- `POST /api/strategy/ai-screen/translate` body `{ description, limit, llm }`（既有）
- `POST /api/strategy/ai-screen` body `{ description, conditions, limit, scope, llm }`（加 scope）

### 後端修改點（`backend/src/routers/strategy.py`）

1. `screen()` 與 `ai_screen()` 都加 `scope: str = "all"` 參數
2. scope 邏輯：
   - `"all"` → 不過濾（既有行為）
   - `"watchlist"` → 從 `watchlist` collection 取 stock_id 清單
   - `"sector:<code>"` → 從 `stock_codes` 篩 `industry == code`
3. 既有條件計算邏輯不動，只在「最後一步」加 scope filter

---

## 抽屜 2：通知中心（Notifications Drawer）

### 設計（**全新**，無既有對應）

讀 `strategy_hits` collection，依時間排序，顯示已讀 / 未讀。

### UI 結構

```
┌─ Header (右上) ────────────────────────────────┐
│ [Bell N] ← 既有 Bell button（line 138-144）   │
│           改為受控，badge 顯示動態 unread count│
└───────────────────────────────────────────────┘
        ↓ click
┌─ Drawer (right, w-[450px]) ──────────────────┐
│ Header: 通知中心              [全部標已讀]     │
│ ─────────────────────────────────────────────  │
│ 今天 2026-08-10                                │
│ ┌─────────────────────────────────────────┐   │
│ │ ● 2330 台積電  「MA 多頭 + KDJ 金叉」    │   │
│ │   收盤 1,025 ↑5.2%  14:35 掃描           │   │
│ └─────────────────────────────────────────┘   │
│ 昨天 2026-08-09                                │
│ ┌─────────────────────────────────────────┐   │
│ │ ○ 2317 鴻海    「RSI 中段」              │   │
│ │   收盤 215 ↑1.8%   14:32 掃描            │   │
│ └─────────────────────────────────────────┘   │
│ [載入更多]                                      │
└───────────────────────────────────────────────┘
```

### 互動

1. User 點 Bell → `NotificationsDrawer` 開啟
2. Drawer 開啟時 `GET /api/strategy-hits?limit=50&unread_first=true`
3. 點擊單筆 → 跳轉 `/stock/[symbol]` + `PUT /api/strategy-hits/{key}/read`
4. 「全部標已讀」 → `PUT /api/strategy-hits/read-all`
5. 未讀數 badge → `useUnreadCount()` hook，每 30 秒輪詢 `GET /api/strategy-hits/unread-count`

### API（**全部新增**）

- `GET /api/strategy-hits?limit=50&unread_first=true&before=<created_at>` — 分頁查詢
- `GET /api/strategy-hits/unread-count` — 回 `{ unread: number }`
- `PUT /api/strategy-hits/{key}/read` — 標記單筆已讀
- `PUT /api/strategy-hits/read-all` — 全部已讀
- `POST /api/strategy-hits` — 批次寫入（由 `strategy-drawer.tsx` 的 `persistHits` 呼叫，**內部 API**）

---

## Collection Schema（**只新增一個**）

### `strategy_hits`

```json
{
  "_key": "<scan_id>_<stock_id>",
  "scan_id": "scan_<timestamp>_<uuid>",
  "stock_id": "2330",
  "name": "台積電",
  "scope": "all",
  "conditions": [
    { "metric": "ma_bull", "op": "==", "value": true, "note": "MA 多頭排列" },
    { "metric": "kdj_golden", "op": "==", "value": true, "note": "KDJ 金叉且未超買" }
  ],
  "passed_count": 3,
  "total_conditions": 3,
  "score": 100,
  "price": 1025,
  "source": "manual" | "ai",
  "scan_at": 1723293000,
  "read": false,
  "created_at": 1723293000
}
```

`_key` 設計：`<scan_id>_<stock_id>` — 同一 scan 不會重複寫入同一股；不同 scan 各寫各的。

---

## 排程整合（**v2 不新增**）

v1 規劃的 `strategy_scan` job **不需要**：
- screener 是 on-demand，使用者按按鈕才跑
- 每次跑完 `StrategyScreener` 自動 `onHit` → 寫入 strategy_hits
- 通知中心直接讀 strategy_hits

（可選）未來可加 `strategy_hit_cleanup` 清理 N 天前的命中，本版不做。

---

## LLM 規則翻譯（**v2 不重寫**）

完全沿用 `StrategyScreener` + `backend/src/routers/strategy.py` 的兩階段流程：

1. `POST /api/strategy/ai-screen/translate` → LLM 把自然語言翻成 `conditions[]`
2. User 確認 → `POST /api/strategy/ai-screen` → 用確認後的 conditions 掃描

不另寫 prompt、不另建 service。

---

## 假設清單（待 review，**v2 精簡**）

- [ ] **A1**（修訂）：Bell button（header.tsx:138-144）改為受控；RightSidebar 加 `StrategyIconButton`
- [ ] **A2**：Drawer 預設寬度 `w-[450px]`（mirror `my-stocks-drawer.tsx:38`）
- [ ] **A3**：單 user（`user_id = "default"`），多 user 後續再做
- [ ] **A4**（**移除**）：條件編輯走 `StrategyScreener` 既有 7 條件 + AI 自然語言，**不另建 ConditionEditor**
- [ ] **A5**：未讀數 badge 採輪詢 30 秒一次，不用 SSE/WS
- [ ] **A6**：通知中心預設顯示最近 50 筆，分頁用 cursor（before created_at）
- [ ] **A7**（**移除**）：LLM 翻譯失敗處理沿用 `StrategyScreener` 既有 error UI（line 447-449）

---

## 已解決問題

- ✅ **Q1 Header trigger button 位置**：Strategy 用 RightSidebar icon，Notifications 沿用 Bell
- ✅ **Q4 LLM 怎麼接**：沿用 `StrategyScreener` 兩階段，**不重寫**
- ✅ **Q5 資料儲存方式**：只新增 `strategy_hits` 一個 collection

---

## 未決問題

1. ~~**`scope` 參數支援到哪**：screener 預設 scope = `all` 掃全部；用 watchlist 限制 50 檔；sector 需要 stock_codes 是否有 `industry` 欄位（**待確認**）~~ → ✅ **已驗證**：`stock_codes.industry` 存在；`sector:<code>` 範圍可行
2. **strategy_hits 保留天數**：預設永久還是 30 天 / 90 天輪動？影響儲存成本
3. **screener 失敗是否寫 hit**：目前規劃「跑完就寫」，失敗不寫。要不要區分？
4. **AI 生成的 condition 是否要存**：目前每次都重新翻譯；是否要持久化常用 condition？
5. **手動觸發掃描按鈕**：screener 內已有「執行掃描」按鈕，夠用嗎？還是要在通知中心加？

### 已驗證項目

- ✅ `stock_codes.industry` 欄位存在（`backend/src/models.py:9`、`routers/basics.py:33` 定義與爬蟲寫入、`routers/stocks.py:54` 對外、`main.py:61` 提供、`frontend/src/types/stock.ts:43` 型別）
- ✅ 既有 `/strategy` 頁面（`frontend/src/app/strategy/page.tsx`，12 行）只調用 `<StrategyScreener />` 不帶 props — 加 optional `scope` / `onHit` 不會破壞既有頁面

---

## 風險與開放議題

| 風險 | 影響 | 緩解 |
|---|---|---|
| `StrategyScreener` 改 scope prop 可能破壞既有頁面 | 既有 `/strategy-screener` 路由（如果存在）失效 | 改 prop 為 optional，預設 `all` 維持既有行為 |
| 每次掃描都寫 hit，volume 暴增 | strategy_hits collection 膨脹 | 加 TTL 欄位 + 排程清理（可選） |
| Bell button 改為受控，其他 header 元件干擾 | Theme、Settings、Mail 等 button 受影響 | 只動 Bell button 段落，其他不碰 |
| Drawer 一次開兩個 | UI 衝突 | 沿用現有 pattern：drawer 自己管 state，AppShellInner 順序渲染 |

---

## Concrete Pattern References（v2 精簡）

### F1: Drawer Context pattern（**不是 modal-context**）

**範本**：`frontend/src/lib/my-stocks-drawer-context.tsx`（26 行）

```tsx
'use client'
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface XxxDrawerContextType {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const XxxDrawerContext = createContext<XxxDrawerContextType | null>(null)

export function XxxDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsClose(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return <XxxDrawerContext.Provider value={{ isOpen, open, close, toggle }}>{children}</XxxDrawerContext.Provider>
}

export function useXxxDrawer(): XxxDrawerContextType {
  const ctx = useContext(XxxDrawerContext)
  if (!ctx) throw new Error('useXxxDrawer must be used within XxxDrawerProvider')
  return ctx
}
```

**套用**：建立 `strategy-drawer-context.tsx` 與 `notifications-drawer-context.tsx`，結構完全相同。

### F2: Drawer 本體 pattern（`<aside translate-x>`，**不是 Sheet**）

**範本**：`frontend/src/components/my-stocks-drawer.tsx`（62 行整檔）

```tsx
'use client'
import { useEffect } from 'react'
import { X, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMyStocksDrawer } from '@/lib/my-stocks-drawer-context'
import { cn } from '@/lib/utils'

export function MyStocksDrawer() {
  const { isOpen, close } = useMyStocksDrawer()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-[99] bg-black/30 animate-in fade-in-0" onClick={close} />
      )}
      <aside
        className={cn(
          'fixed top-10 right-0 bottom-0 z-[100] w-[450px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="h-[60px] shrink-0 border-b border-border flex items-center justify-between px-4">
          <div className="text-sm font-semibold">標題</div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={close} title="關閉 (ESC)">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* 內容 */}
        </div>
      </aside>
    </>
  )
}
```

**套用**：`strategy-drawer.tsx` 與 `notifications-drawer.tsx` 用同樣 pattern，內容換成 `StrategyScreener` 與 hit list。

### F3: IconButton pattern

**範本**：`frontend/src/components/my-stocks-icon-button.tsx`（31 行整檔）

```tsx
'use client'
import { Star } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useMyStocksDrawer } from '@/lib/my-stocks-drawer-context'
import { cn } from '@/lib/utils'

export function MyStocksIconButton({ className }: { className?: string }) {
  const { open } = useMyStocksDrawer()
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={open}
            className={cn(
              'h-[45px] w-[45px] rounded-lg flex items-center justify-center transition-all',
              'bg-amber-500/90 text-white shadow-sm',
              'hover:bg-amber-500 hover:shadow-md hover:scale-105 active:scale-95',
              className,
            )}
            title="我的股票"
          >
            <Star className="h-[25px] w-[25px]" fill="white" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">我的股票</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
```

**套用**：`strategy-icon-button.tsx` 用 `Sparkles` 或 `TrendingUp` icon、藍色系配色。

### F4: Provider 嵌套 + Drawer 渲染

**範本**：`frontend/src/components/app-shell.tsx:73-83`（provider 嵌套）

```tsx
export function AppShell({ children, title }) {
  return (
    <WatchlistModalProvider>
      <SystemSettingsModalProvider>
        <ScheduleSettingsModalProvider>
          <FeatureSettingsModalProvider>
            <AppShellInner title={title}>{children}</AppShellInner>
          </FeatureSettingsModalProvider>
        </ScheduleSettingsModalProvider>
      </SystemSettingsModalProvider>
    </WatchlistModalProvider>
  )
}
```

**套用**：在最外層加 `StrategyDrawerProvider` + `NotificationsDrawerProvider`。

**範本**：`frontend/src/components/app-shell.tsx:63-68`（drawer 渲染）

```tsx
<MyStocksDrawer />
<AIChatModal />
<WatchlistModal />
<SystemSettingsModal isOpen={settingsOpen} onClose={closeSettings} />
```

**套用**：在同一處加
```tsx
<StrategyDrawer />
<NotificationsDrawer />
```

### F5: Header Bell button 改為受控

**現狀**：`frontend/src/components/header.tsx:138-144`

```tsx
{/* Notifications */}
<Button variant="ghost" size="icon" className="relative h-9 w-9">
  <Bell className="h-4 w-4" />
  <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center bg-blue-500 text-white">
    7
  </Badge>
</Button>
```

**改為**：

```tsx
const { open: openNotifications } = useNotificationsDrawer()
const unread = useUnreadCount()  // 新 hook，輪詢 /api/strategy-hits/unread-count

<Button variant="ghost" size="icon" className="relative h-9 w-9" onClick={openNotifications}>
  <Bell className="h-4 w-4" />
  {unread > 0 && (
    <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center bg-blue-500 text-white">
      {unread}
    </Badge>
  )}
</Button>
```

**注意**：保留 `Bell` icon 與相對位置樣式，**只改 onClick 與 badge 內容**。

### F6: RightSidebar 加 icon button

**現狀**：`frontend/src/components/right-sidebar.tsx`（15 行整檔）

```tsx
'use client'
import { cn } from '@/lib/utils'
import { AIIconButton } from '@/components/ai-icon-button'
import { MyStocksIconButton } from '@/components/my-stocks-icon-button'

export function RightSidebar({ className }: { className?: string }) {
  return (
    <aside className={cn(/* 同上 */)}>
      <MyStocksIconButton />
      <div className="flex-1" />
      <AIIconButton />
    </aside>
  )
}
```

**改為**：

```tsx
import { StrategyIconButton } from '@/components/strategy-icon-button'
// ...
<MyStocksIconButton />
<StrategyIconButton />   {/* ← 新增 */}
<div className="flex-1" />
<AIIconButton />
```

### F7: StrategyScreener 包進 Drawer（**新核心**）

**既有**：`frontend/src/components/strategy-screener.tsx`（546 行，無 scope prop）

**改動**（小）：

```tsx
export function StrategyScreener({ scope = 'all', onHit }: { scope?: string; onHit?: (results: ScreenResult[]) => void }) {
  // ... 既有 state ...

  // 既有 useEffect 改成：
  useEffect(() => {
    if (trigger === 0) return
    let cancelled = false
    const params: Record<string, ...> = { ma_bull, ..., scope, limit }  // ← 加 scope
    // ...
    if (!cancelled) {
      setData(json)
      onHit?.(json.results)  // ← 新增
    }
  }, [trigger, /* ... */])

  // runAiScan 同樣加 scope 到 body、callback onHit
}
```

**Drawer 包法**：

```tsx
// strategy-drawer.tsx
import { StrategyScreener } from '@/components/strategy-screener'
import { useStrategyDrawer } from '@/lib/strategy-drawer-context'

export function StrategyDrawer() {
  const { isOpen, close } = useStrategyDrawer()
  const [scope, setScope] = useState<string>('all')

  const persistHits = async (results: ScreenResult[]) => {
    await fetch('/api/strategy-hits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scan_id: `scan_${Date.now()}_${crypto.randomUUID()}`,
        scope,
        hits: results,
        source: 'manual',  // 或 'ai'
      }),
    })
  }

  return (
    <MyDrawerLayout isOpen={isOpen} close={close} title="策略選股">
      <StrategyScreener scope={scope} onHit={persistHits} />
      {/* scope 切換器 UI 放在 drawer header 內 */}
    </MyDrawerLayout>
  )
}
```

### F8: 快取策略整合

**範本**：`.docs/cache-strategy.md` TTL 表

加入兩個新 category：

| Category | TTL | 典型資料 |
|---|---|---|
| `strategy-hits` | 5 分鐘 | 通知歷史清單 |
| `strategy-unread-count` | 30 秒 | 未讀數 |

### F9: Next.js proxy route 結構

**範本**：`frontend/src/app/api/stocks/[...path]/route.ts`（既有）

**套用**：建 `frontend/src/app/api/strategy-hits/[...path]/route.ts`，把 `/api/strategy-hits/*` proxy 到 FastAPI。

---

## 快速驗證清單（review 時勾選）

- [ ] F1-F2 都有完整對應檔案（`my-stocks-drawer-context.tsx` + `my-stocks-drawer.tsx`）
- [ ] F3 `strategy-icon-button.tsx` 用 `Sparkles` icon、藍色配色（與 MyStocks 琥珀色、淺藍 AI 區隔）
- [ ] F4 兩個 provider 加在 `AppShell` 最外層
- [ ] F5 Bell button 改為受控後，其他 header button（Theme、Settings、Mail、Language、User）不變
- [ ] F6 RightSidebar 新增 `StrategyIconButton` 後，60px 寬度不變、不擠壓現有按鈕
- [ ] F7 `StrategyScreener` 加 `scope` / `onHit` prop 後，既有頁面（如果存在）行為不變（預設 `scope='all'`）
- [ ] F8 TTL 表更新 `cache-strategy.md`
- [ ] F9 Next.js proxy 完整

---

## 參考檔案

- `AGENTS.md` — 專案規範、G1-G14 guardrails
- `.docs/LAYOUT_GUIDE.md` — UI 規範
- `.docs/cache-strategy.md` — 既有快取策略
- `.docs/simulation-replay.md` — 既有回測相關（避免混淆）
- `frontend/src/components/strategy-screener.tsx` — **v2 核心參考**，既有 546 行實作
- `frontend/src/components/my-stocks-drawer.tsx` — **v2 drawer pattern 範本**
- `frontend/src/lib/my-stocks-drawer-context.tsx` — **v2 context pattern 範本**
- `frontend/src/components/my-stocks-icon-button.tsx` — **v2 icon button pattern**
- `backend/src/routers/strategy.py` — 既有 `/api/strategy/screen`、`/ai-screen/translate`、`/ai-screen`（**加 scope 參數**）

---

## v1 → v2 變更摘要

| 項目 | v1 | v2 |
|---|---|---|
| 抽屜 1 內容 | 全新條件命中清單 + LLM 翻譯 | **包裝既有 `StrategyScreener`**，加 scope + onHit |
| 抽屜 2 內容 | 通知中心 | 同 v1 |
| rule engine | 新建 | **不需要**（既有） |
| LLM 翻譯 prompt | 新建 | **不需要**（既有 `StrategyScreener`） |
| strategy_conditions collection | 新建 | **不需要** |
| strategy_scan 排程 job | 新建 | **不需要**（on-demand） |
| strategy_hits collection | 新建 | **仍新建**（唯一新增 collection） |
| strategy-hits router | 新建 | **仍新建**（API endpoints） |
| `StrategyScreener` 改動 | 無 | 加 `scope` / `onHit` props |
| 既有 screener 影響 | 無 | 既有頁面行為不變（prop optional + 預設 `all`） |
| 實作總工時估算 | 大（建後端 80%） | **小**（包前端 + 加 1 個 collection + 1 個 router） |