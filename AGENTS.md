# AGENTS.md — aiStock Development Guide

This file provides instructions for agentic coding agents (and human developers) working
in this repository. aiStock is a Taiwan stock analysis platform (台股分析平台) built with
Next.js (frontend + API routes), FastAPI (Python backend microservice), ArangoDB (document
database), and twstock (Taiwan stock data library).

---

## Repository Layout

```
aiStock/
├── frontend/                    # Next.js App Router (port 33300)
│   ├── src/
│   │   ├── app/                 # Pages & layouts (App Router)
│   │   │   ├── page.tsx         # Homepage (台股儀表板 — Wave 4 pending)
│   │   │   ├── stock/[symbol]/  # Individual stock detail page
│   │   │   ├── watchlist/       # Watchlist management page
│   │   │   ├── admin/menu/      # Admin menu management (Phase 1)
│   │   │   └── api/             # Proxy routes → FastAPI
│   │   │       ├── stocks/[...path]/  # → /api/stocks/*
│   │   │       ├── market/[...path]/  # → /api/market/*
│   │   │       ├── watchlist/         # → /api/watchlist
│   │   │       ├── system-settings/   # 系統設定 (LLM provider 等) GET/PUT → ArangoDB
│   │   │       ├── indicators/        # GET /api/indicators → 讀 .docs/indicators/*.json (指標知識庫)
│   │   │       ├── menu/             # Menu CRUD (Phase 1, direct ArangoDB)
│   │   │       └── docs/[...key]/    # GET /api/docs/<key> → SeaweedFS aistock-reports (ow 報告連結)
│   │   ├── components/
│   │   │   ├── stocks/          # Stock UI components (7 files)
│   │   │   ├── sidebar-nav.tsx  # Dynamic sidebar (Phase 1)
│   │   │   ├── header.tsx       # Header with settings dropdown
│   │   │   ├── ui/             # 53 shadcn/ui components
│   │   │   └── dashboard/      # Dashboard components
│   │   ├── lib/
│   │   │   ├── arangodb.ts     # ArangoDB connection singleton
│   │   │   ├── utils.ts        # Utility functions (cn, etc.)
│   │   │   └── system-settings-defaults.ts  # LLM provider presets/型別 (6 家, 與 route 共用)
│   │   ├── hooks/
│   │   │   ├── use-indicator-settings.ts  # Indicator settings hook (localStorage)
│   │   │   └── use-system-settings.ts     # 系統設定 hook (localStorage 快取 + ArangoDB 持久化)
│   │   └── types/
│   │       ├── menu.ts         # Menu type definitions
│   │       └── stock.ts        # Stock type definitions
│   ├── scripts/                # DB seed/reset scripts
│   ├── docker-compose.yml      # ArangoDB Docker config (port 8530)
│   ├── .env.local              # Environment variables (never commit)
│   ├── package.json            # pnpm dependencies
│   └── tsconfig.json           # TypeScript config
├── backend/                    # FastAPI microservice (port 38000)
│   ├── src/
│   │   ├── main.py             # FastAPI app, CORS, startup
│   │   ├── config.py           # pydantic-settings
│   │   ├── db.py               # ArangoDB connection (python-arango)
│   │   ├── models.py           # Pydantic models
│   │   ├── indicators.py       # MA/KD/RSI calculation functions
│   │   ├── llm.py              # OpenAI-compatible LLM client (stateless, 設定由 router 傳入)
│   │   ├── rate_limiter.py     # TWSE rate limiter (3 req/5 sec)
│   │   └── routers/
│   │       ├── stocks.py       # /search, /history, /indicators, /analysis
│   │       ├── watchlist.py    # GET/POST/DELETE /watchlist
│   │       ├── market.py       # /taiex endpoint
│   │       └── strategy.py     # /ai-suggest-stocks (LLM 選股建議)
│   ├── scripts/
│   │   ├── seed_stock_codes.py # Seed 1845 stocks from twstock.codes
│   │   └── daily_update.py     # Daily batch update (Wave 4 pending)
│   ├── .env                    # Backend config
│   ├── .venv/                  # Python virtual environment
│   ├── pyproject.toml          # Python project metadata
│   └── requirements.txt        # pip dependencies
├── .docs/                       # 知識庫 / 設計文件
│   └── indicators/              # ★ 指標知識庫 (每指標一份 JSON) — 見下方專節
│       ├── {metric}.json        # 64 份指標定義 (metric/公式/參數/可執行性/圖譜關係)
│       ├── SCHEMA.md            # JSON schema 與欄位規範
│       ├── TA-LIB-INVENTORY.md  # TA-Lib 盤點 (A/B/C/D 分級)
│       ├── FINLAB-INVENTORY.md  # FinLab 盤點 (台股特有補源)
│       └── RAG.md / GRAPH.md    # 檢索層與圖譜設計
├── .sisyphus/                  # Work plans & drafts
└── AGENTS.md                   # This file
```

