# aiStock 框架重整計畫（TradingView 風格）

## TL;DR
> **目標**：把現有框架重構為 TradingView 風格的極簡 icon rail 配置，所有 chrome（Sidebar/Header/Footer/Tabs）固定尺寸，內容區純 React TS，AI 對話視窗從右側以抽屜滑入。
>
> **預估工作量**：Medium（11 個檔案變更）
> **平行執行**：部分可平行
> **關鍵路徑**：AppShell 重構 → Sidebar 改 rail → 新增 5 個元件 → 移除 page.tsx 的 footer

---

## Context

### 原始請求
「整個框架重整，sidebar-l / sidebar-r / header 寬度固定 60px，footer 50px，header 之上為頁簽，sidebar 最下方為 Ai icon (容器 45x45，icon 25x25)，AI 對話視窗從右側伸出抽屜、z-index 最高。整體可參考 TradingView。」

### 目前狀態（問題點）
- Left sidebar 寬度切換 (`w-16` ↔ `w-64`)，無右側 sidebar
- Header `h-16` (64px)，無頁簽列
- Footer 嵌在 dashboard page 內，無統一框架 footer
- 無 AI drawer
- 既有 `StockTabs.tsx` 是「股票分頁內嵌面板」，不是頂部頁簽列

---

## 目標佈局（ASCII Mockup）

```
+------------------------------------------------------------------+
| [Tab1] [Tab2] [Tab3] +                                  [Settings] |  ← PageTabsBar 40px
+--+--------------------------------------------------+----+----+
|  |                                                  |    |    |
|  |                                                  |    |    |
|  |                                                  |    |  R |
|  |                                                  |    |  i |
| L|                                                  |  R |  g |
| e|                                                  |  i |  h |
| f|                Content (Page)                    |  g |  t |
| t|                                                  |  h |    |
|  |                                                  |  t |  S |
| S|                                                  |    |  i |
| B|                                                  |  S |  d |
|  |                                                  |  B |  e |
|  |                                                  |    |    |
|  +--------------------------------------------------+    |    |
|  |  Footer 50px (status bar)                         |    |    |
+--+--------------------------------------------------+----+----+
| [AI]                                                               |  ← AI button 45x45 at sidebar bottom
+--+--------------------------------------------------+----+----+
```

### 尺寸規範

| 元件 | 寬度 | 高度 | z-index |
|---|---|---|---|
| PageTabsBar | 100% | 40px (h-10) | z-30 |
| Header | 100% | 60px (h-[60px]) | z-20 |
| Left Sidebar | 60px (w-[60px]) | 100% - PageTabsBar | z-10 |
| Right Sidebar | 60px (w-[60px]) | 100% - PageTabsBar | z-10 |
| Footer | 100% | 50px (h-[50px]) | z-10 |
| AI Drawer | 420px (w-[420px]) | 100% - PageTabsBar | z-[100] (最高) |
| AI Icon Button | 45x45 | 在左 sidebar 最底 (mt-auto) | n/a |

### 使用者確認的設計細節（user clarifications）
- **AI icon**: `Sparkles`（lucide）
- **頁簽資料**: 重用 `useStockTabs` (existing `stock-tab-context.tsx`)
- **Right Sidebar**:
  - 頂部：Home icon → 儀表板
  - 中間：留空（之後會規劃更多）
  - 底部：Grid3x3 (LayoutGrid) icon → 點擊開啟 Popover 顯示現有 menu 群組（首頁、自選股、證券代號、券商資訊、競拍公告、我的競拍、選單管理）
- **Footer**:
  - 右側：連線狀態 status bar（API 狀態點、WebSocket 圖示、最後更新時間、版本 v2.0）
  - 左側：context slot（`left` prop）— dashboard 頁面傳入時間區間按鈕（1月/3月/6月/1年/5年）
- **整體參考**：TradingView 風格

---

## Work Objectives

### Core Objective
重構 `app-shell.tsx` 為 TradingView 風格框架，左/右側 60px icon rail，頂部 40px tabs 列 + 60px toolbar，底部 50px footer，右側滑出式 AI drawer。

### Concrete Deliverables
1. 重構後的 `AppShell` 支援四象限 + tabs + AI drawer overlay
2. 60px icon-only LeftSidebar，底部含 45x45 AI 按鈕（25x25 icon）
3. 60px icon-only RightSidebar
4. 40px PageTabsBar 在 Header 之上
5. 50px Footer 統一在內容區底部（移出 page.tsx）
6. AI Drawer 元件，從右側滑入，最高 z-index
7. AI Drawer Context 管理 open/close 狀態

### Must Have
- 所有 chrome 尺寸嚴格符合規範（60px / 50px / 40px）
- AI Drawer 用 Radix Dialog + slide-from-right 動畫
- AI Icon 容器 45x45、lucide icon 25x25（用 `Sparkles` 或 `Bot`）
- z-index 規範統一：tabs(30) > header(20) > sidebar/footer(10) > drawer(100)

