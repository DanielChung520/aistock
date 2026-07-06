# aiStock Tauri 多視窗框架規格

> Tauri 殼（egui 原生 UI）+ 多 webview 內容視窗 + React TS iframe 應用 + 多螢幕工作。
> 目的：標準化「本機框架 + 遠端內容」的多視窗架構，未來複製到其他專案。

---

## 一、整體架構

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri 主視窗（egui 原生）                │
│  ┌─ Header ─────────────────────────────────────────────┐  │
│  │ [logo] [系統名稱] [tab1] [tab2] [tab3] ...   [設置]   │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌─ Siderbar-L ─┐ ┌─ 內容區（多 webview） ─────────────┐  │
│  │              │ │                                      │  │
│  │  [icon 1]    │ │  每個頁簽 = 獨立 Tauri webview 視窗  │  │
│  │  [icon 2]    │ │  （可拖到其他螢幕）                  │  │
│  │  [icon 3]    │ │                                      │  │
│  │  ...         │ │  預設載入首頁（歡迎/登錄）           │  │
│  │              │ │                                      │  │
│  └──────────────┘ └──────────────────────────────────────┘  │
│  ┌─ Siderbar-R ─┐                                         │
│  │              │  ┌─ Footer ──────────────────────────┐  │
│  │  [icon]      │  │                                      │  │
│  │              │  └──────────────────────────────────────┘  │
│  └──────────────┘                                         │
│  ┌─ AI 助手浮動面板（egui 畫） ─────────────────────────┐  │
│  │  [聊天對話框]                                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

↓ 點 Siderbar icon 或 tabbar 的 [+] 開啟新 Tauri 視窗

┌──────────────────────────────┐
│ 頁簽視窗 1（Tauri webview）   │  ← 可拖到其他螢幕
│ 載入 stk.k84.org/<route>     │
│                              │
└──────────────────────────────┘

┌──────────────────────────────┐
│ 頁簽視窗 2（Tauri webview）   │
│ 載入 stk.k84.org/<route2>    │
└──────────────────────────────┘
```

---

## 二、專案目錄結構

```
aistock/                            ← 主專案
├── frontend/                       ← 既有 Next.js app（保留，未來可能被淘汰）
├── backend/                        ← 既有 FastAPI
├── iframe/                         ← Tauri 內容視窗框架（標準化，可複製）
│   ├── src/                        ← 內容來源
│   │   └── ...                     ← TODO: 確認內容形式
│   ├── config/                     ← 每個專案設定
│   │   ├── sidebar.json            ← Siderbar icon 列表
│   │   ├── header.json             ← Header 系統名稱、頁簽
│   │   └── content-routes.json     ← 路由對應表
│   ├── package.json                ← 獨立 Next.js 或 Vite
│   ├── tsconfig.json
│   └── docs/
│       ├── spec.md                 ← 本檔
│       └── setup.md                ← 新專案 setup 步驟
├── frontend/src-tauri/             ← Tauri（egui 框架）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── config/                     ← 預設 config（隨 .dmg 走）
│   │   ├── sidebar.json
│   │   ├── header.json
│   │   └── content-routes.json
│   └── src/
│       ├── lib.rs                  ← egui 主視窗 + Tauri commands
│       ├── frame.rs                ← 框架 UI（Siderbar/Header/Footer/AI 助手）
│       └── tabs.rs                 ← 頁簽管理（多 webview 開新視窗）
├── airflow/
├── docker-compose.yml
└── README.md
```

---

## 三、Tauri 主視窗

### 3.1 視窗結構

| 區域 | 內容 | 技術 |
|---|---|---|
| Header | logo + 系統名稱 + 頁簽管理（tabbar） | egui |
| Siderbar-L | icon 列表（從 sidebar.json 來） | egui |
| Siderbar-R | icon 列表（從 sidebar.json 來） | egui |
| Footer | 系統狀態、版本等 | egui |
| AI 助手 | 浮動聊天面板 | egui |
| 內容區 | 預設顯示首頁（內含 webview 載入首頁 URL） | Tauri webview |

### 3.2 Header tabbar 行為

| 操作 | 結果 |
|---|---|
| 開啟主視窗 | 預設有一個 tab「首頁」 |
| 點 tabbar 的 `[+]` | 開新 Tauri webview 視窗（空白頁） |
| 點 Siderbar icon | 開新 Tauri webview 視窗，載入對應 route |
| 點 tab | 把對應視窗拉到最前面 |
| 點 tab 的 `[X]` | 關閉對應視窗 |
| 拖 tab | 重新排序（如果實作） |

### 3.3 AI 助手

- 主視窗內浮動聊天面板（egui 畫）
- 點主視窗的 AI 按鈕 → 顯示/隱藏聊天面板
- 聊天內容透過 Tauri invoke 呼叫 Rust 函式
- 函式可能呼叫後端 LLM API

---

## 四、頁簽視窗

### 4.1 開新視窗流程

```rust
// 點 Siderbar icon → Rust 收到事件 → 開新 Tauri 視窗
let route = sidebar_item.route; // e.g. "/stock/2330"
let url = format!("https://stk.k84.org{}", route);
tauri::WebviewWindowBuilder::new(
    app,
    format!("tab-{}", uuid::Uuid::new_v4()),
    tauri::WebviewUrl::External(url.parse()?)
)
.title(format!("aiStock - {}", sidebar_item.name))
.inner_size(1200.0, 800.0)
.build()?;
```

### 4.2 視窗特性

| 特性 | 值 |
|---|---|
| 可拖到其他螢幕 | ✅ |
| 可調整大小 | ✅ |
| 獨立關閉 | ✅（關一個不影響其他） |
| 記住位置/大小 | ✅（用戶關閉再開會在同一位置） |

### 4.3 內容載入

- Tauri webview 直接連 `https://<content-base-url>/<route>`
- `<content-base-url>` 每個專案從 `iframe/config/content-routes.json` 讀
- aiStock 預設：`https://stk.k84.org`
- 其他專案可改：例如 `https://app.other-project.com`