---

## 指標知識庫（Indicator Knowledge Base）

指標知識庫是「指標領域的 source of truth」，供前端 `/indicators` 頁面、後端
`indicator_rag.py` 檢索層共用。**新增/修改指標一律改這些 JSON，不是改 code。**

### 保存路徑

| 內容 | 路徑 | 說明 |
|---|---|---|
| 指標定義 | `.docs/indicators/{metric}.json` | 每指標一份，64 份。欄位規範見 `SCHEMA.md` |
| Schema 規範 | `.docs/indicators/SCHEMA.md` | JSON 欄位定義、來源規範、已實作對照表 |
| TA-Lib 盤點 | `.docs/indicators/TA-LIB-INVENTORY.md` | A/B/C/D 分級，定義收錄範圍 |
| FinLab 補源 | `.docs/indicators/FINLAB-INVENTORY.md` | 台股特有指標（乖離率、營收、法人等） |
| 檢索設計 | `.docs/indicators/RAG.md` / `GRAPH.md` | 檢索層 API 與指標圖譜設計 |

### 消費端（讀取同一份 JSON）

- **前端 API**：`frontend/src/app/api/indicators/route.ts` → `GET /api/indicators`，
  路徑用 `INDICATOR_KB_PATH` env 覆寫，預設 `{repo}/.docs/indicators`。
  頁面：`frontend/src/app/indicators/page.tsx`（依 `implementation.implemented` 篩「僅已實作」）。
- **後端檢索層**：`backend/src/indicator_rag.py` → embedding 檢索，可執行性以
  `INDICATOR_CATALOG`（`backend/src/strategy.py`）為權威：JSON 標 `implemented=true` 且
  metric 在 catalog（或 `catalog_metric` 映射到 catalog）才列為可執行。

### 維護規則

- 新增指標：複製既有 JSON 改 `metric`/`name`/`formula`/`parameters`/`signals`，對照
  `TA-LIB-INVENTORY.md` 分級決定 `implementation.implemented`。
- 可執行性必須與 `INDICATOR_CATALOG` 同步——JSON 標 `implemented=true` 但 catalog 無此
  metric 時，LLM 生成的條件會被 `_validate_conditions` 丟棄。現況（2026-08 已接線）：
  `INDICATOR_CATALOG` 66 metric，`compute_snapshot()` 全部計算（`indicators.py` 34 +
  `indicators_ext.py` 32）；知識庫 64 JSON 中 62 個可執行（`macd`/`stochrsi`/`aroon`
  以一對多展開成 catalog 的 3/2/2 個 metric）。`beta`/`correl` 需大盤基準序列
  （`stock_daily` 無台指期/指數資料），維持 `implemented=false`，日後大盤資料入庫再接入。
- 公式以 TA-Lib 為基準，台股慣例（扣抵值、量比、9/3/3）見 `notes`；FinLab 僅整理公式不複製 code。

---

## Build, Lint & Test Commands

### Frontend (Next.js — in `frontend/`)