### Must NOT Have (Guardrails)
- ❌ 不變動 dashboard 內容（chart 邏輯、TAIEX 卡片等）
- ❌ 不改 API routes（`/api/menu`, `/api/market/*` 等）
- ❌ 不移除既有 `StockTabs.tsx`（保留為 stock detail tabs，但從 sidebar 移走）
- ❌ 不動後端 Rust/Python
- ❌ 不破壞既有響應式（雖然 chrome 固定，內容仍可自適應）
- ❌ 不引入新依賴

---

## Verification Strategy

### Test Decision
- **既有測試**：無（專案無 test infrastructure）
- **本任務**：不新增測試，但用 TypeScript 型別檢查 + ESLint 守住品質

### QA Policy
每個檔案變更後：
1. `pnpm run ts-check` 必須通過
2. `pnpm run lint` 對修改檔案零錯誤（既有錯誤可保留）
3. `curl http://localhost:33300/` 必須 200
4. 用 curl 抓 HTML 確認關鍵 class 已生效

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (平行 - 基礎元件):
├── 新增 src/components/page-tabs-bar.tsx
├── 新增 src/components/footer.tsx
├── 新增 src/components/right-sidebar.tsx
└── 新增 src/components/ai-icon-button.tsx

Wave 2 (平行 - 互動元件 + Context):
├── 新增 src/lib/ai-drawer-context.tsx
└── 新增 src/components/ai-drawer.tsx

Wave 3 (整合 - 修改既有):
├── 重構 src/components/app-shell.tsx
├── 重構 src/components/sidebar-nav.tsx (改為 60px rail)
├── 簡化 src/components/header.tsx (60px toolbar)
└── 清理 src/app/page.tsx (移除 footer)

Wave 4 (整合 - layout):
└── 修改 src/app/layout.tsx (加入 AI Drawer Provider)

