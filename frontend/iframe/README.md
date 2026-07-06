# iframe/

> 標準化框架子目錄，從 `frontend/src/components/` 剝離出來，**目的是讓未來其他專案可複製此目錄直接使用**。

## 目錄結構

```
iframe/
├── components/           # 框架 React 元件
│   ├── AppShell.tsx
│   ├── Sidebar.tsx
│   └── PageTabsBar.tsx
├── lib/                  # 框架邏輯（hooks / context）
│   ├── tabs.tsx          # 多頁簽管理
│   └── actions.tsx       # 動作系統（switch / newTab / modal / drawer）
├── config/               # 預設 config
│   └── sidebar.json      # Siderbar icon 列表
├── types/                # 框架 types（待補）
├── hooks/                # 框架 hooks（待補）
└── docs/                 # 文件（待補）
```

## 核心 API

### `useTabs()` — 多頁簽管理

```tsx
import { useTabs } from '@/iframe/lib/tabs'

const { tabs, activeTabId, openTab, closeTab, setActiveTab, switchTo } = useTabs()

// 開新 tab
openTab({ id: 'stock-2330', title: '台積電', route: '/stock/2330' }, 'newTab')

// 切換到現有 tab（如果已開）
openTab({ id: 'stock-2330', title: '台積電', route: '/stock/2330' }, 'switch')

// 關閉 tab
closeTab('stock-2330')

// 切換 active
setActiveTab('stock-2330')
```

### `useActions()` — 動作系統

```tsx
import { useActions } from '@/iframe/lib/actions'

const { sidebar, registerSidebar, trigger } = useActions()

// 註冊 sidebar 設定
registerSidebar(sidebarItems)

// 觸發（依 item.behavior 自動決定行為）
trigger({ id: 'ai-assistant' })
```

### 4 種行為

| behavior | 效果 |
|---|---|
| `switch` | 切換到現有 tab（如已開），沒開就新增 |
| `newTab` | 永遠新增 tab |
| `modal` | 開 Modal（覆蓋在主視窗上） |
| `drawer-left` / `drawer-right` | 開側邊抽屜 |

## 使用範例

### 基本使用

```tsx
// app/page.tsx
import { AppShell } from '@/iframe/components/AppShell'
import sidebarItems from '@/iframe/config/sidebar.json'

export default function HomePage() {
  return (
    <AppShell sidebarItems={sidebarItems.items}>
      <div className="p-6">內容</div>
    </AppShell>
  )
}
```

### 自訂

```tsx
<AppShell
  sidebarItems={[
    { id: 'home', title: '首頁', icon: 'Home', route: '/', behavior: 'switch' },
    { id: 'ai', title: 'AI 助手', icon: 'Bot', route: 'ai', behavior: 'modal' },
  ]}
  homeTitle="我的首頁"
  homeRoute="/dashboard"
>
  {children}
</AppShell>
```

## 新專案使用

1. 整包複製 `iframe/` 目錄到新專案
2. 確認 `iframe/config/sidebar.json` 對應新專案的 menu
3. 在 `app/layout.tsx` 用 `<AppShell>` 包整個 app
4. 完成

## 設計原則

- **框架不綁定特定內容**：`iframe/` 不包含 stock 特定邏輯，只有通用框架
- **config-driven**：Siderbar/Header 透過 JSON config 設定，不寫死
- **行為可程式化**：4 種行為可在 sidebar item 上設定
- **TypeScript strict**：所有 API 都有完整型別
