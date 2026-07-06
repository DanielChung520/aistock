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
│   │   │       └── menu/             # Menu CRUD (Phase 1, direct ArangoDB)
│   │   ├── components/
│   │   │   ├── stocks/          # Stock UI components (7 files)
│   │   │   ├── sidebar-nav.tsx  # Dynamic sidebar (Phase 1)
│   │   │   ├── header.tsx       # Header with settings dropdown
│   │   │   ├── ui/             # 53 shadcn/ui components
│   │   │   └── dashboard/      # Dashboard components
│   │   ├── lib/
│   │   │   ├── arangodb.ts     # ArangoDB connection singleton
│   │   │   └── utils.ts        # Utility functions (cn, etc.)
│   │   ├── hooks/
│   │   │   └── use-indicator-settings.ts  # Indicator settings hook (localStorage)
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
│   │   ├── rate_limiter.py     # TWSE rate limiter (3 req/5 sec)
│   │   └── routers/
│   │       ├── stocks.py       # /search, /history, /indicators, /analysis
│   │       ├── watchlist.py    # GET/POST/DELETE /watchlist
│   │       └── market.py       # /taiex endpoint
│   ├── scripts/
│   │   ├── seed_stock_codes.py # Seed 1845 stocks from twstock.codes
│   │   └── daily_update.py     # Daily batch update (Wave 4 pending)
│   ├── .env                    # Backend config
│   ├── .venv/                  # Python virtual environment
│   ├── pyproject.toml          # Python project metadata
│   └── requirements.txt        # pip dependencies
├── .sisyphus/                  # Work plans & drafts
└── AGENTS.md                   # This file
```

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

## Git Conventions

- Branch names: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Commit messages follow **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Never commit secrets, `.env.local`, or generated build artifacts.
- Run `npm run typecheck && npm run lint && npm test` before opening a PR.

---

## ArangoDB Guidelines

- ArangoDB runs via Docker Compose on **port 8530** (db=`aistock`, user=`root`, pwd=`aistock2024`).
- Frontend uses **arangojs** (singleton in `src/lib/arangodb.ts`) for direct reads (menu collections).
- Backend uses **python-arango** (singleton in `src/db.py`) for stock data reads/writes.
- Collections: `stock_codes` (1845 docs), `stock_daily`, `watchlist` (cap 50), `menu_items`, `menu_groups`.
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
- **G4**: ALL UI text in 繁體中文. `lang="zh-TW"`.
- **G5**: 台股紅漲綠跌 (red = up, green = down — opposite of US convention).
- **G6**: Indicators: MA (configurable periods, SMA/EMA), KDJ (configurable), RSI (configurable), MACD (configurable), Bollinger Bands (configurable). No other indicators.
- **G7**: TWSE rate limit: 3 requests per 5 seconds (enforced by `rate_limiter.py`).
- **G8**: Phase 1 routes (/admin/menu, /api/menu) remain untouched.
- **G9**: All indicator calculations MUST happen in the backend. Frontend NEVER computes from raw OHLCV.
- **G10**: Indicator settings stored in localStorage key `aistock-indicator-settings` with versioned schema.
- **G11**: Use lightweight-charts v5 native pane API (`addSeries(type, opts, paneIndex)`). Do NOT create multiple chart instances.
- **G12**: Minute-data indicators use same calculation functions as daily.
