# iframe/

> 標準化前端框架子目錄。完全 **config-driven**，所有 UI 行為、樣式、layout 都從 JSON config 讀取。
>
> 從 `frontend/src/components/` 剝離出來，未來其他專案可複製此目錄直接使用。

## 目錄結構

```
iframe/
├── components/                 # React 元件
│   ├── AppShell.tsx            # 主框架（讀所有 config）
│   ├── Sidebar.tsx             # 左 Siderbar
│   ├── Header.tsx              # Header（logo + tabbar + 設置）
│   ├── Footer.tsx              # Footer
│   ├── PageTabsBar.tsx         # 多頁簽 bar
│   ├── Drawer.tsx              # 抽屜（左/右）
│   └── Modal.tsx               # Modal
├── lib/                        # 邏輯
│   ├── tabs.tsx                # 多頁簽管理（useTabs hook）
│   ├── actions.tsx             # 動作系統（useActions hook）
│   └── load-config.ts          # Config loader（fetch 各 JSON）
├── types/                      # 型別
│   └── index.ts                # 所有型別定義
├── config/                     # **所有設定都在這**
│   ├── layout.json             # 整體 layout
│   ├── sidebar.json            # 左 Siderbar
│   ├── header.json             # Header
│   ├── footer.json             # Footer
│   └── theme.json              # 樣式 class
└── README.md
```

## 設計原則

- **完全 config-driven**：UI 行為、layout、樣式、icon、文字全部從 JSON 讀
- **零 hardcoded**：程式碼中沒有寫死的 menu、class、icon、字串
- **零商業邏輯**：iframe/ 不包含任何特定專案的邏輯（不含 stock、不含 aistock）
- **可複製**：整包複製到新專案，**只改 config** 就能用

## Config 檔案

### 1. `config/layout.json`（整體 layout）

控制 4 個區域的顯示與大小：

```json
{
  "id": "aiStock",
  "regions": {
    "header":   { "visible": true, "height": "3rem" },
    "sidebarL": { "visible": true, "width": "3.5rem" },
    "sidebarR": { "visible": true, "width": "18rem" },
    "footer":   { "visible": true, "height": "2rem" }
  }
}
```

任何 region 設 `visible: false` 就隱藏。

### 2. `config/sidebar.json`（左 Siderbar）

```json
{
  "position": "left",
  "items": [
    {
      "id": "home",
      "title": "首頁",
      "icon": "Home",
      "route": "/",
      "behavior": "switch",
      "tooltip": "回首頁"
    },
    {
      "id": "ai-assistant",
      "title": "AI 助手",
      "icon": "Bot",
      "route": "ai-assistant",
      "behavior": "modal"
    }
  ]
}
```

`behavior` 4 種：
- `switch` — 切換到現有 tab（如已開），沒開就新增
- `newTab` — 永遠新增 tab
- `modal` — 開 Modal
- `drawer-left` / `drawer-right` — 開側邊抽屜

### 3. `config/header.json`（Header）

```json
{
  "logo": "aiStock",
  "left": { "type": "tabs" },
  "right": {
    "items": [
      { "id": "settings", "title": "設定", "icon": "Settings", "label": "設定", "behavior": "modal" }
    ]
  }
}
```

`left.type`：`tabs`（多頁簽）或 `none`（不顯示）
`right.items`：右側按鈕（每個支援同 sidebar 的 4 種 behavior）

### 4. `config/footer.json`（Footer）

```json
{
  "items": [
    { "id": "version", "text": "aiStock v0.3.2" },
    { "id": "status",  "text": "已連線" }
  ]
}
```

### 5. `config/theme.json`（樣式 class）

```json
{
  "name": "shadcn-default",
  "classes": {
    "shell": "h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden",
    "header": "border-b border-border bg-card/40 backdrop-blur-sm flex items-center px-4 shrink-0",
    "sidebarL": "w-14 border-r border-border bg-card/40 backdrop-blur-sm flex flex-col items-center py-2 gap-1 shrink-0",
    "sidebarR": "w-72 border-l border-border bg-card/30 shrink-0 overflow-auto",
    "footer": "h-8 border-t border-border bg-card/30 flex items-center px-4 text-xs text-muted-foreground shrink-0",
    "main": "flex-1 min-w-0 overflow-auto",
    "sidebarButton": "w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors",
    "tabBar": "h-10 border-b border-border bg-card/40 backdrop-blur-sm flex items-center px-2 gap-1 shrink-0",
    "tab": "...",
    "tabActive": "...",
    "tabHome": "...",
    "tabHomeActive": "...",
    "tabClose": "..."
  }
}
```

**換主題**：建立 `theme-dark.json` 之類，在 `load-config.ts` 改來源即可。
不用改任何 React 程式碼。

## API

### `<AppShell>` 主元件

```tsx
import { AppShell } from '@/iframe/components/AppShell'

export default function HomePage() {
  return (
    <AppShell homeRoute="/" homeTitle="首頁">
      <div className="p-6">你的內容</div>
    </AppShell>
  )
}
```

`AppShell` 自動：
- fetch 所有 config（layout / header / footer / sidebar / theme）
- 套用 config 設定的 layout、樣式、icon、行為

### `useTabs()` 多頁簽

```tsx
import { useTabs } from '@/iframe/lib/tabs'

const { tabs, activeTabId, openTab, closeTab, setActiveTab, switchTo } = useTabs()

openTab({ id: 'stock-2330', title: '台積電', route: '/stock/2330' }, 'newTab')
```

### `useActions()` 動作系統

```tsx
import { useActions } from '@/iframe/lib/actions'

const { trigger, activeModal, activeLeftDrawer, activeRightDrawer, closeModal } = useActions()

trigger({ id: 'ai-assistant' })
```

## 新專案使用流程

1. 整包複製 `iframe/` 目錄
2. 把 `iframe/config/*.json` 放在新專案 `public/iframe/` 下（或自訂路徑）
3. 改 `iframe/config/sidebar.json` 設定新專案的 menu
4. 改 `iframe/config/header.json` 設定新專案的 logo 跟右側按鈕
5. 改 `iframe/config/footer.json` 設定 footer 文字
6. 改 `iframe/config/theme.json` 換主題（如果要）
7. 改 `iframe/config/layout.json` 決定哪些 region 顯示
8. 在新專案的 layout.tsx 用 `<AppShell>` 包整個 app
9. 完成，**不需要碰任何 React 程式碼**

## 為什麼 config 在 `public/iframe/` 下

- 直接 fetch，不用打包進 bundle
- 改 JSON 不用重新 build
- 部署時直接覆蓋 JSON 檔即可（不用重 build）
- 未來可以做「線上 config 更新」機制