---

## 五、Config 檔案

### 5.1 `iframe/config/sidebar.json`（複製到 `frontend/src-tauri/config/sidebar.json`）

```json
{
  "items": [
    {
      "name": "首頁",
      "icon": "Home",
      "route": "/",
      "tooltip": "首頁 - 系統歡迎頁",
      "type": "tab",
      "note": "v1.0"
    },
    {
      "name": "個股",
      "icon": "TrendingUp",
      "route": "/stock",
      "tooltip": "個股分析",
      "type": "tab",
      "note": ""
    },
    {
      "name": "AI 助手",
      "icon": "Bot",
      "route": "ai-assistant",
      "tooltip": "AI 助手",
      "type": "modal",
      "note": ""
    }
  ]
}
```

`type` 欄位：
- `tab`：點擊開新 Tauri webview 視窗（Chrome 風格）
- `modal`：點擊在主視窗內彈出（不開新 tab）

### 5.2 `iframe/config/header.json`

```json
{
  "system": {
    "icon": "aistock-icon",
    "name": "aiStock"
  },
  "headerRight": {
    "items": ["settings", "update", "theme"]
  }
}
```

### 5.3 `iframe/config/content-routes.json`

```json
{
  "contentBaseUrl": "https://stk.k84.org",
  "defaultRoute": "/",
  "routes": {
    "/": "首頁",
    "/stock": "個股",
    "/dashboard": "儀表板"
  }
}
```

---

## 六、Tauri Commands（Rust API）

前端（JS）或主視窗的 egui 透過 `invoke` 呼叫：

```rust
#[tauri::command]
fn read_sidebar_config() -> Result<SidebarConfig, String> { ... }

#[tauri::command]
fn read_header_config() -> Result<HeaderConfig, String> { ... }

#[tauri::command]
fn read_content_routes() -> Result<ContentRoutes, String> { ... }

#[tauri::command]
fn open_tab_window(route: String) -> Result<(), String> {
    // 開新 Tauri webview 視窗載入 <contentBaseUrl><route>
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo { version: "0.3.2", /* ... */ }
}

#[tauri::command]
fn call_python_api(endpoint: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    // shell call uvicorn / FastAPI
}
```

---

## 七、其他專案使用流程

### 7.1 複製到新專案

```bash
# 1. 複製 iframe/ 目錄
cp -r aistock/iframe/ new-project/

# 2. 複製 Tauri 框架（egui 主視窗 + Cargo.toml + lib.rs 等）
cp -r aistock/frontend/src-tauri/ new-project/frontend/src-tauri/
cp aistock/frontend/Cargo.toml new-project/frontend/Cargo.toml  # 注意：是 Tauri 的，不是 Next.js

# 3. 修改新專案的 config
# - iframe/config/sidebar.json → 新專案的 menu
# - iframe/config/header.json → 新專案的系統名稱
# - iframe/config/content-routes.json → 新專案的內容 URL
```

### 7.2 客製化項目

| 項目 | 改哪裡 |
|---|---|
| Siderbar icon 列表 | `sidebar.json` |
| 系統名稱/logo | `header.json` |
| 內容 URL | `content-routes.json` |
| AI 助手介面 | `frontend/src-tauri/src/frame.rs`（egui 程式碼） |
| Tabbar 樣式 | `frontend/src-tauri/src/tabs.rs`（egui 程式碼） |