```bash
# Package manager: pnpm (enforced by preinstall hook)
pnpm install

# Development server
pnpm run dev               # Next.js dev (port 33300 or via scripts/dev.sh)

# Production build
pnpm run build

# Type-check without emitting
pnpm run ts-check          # tsc -p tsconfig.json

# Lint (ESLint)
pnpm run lint

# Seed menu data to ArangoDB
pnpm run db:seed           # npx tsx scripts/seed-menu.ts

# Reset menu data
pnpm run db:reset          # npx tsx scripts/reset-menu.ts
```

### Backend (FastAPI — in `backend/`)

```bash
# Setup Python virtual environment
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run FastAPI server (port 38000)
uvicorn src.main:app --reload --host 0.0.0.0 --port 38000

# Seed stock codes from twstock
python scripts/seed_stock_codes.py

# Compile check
python -m compileall src/
```

### Infrastructure

```bash
# Start ArangoDB (Docker Compose, port 8530)
cd frontend && docker compose up -d
```

> **架構備註**：ArangoDB 是 host-level 共用 infra（`arangodb` container，port 8529），多業務以 `_db/<business>` 隔離。
> 本專案 DB 名為 **`aistock`**。完整規範與新業務 DB 建立流程：[`DanielChung520/workspace-infra`](https://github.com/DanielChung520/workspace-infra)。
> 目前 frontend 內的 docker-compose.yml 暫保留，待遷移至共用 instance。

---

## Code Style — TypeScript / JavaScript

### Formatting
- **Prettier** is the canonical formatter. Always run `npm run format` before committing.
- 2-space indentation; single quotes; trailing commas (`"all"`); 100-character line width.
- Semicolons: **omit** (rely on ASI).

### Imports
- Use ES module `import`/`export` syntax exclusively. No `require()`.
- Order: (1) Node built-ins, (2) third-party packages, (3) internal `@/` path aliases, (4) relative imports.
- Use the `@/` alias for project-root imports (`@/lib/...`, `@/components/...`).
- Prefer named exports; use default exports only for Next.js pages/layouts.

### TypeScript
- `strict: true` is enforced — never disable strict-mode flags inline.
- Prefer `interface` for object shapes; use `type` for unions, intersections, and mapped types.
- Avoid `any`. Use `unknown` and narrow explicitly, or create a proper type.
- Avoid `as` type assertions except when interfacing with untyped third-party code; add a comment explaining why.
- Prefer `readonly` for props and data-transfer objects.
- All async functions must return typed Promises: `Promise<T>` not `Promise<any>`.
- Use `zod` for runtime validation of external data (API responses, env vars, form inputs).

### Naming Conventions
| Construct | Convention | Example |
|---|---|---|
| Variables / functions | `camelCase` | `fetchStockData` |
| React components | `PascalCase` | `StockChart` |
| Files (components) | `PascalCase.tsx` | `StockChart.tsx` |
| Files (utils/lib) | `kebab-case.ts` | `format-currency.ts` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Types / Interfaces | `PascalCase` | `StockQuote`, `ApiError` |
| Zod schemas | `PascalCase + Schema` | `StockQuoteSchema` |

### Error Handling
- Never swallow errors silently (`catch (e) {}`). Always log or re-throw.
- Use a typed `AppError` class (or discriminated union) for domain errors.
- In Next.js API routes and Server Actions, return structured JSON error responses with HTTP status codes.
- In async server code, use `try/catch` around I/O (ArangoDB queries, external APIs).
- Validate all environment variables at startup with `zod` and fail fast if required vars are missing.

### React / Next.js
- Prefer **Server Components** by default; opt into `'use client'` only when browser APIs or interactivity are required.
- Co-locate component-specific types in the same file as the component.
- Keep components small (< 200 lines). Extract logic into custom hooks (`use-*.ts`) or server actions.
- Use `next/image` for all images; avoid raw `<img>` tags.

---

## Code Style — Python

### Formatting & Linting
- **Ruff** is used for both linting and formatting (replaces Black + isort + flake8).
- Target Python `3.11+`. Line length: 100.
- Type annotations are **required** for all public functions and class methods.

### Imports
- Use absolute imports from the package root. No relative imports beyond one level.
- Standard library → third-party → internal, separated by blank lines (Ruff handles this).

### Naming Conventions
- `snake_case` for variables, functions, modules; `PascalCase` for classes; `UPPER_SNAKE` for constants.
- Prefix private helpers with a single underscore `_helper`.

### Error Handling
- Raise specific exception subclasses (`ValueError`, `RuntimeError`, or custom `AppError`).
- Never use bare `except:`. Catch the narrowest exception type possible.
- Log exceptions with `logging` (not `print`). Include context in the message.

### Data / ArangoDB
- Always use AQL parameterised queries — never f-string or template literal injection.
- Use `python-arango` context managers or explicit cursor handling.
- All stock data writes go through FastAPI backend only.

---

## Environment Variables

- Secrets and config live in `.env.local` (never committed).
- Validate all env vars at app startup using `zod` (TypeScript) or `pydantic-settings` (Python).
- Document every required variable in `.env.example` with a placeholder value and a comment.

---

## Documentation Discipline（文件同步規範）

**規則：任何建立或修改程式碼的 commit，必須同時新增或更新對應文件。**

- 文件位置：`.docs/**` 或任何 `*.md`。依 `.docs/` 慣例：
  - 需求 / 討論：`.docs/requirement-<slug>.md`
  - 子系統規格：`.docs/<subsystem>/`（例：`.docs/accounting/REQUIREMENTS.md`、`.docs/indicators/SCHEMA.md`）
  - 既有功能說明：`.docs/<topic>.md`（例：`.docs/simulation-replay.md`）
- 何時必須更新文件：
  - 新增功能 / 模組 / API → 新增或更新對應需求或規格文件
  - 改變資料模型（ArangoDB 集合 / schema）/ 架構 / 守則 → 同步更新規格與本檔
  - 修 bug / 純重構 / 格式 → 若無語義變更可略過（需在 commit message 說明）
- **強制機制**：本 repo 使用版本控管的 git hook `.githooks/pre-commit`，偵測到程式碼變更但**無任何文件變更**時會**阻擋 commit**。
  - 一次性啟用（每個 clone 各做一次）：`git config core.hooksPath .githooks`
  - 緊急略過：`DOC_SYNC_BYPASS=1 git commit ...`（並在 commit message 說明原因）
- 監督：本規則以 hermes 記憶（`policy-doc-sync`）監督，跨 session 生效。

---

## Git Conventions

- Branch names: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Commit messages follow **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- 程式碼變更須同步文件（見「Documentation Discipline 文件同步規範」）。
- Never commit secrets, `.env.local`, or generated build artifacts.
- Run `npm run typecheck && npm run lint && npm test` before opening a PR.

---

## ArangoDB Guidelines

- ArangoDB runs via Docker Compose on **port 8530** (db=`aistock`, user=`root`, pwd=`aistock2024`).
- Frontend uses **arangojs** (singleton in `src/lib/arangodb.ts`) for direct reads (menu collections).
- Backend uses **python-arango** (singleton in `src/db.py`) for stock data reads/writes.
- Collections: `stock_codes` (1845 docs), `stock_daily`, `watchlist` (cap 50), `menu_items`, `menu_groups`, `system_settings` (LLM/系統設定 singleton doc `_key: "system"`).
- Always use AQL parameterized queries — never f-string or template literal injection.

---

## Architecture

```
Next.js (port 33300) → API routes (proxy) → FastAPI (port 38000) → twstock → TWSE/TPEx
                                                    ↕
                                               ArangoDB (port 8530)
```

### Guardrails
- **G1**: Next.js NEVER calls twstock/TWSE directly. ALL stock data flows through FastAPI.
- **G2**: FastAPI owns WRITE to stock collections. Next.js may READ via arangojs (menu only).
- **G3**: No real-time polling — daily batch update after market close only.
  - **例外1（2026-10，2026-10-28 升級為真即時）**：首頁「加權指數 10 分K」圖表為**真即時推播**——後端以**富邦即時 WebSocket**（`candles` 頻道，需 `init_realtime(mode=Normal)`；Speed 模式不支援該頻道）訂閱加權指數 `IX0001`、將推播的 1 分K聚合成 10 分K，並經 **SSE**（`GET /api/market/taiex/stream`）主動推給前端；僅**台股交易時段（週一–五 09:00–13:35 台北時間）**訂閱，前端分頁可見時維持 SSE 連線。SSE 斷線時退化為 60 秒輪詢（display-only、不下單、不影響其他資料路徑）。實作：`backend/src/realtime/index_feed.py`、`backend/src/routers/market.py`、`frontend/src/app/page.tsx`、`frontend/src/app/api/market/taiex/stream/route.ts`；規格：`.docs/dashboard-taiex-10m.md`。
  - **例外2（2026-10-27 決策，工作站待實作）**：**工作站（階段1/2）允許盤中輪詢**（決策「全面放寬」）。運作限制：僅交易時段（沿用 `market-hours`）、範圍僅限工作站清單（觀察／持倉）、頻率有界。除此之外的股票/選股資料仍維持盤後批次。規格：`.docs/requirement-workstation.md`。
  - **例外3（2026-10-29）**：**個股看盤即時**——個股圖表 tab（`StockDetailPanel`，**日K 與分K（預設 60 分K）皆即時**，即時只更新「當前那一根」K 棒、歷史不動、圖表就地 `setData` 不重建）與「我的股票」清單（`MyStocksList`）依**選定股票**以 SSE 即時刷新。後端共用同一富邦 WebSocket feed（`backend/src/realtime/live_feed.py`，`init_realtime(mode=Normal)`），採**訂閱興趣制**（只訂閱有開啟 SSE／近期讀取的標的，非所有分頁）；即時只推**當日增量**，前端合併去重並寫入 IndexedDB 快取，SSE 斷線退化為輪詢。端點：`GET /api/stocks/{symbol}/stream`（圖表 bars+指標）、`GET /api/watchlist/stream`（清單報價）。規格：`.docs/realtime-stock-watchlist.md`。
- **G4**: ALL UI text in 繁體中文. `lang="zh-TW"`.
- **G5**: 台股紅漲綠跌 (red = up, green = down — opposite of US convention).
- **G6**: Indicators: MA (configurable periods, SMA/EMA), KDJ (configurable), RSI (configurable), MACD (configurable), Bollinger Bands (configurable). No other indicators.
- **G7**: TWSE rate limit: 3 requests per 5 seconds (enforced by `rate_limiter.py`).
- **G8**: Phase 1 routes (/admin/menu, /api/menu) remain untouched.
- **G9**: All indicator calculations MUST happen in the backend. Frontend NEVER computes from raw OHLCV.
- **G10**: Indicator settings stored in localStorage key `aistock-indicator-settings` with versioned schema.
- **G11**: Use lightweight-charts v5 native pane API (`addSeries(type, opts, paneIndex)`). Do NOT create multiple chart instances.
- **G12**: Minute-data indicators use same calculation functions as daily.
- **G13**: ALL AI/LLM calls in this project MUST use the LLM connection settings from 系統設定 (系統設置 → 一般設定). Settings are persisted in ArangoDB `system_settings` collection (singleton `_key: "system"`, schema in `frontend/src/lib/system-settings-defaults.ts`) and served to the frontend via `GET/PUT /api/system-settings` + `use-system-settings` hook (localStorage as cache/migration source). Backend `llm.py` `chat_completion()` is **stateless**: the router MUST receive the settings object from the frontend request (`llm.baseUrl / model / apiKey / temperature / contextWindow`) and pass it in — never read env vars or hardcode provider/model/base_url/api_key on the backend. **例外**：右下角「AI 助手」為獨立的 opencode-web（ow）執行環境（systemd `ow-default.service`，port 14096，`OW_LOCK=1` 鎖定 aistock worktree），其模型/API Key 於 ow 內設定，不屬本條約束；勿將其改接系統設定。
- **G14**: LLM providers are exactly 6: `gemini`, `openai`, `anthropic`, `opencode-zen`, `opencode-go`, `minimax`. `opencode-zen` / `opencode-go` fall back to the local dllm service (`http://localhost:11400/v1`, models Qwen3-8B-AWQ etc. — see `/home/daniel/github/dllm`). New providers must be added to `system-settings-defaults.ts` (presets + model lists) and validated by `migrateSettings`.
- **G15**: 右下角 ow「AI 助手」以 `analyst` agent 執行（ow config `~/.config/ow/default/opencode/opencode.json` 的 `default_agent`）。對 aistock repo **唯讀**：`edit`（涵蓋 `edit`/`write`/`patch`）全 `deny`，僅暫存區 `~/.config/ow/default/.tmp/aistock/**` 可寫（需同時 `external_directory` allow）。分析師**腳本優先**——可重用腳本放 `~/.config/ow/default/.tmp/aistock/scripts/`（`screen.sh` / `activity.sh` / `upload_report.py`），產出 HTML 報告上傳 SeaweedFS bucket `aistock-reports`，並以 `https://stk.k84.org/api/docs/<key>` 回覆連結（前端 proxy `frontend/src/app/api/docs/[...key]/route.ts` → filer `:8888/buckets/aistock-reports/<key>`；env `SEAWEEDFS_FILER_URL` / `SEAWEEDFS_REPORT_BUCKET`）。全體 agent 政策檔為 `~/.config/ow/default/opencode/policy/AGENT-POLICY.md`，由 ow 專屬 Hermes 記憶（`~/.config/ow/default/opencode/hermes/memory/`）監督。
- **G16**: **Tab 模型規則（2026-10 定案）**——頁籤列（`PageTabsBar`）只有兩種 tab：一個「首頁」tab + 多個股票圖表 tab。
  - **點擊任何股票（查詢股票）**：一律呼叫 `useStockTabs().openTab(symbol, name)` 新增/聚焦股票 tab（同 symbol 去重並聚焦），**不得**直接 `router.push('/stock/<symbol>')` 整頁跳轉。股票 tab 由 `AppShell` 全域渲染（`StockDetailPanel`），任何頁面啟用即顯示。
  - **sidebar-left（`SidebarNav`）功能導覽**：只負責切換「首頁」tab 的內容——`router.push(route)` + `setActiveTab(null)`。**不新增 tab、不關閉股票 tab**。
  - **狀態保留**：所有股票 tab 在 `AppShell` 中**保持 mounted**（僅切 `display`），切換 tab/頁面**不得 unmount**（圖表、指標、捲動位置全部保留，避免重抓資料）；只有使用者關閉 tab（`closeTab`）才銷毀。`StockTabContext` 以 sessionStorage（key `aistock-stock-tabs`，versioned）持久化 tabs/activeTab，reload 後仍保留。
  - `/stock/[symbol]` 整頁路由保留給外部連結/直接網址存取；站內互動一律走 tab。
- **G17**: **版本檢查 / 安裝檔走 stk.k84.org 自架下載（2026-10 定案）**——安裝檔與更新 manifest 存放在 SeaweedFS `aistock-installers` bucket，經前端 proxy `frontend/src/app/api/installers/[...key]/route.ts` → filer `:8888/buckets/aistock-installers/<key>` 伺服（env `SEAWEEDFS_FILER_URL` / `SEAWEEDFS_INSTALLER_BUCKET`）。`lib/updater.ts` 的 Web 端**優先**查同源 `/api/installers/latest.json`（Tauri updater manifest，含各平台 URL），GitHub API 僅為備援；Web「下載」開 `/install` 頁（動態抓 manifest 版本）。更新 `latest.json`/上傳新安裝檔：`curl -X PUT -H "Content-Type: application/octet-stream" --data-binary @<file> http://localhost:8888/buckets/aistock-installers/<file>`（**勿用 `-F` multipart**——filer 會連 boundary 一起存）。
  - **Tauri 桌面版自動更新簽章**（updater 已配置：`tauri.conf.json` → `bundle.createUpdaterArtifacts: true` + `plugins.updater.{pubkey, endpoints:["https://stk.k84.org/api/installers/latest.json"]}`）。
  - **根金鑰（勿外洩）**：private key `~/.tauri/eea-updater.key`（密碼 `~/.tauri/eea-updater.password`），且已複製進 `frontend/.env.local`（`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` / `TAURI_UPDATER_PUBKEY`）；pubkey 亦寫死在 `tauri.conf.json`。GitHub repo secrets 需同步設 `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（CI `release.yml` 已引用）。
  - **生成方法**（重設/換鑰時）：`cd frontend && pnpm exec tauri signer generate -w ~/.tauri/<name>.key -p <password>` → 產出 private key + `.pub`（pubkey）。把 private key 內容與密碼寫入 `frontend/.env.local`、pubkey 寫入 `tauri.conf.json` `plugins.updater.pubkey`，並同步 GitHub secrets。**private key/密碼遺失即無法再簽章，更新將失效。**
  - **簽章 build**：`bash frontend/scripts/build-tauri.sh`（自動 source `.env.local` 載入根金鑰再 `tauri build`）。產出物含 `*.sig` 與各平台 `latest.json`（有簽章）。
  - **發佈新版流程**：1) `bash frontend/scripts/build-tauri.sh` 產出安裝檔 + `.sig`；2) 把安裝檔與 `.sig`、`latest.json`（platform 的 `signature` 填 `.sig` 內容、`url` 指 `https://stk.k84.org/api/installers/<file>`）用 `--data-binary` PUT 上傳到 `aistock-installers` bucket；3) 同步 GitHub release（供備援）。Web 端檢查 `latest.json` 版本自動生效。
  - **版本來源 / 可略過（2026-10-29 修正）**：Web 端「目前版本」取 **`frontend/package.json` 的 `version`**（`lib/updater.ts:getCurrentVersion`）；`tauri.conf.json` 被 tsconfig exclude，web 讀不到。⚠️ **發版時必須把 `package.json` version 同步 bump**（與 `tauri.conf.json`、`latest.json` 一致），否則 web 會一直誤報有新版本（曾發生 package.json=0.2.0 vs manifest=0.4.2）。另新增 **「略過此版本」**：更新 dialog 可按略過，把版本存 `localStorage['aistock-skipped-version']`，`check()` 會略過該版本（更新版號仍會通知）。
- **G18**: **LINE OA 通知（2026-10-29）**——執行選股策略後，經 **LINE Messaging API** 把結果推播給「已加入 OA 且被標記接收」的使用者。憑證存 `sdk/lineOA/.env`（`Channel_ID`/`Channel_secret`/`access_token`/`Your_user_ID`；**不外洩、不進瀏覽器**）。Webhook：`https://stk.k84.org/api/line/webhook`（Next proxy **原封轉發 raw body + `X-Line-Signature`** → backend 驗簽）。**來源註冊制**：程式碼註冊表 `src/line_sources.py`（`strategy`/`workstation2`/`workstation3`/`other`，新增來源＝加一筆）；各來源的**發送開關設於各功能本身**（`line_sources` 集合、`PUT /api/line/sources/{key}`）；**收件管理只做授權**（收件者 `line_recipients` 存 `note`/`category`/`subscriptions` 權限矩陣，by row）。對話記錄存 `line_messages`。後端 `src/line_notify.py` + `src/routers/line.py`；觸發點 `routers/strategy.py:screen_post`。前端頁 `/settings/recipients`（sidebar 下方「功能表」→ 收件管理）。規格：`.docs/line-notifications.md`。