Wave FINAL:
├── F1: 視覺 QA（截圖 TradingView-style 對照）
├── F2: 響應式檢查（內容區仍自適應）
└── F3: 互動測試（AI 按鈕 → Drawer 開關）
```

---

## 檔案變更清單

### Wave 1 — 新增基礎元件

#### 1.1 `src/components/page-tabs-bar.tsx` (NEW, ~80 行)
- 顯示開啟中的「頁面 tabs」（每個 stock tab 一個）
- 高度 40px，背景色區隔 header
- 從現有 `useStockTabs` (`@/lib/stock-tab-context`) 拿資料
- 點 tab 切換 activeTab，X 按鈕關閉

#### 1.2 `src/components/footer.tsx` (NEW, ~50 行)
- 高度 `h-[50px]`
- 顯示連線狀態、版本號、或「台股分析平台 v2.0」
- 結構與 sidebar footer 對齊（`p-3` 但固定高度）

#### 1.3 `src/components/right-sidebar.tsx` (NEW, ~60 行)
- 寬度 `w-[60px]`
- 垂直堆疊 icon-only 按鈕（theme toggle、settings、help）
- 從 `@/lib/icon-map` 拿 icon

#### 1.4 `src/components/ai-icon-button.tsx` (NEW, ~40 行)
- 按鈕容器 `h-[45px] w-[45px]`
- 內含 `<Sparkles />` 或 `<Bot />` icon `h-[25px] w-[25px]`
- 點擊呼叫 `useAIDrawer().open()`

### Wave 2 — 互動元件

#### 2.1 `src/lib/ai-drawer-context.tsx` (NEW, ~40 行)
- React Context：`{ isOpen, open, close, toggle }`
- Provider wraps children in root layout

#### 2.2 `src/components/ai-drawer.tsx` (NEW, ~100 行)
- 用 Radix Dialog 或 shadcn Sheet（slide from right）
- 寬度 `w-[420px]`
- `z-[100]`
- 動畫：`animate-in slide-in-from-right`
- 內容：佔位 `<AIChatPlaceholder />`（之後實作）

### Wave 3 — 重構既有元件

#### 3.1 `src/components/app-shell.tsx` (重構)
- 從 header + sidebar 改成完整 5 區塊框架
- 新結構：
  ```
  <div min-h-screen>
    <PageTabsBar />
    <div flex flex-1>
      <LeftSidebar w-[60px]>
        ... nav items ...
        <AIIconButton /> (mt-auto, 推到底)
      </LeftSidebar>
      <div flex-1 flex flex-col>
        <Header h-[60px] />
        <main flex-1 overflow-auto>
          {children}
        </main>
        <Footer h-[50px] />
      </div>
      <RightSidebar w-[60px] />
    </div>
    <AIDrawer />
  </div>
  ```

#### 3.2 `src/components/sidebar-nav.tsx` (改寫)
- 移除 collapse 邏輯（永遠 60px icon-only）
- 簡化為 icon-only rail
- 從 `/api/menu` 拿 menu，渲染為 icon + tooltip
- AI 按鈕從這裡移到 `ai-icon-button.tsx` 並從 AppShell 引入

#### 3.3 `src/components/header.tsx` (簡化)
- 從 `h-16` (64px) 改為 `h-[60px]`
- 移除 `fixed` 定位，改為 flex item（在 PageTabsBar 下方）
- 移除複雜 dropdown，保留核心按鈕（search、theme、user）

#### 3.4 `src/app/page.tsx` (清理)
- 移除 `<footer>` 整段（line 432-450）
- 移除 `style={{ height: 'calc(100vh - 4rem)' }}`（改由 AppShell 控制）
- 移除 `min-h-[3.25rem]` 和 `overflow-hidden` 等 footer 相關樣式

### Wave 4 — Layout

#### 4.1 `src/app/layout.tsx` (修改)
- 在 `<StockTabProvider>` 內加入 `<AIDrawerProvider>`
- 在 `<body>` 內 `<AIDrawer />` 放在最後確保最高 z-index 不被裁切

---

## TODOs

- [x] 1. 建立 PageTabsBar 元件 (40px 高，從 useStockTabs 渲染 tabs) ✅
- [x] 2. 建立 Footer 元件 (50px 高，獨立可重用) ✅
- [x] 3. 建立 RightSidebar 元件 (60px 寬，AI 按鈕) ✅
- [x] 4. 建立 AIIconButton 元件 (45x45 容器，25x25 icon) ✅
- [x] 5. 建立 AIDrawerContext (Provider + hook) ✅
- [x] 6. 建立 AIDrawer 元件 (420px 寬，右側滑入，z-100) ✅
- [x] 7. 重構 AppShell 為 5 區塊框架 ✅
- [x] 8. 簡化 SidebarNav 為 60px Home+Grid popover rail ✅
- [x] 9. 簡化 Header 為 60px toolbar ✅
- [x] 10. 清理 page.tsx 移除 footer 與舊的 height 設定 ✅
- [x] 11. 修改 layout.tsx 加入 AIDrawerProvider + AIDrawer ✅

> 使用者回饋修正：LS / RS 對調
> - Left Sidebar：Home (頂) + Grid menu popover (底)
> - Right Sidebar：僅 AI 按鈕 (45x45)

---

## Final Verification Wave

- [x] F1. 視覺 QA：截圖比對 TradingView 風格 ✅
  - aside=3（左/右 sidebar + AI drawer）/ header=2 / footer=2 全部正確渲染
  - 所有 chrome 尺寸符合規範（PageTabsBar 40px / Header 60px / Sidebars 60px / Footer 50px / AI Button 45x45 / AI Icon 25x25 / AI Drawer w-[420px] z-[100]）
  - 截圖存在：`/tmp/aistock-screenshots/01-home.png`
- [x] F2. 響應式：內容區仍自適應視窗高度 ✅
  - `<main class="flex-1 min-h-0 overflow-hidden">` 內容區正確填滿
  - `h-screen flex flex-col` AppShell 完整 flex 布局
  - `hidden lg:block` sidebar 在小螢幕正確隱藏（768x600 截圖確認）
  - 截圖存在：`/tmp/aistock-screenshots/05-mobile.png`
- [x] F3. 互動：點 AI icon → drawer 滑入；ESC 或點背景 → drawer 關閉 ✅
  - 點 AI 按鈕 → drawer 從右側滑入（class 切換為 `translate-x-0`）
  - ESC → drawer 滑出（class 回到 `translate-x-full`）
  - 點 Grid → 開啟功能表 popover
  - 截圖存在：`/tmp/aistock-screenshots/02-grid-menu.png`, `03-ai-drawer.png`, `04-after-esc.png`
- [x] F4. TypeScript / Lint 全綠 ✅
  - `pnpm run ts-check` 通過（0 錯誤）
  - 5 lint 錯誤全部 pre-existing（admin/menu, auction/my-bids, chips/institutional, header setMounted）與本次改動無關
  - 修了一個 runtime bug：sidebar-nav API shape 不符（`groups` → `menu`）

---

## 截圖清單（puppeteer 實拍）

| 截圖 | 內容 |
|---|---|
| `01-home.png` | 首頁完整渲染：PageTabsBar + 左 sidebar (Home+Grid) + Header + 內容 + Footer + 右 sidebar (AI) |
| `02-grid-menu.png` | 左下 Grid icon 點擊後，Popover 顯示所有 menu 群組 |
| `03-ai-drawer.png` | 右下 AI 按鈕點擊後，420px 抽屜從右滑入（含「開始對話」placeholder）|
| `04-after-esc.png` | 按 ESC 後抽屜滑出回到 translate-x-full |
| `05-mobile.png` | 768x600 視窗下 sidebar 隱藏，只剩漢堡選單按鈕 |

---

## Success Criteria

- [ ] 所有 chrome 尺寸符合規範（sidebar 60px / header 60px / tabs 40px / footer 50px）
- [ ] AI drawer z-index 100，動畫順暢
- [ ] 內容區（dashboard, watchlist 等頁面）仍正常運作
- [ ] `pnpm run ts-check` 通過
- [ ] 無新增 lint 錯誤