### 7.3 不需要改的部分

- Tauri 框架結構（egui 主視窗 layout）
- 頁簽視窗開啟機制
- Config 載入機制
- Rust API commands（read_*_config）

---

## 八、開發階段

### Phase 1（基本殼）
- [ ] Tauri 主視窗 + egui 框架雛形
- [ ] 5 區 layout（Header/Siderbar-L/Siderbar-R/Footer/AI 助手）
- [ ] 預設首頁 webview（iframe）
- [ ] Cargo.toml 加 egui 依賴
- [ ] 預設 config 範例檔

### Phase 2（頁簽 + 動態）
- [ ] Siderbar icon 從 sidebar.json 動態讀取
- [ ] 點 icon 開新 Tauri webview 視窗
- [ ] tabbar 管理（已開啟的頁簽清單）
- [ ] 點 + 開空白新頁簽

### Phase 3（AI 助手 + 多螢幕）
- [ ] AI 助手聊天面板（egui）
- [ ] 視窗位置/大小記憶
- [ ] 多螢幕拖曳支援

### Phase 4（其他專案）
- [ ] 寫 setup.md
- [ ] 測試複製流程
- [ ] 範例專案展示

---

## 九、已釐清的問題

### 9.1 iframe/ 內容形式
- **iframe/ 是 React TS 應用**，由 Tauri webview 載入
- **不打包進 .dmg**（iframe/ 跟 frontend/ 一樣是獨立專案）
- Tauri 開新視窗時透過 `contentBaseUrl` 載入內容
- 未來其他專案複製 iframe/，iframe/ 內的 React 程式碼跟著專案走

### 9.2 點 icon 的行為分兩種
- **功能頁面（route）** → 開新 tab 載入（Chrome / Tradingview 風格，多視窗可拖到其他螢幕）
- **Modal** → 在主視窗內彈出（不開新 tab，不進 tabbar）

判斷方式：sidebar.json 內每個 item 標記 `type: "tab" | "modal"`。

### 9.3 AI 助手
- **Tauri 主視窗內 egui 畫的聊天面板**
- 風格參考現有專案的 stk 設計（shadcn/ui 風格）
- 透過 Tauri invoke 呼叫 Rust 函式
- Rust 函式未來呼叫 LLM（哪個 LLM 待決定）
- 若實作有困難，未來改版再說

### 9.4 Rust API 統一調度
- **所有外部 API 呼叫都透過 Rust 介面**
- Rust 介面後面接：可能 Python FastAPI、其他語言、其他 protocol
- 前端（iframe/ 內 React）只呼叫 Tauri invoke，不直接 fetch 外部 API
- 這是統一架構，未來所有專案都這樣

### 9.5 開發模式
- **用 `pnpm tauri dev` 或 `cargo tauri dev`**（package manager 用 pnpm）
- `iframe/` 內的 React TS 應用也跑 dev server（Vite/Next dev）
- Tauri 開新視窗時 devUrl 連到 iframe/ 的 dev server
- 生產 build 時 iframe/ build 出靜態檔，Tauri 連線變成讀本地或讀部署後的 URL

### 9.6 更新機制
- **開發期不需要打包**（除非框架有重大變更）
- 改前端（iframe/ 內 React）→ iframe/ dev server reload，立即看到
- 改 Tauri 框架（egui 殼）→ 重 build Tauri
- 框架變更的判斷：Siderbar/Header/Footer/AI 助手結構或互動方式變更 = 框架變更
- 本地開發者（Mac Intel）自己重新 build + 重裝

### 9.7 主題樣式
- **基本樣式用 stk 現有專案的設計**（shadcn/ui / Tailwind v4 風格）
- **主題只套用在 Tauri 框架（egui 殼）**
- iframe/ 內的 React 應用有自己的主題（不需跟框架一致）
- 不同專案可換主題（透過 theme.json 或 Rust 程式碼）

### 9.8 多視窗頁簽同步
- **目前先不處理**（由各專案自己管）
- 主視窗 tabbar 跟已開啟的頁簽視窗的同步：
  - 簡單方式：主視窗啟動時掃描已開的視窗，同步 tabbar
  - 中等：Tauri event 廣播頁簽狀態
  - 進階：用 cookie / redis 統一管理（之後再說）
- 目前**先做簡單方式**

---

## 十、相關文件

- `tauri-architecture-decisions.md`（v0.2.0 → v0.3.0 問題排查）
- `installation-guide.md`（安裝指南）
- `release-checklist.md`（發佈 SOP）

---

**最後更新**：v0.3.2 規劃時建立
**維護者**：Daniel Chung
