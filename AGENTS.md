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
  - **例外1（2026-10）**：首頁「加權指數 10 分K」圖表可在**台股交易時段（週一–五 09:00–13:35 台北時間）且分頁可見時**自動刷新（間隔 60 秒，僅重抓該指數圖表，display-only、不下單）。實作：`frontend/src/app/page.tsx`、`frontend/src/lib/market-hours.ts`；規格：`.docs/dashboard-taiex-10m.md`。
  - **例外2（2026-10-27 決策，工作站待實作）**：**工作站（階段1/2）允許盤中輪詢**（決策「全面放寬」）。運作限制：僅交易時段（沿用 `market-hours`）、範圍僅限工作站清單（觀察／持倉）、頻率有界。除此之外的股票/選股資料仍維持盤後批次。規格：`.docs/requirement-workstation.md`。
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
