# aiStock — 台股分析平台

Taiwan stock analysis platform with K-line charts, technical indicators, and institutional investor data.

- **Frontend**: Next.js 16 (App Router) + shadcn/ui + Tailwind CSS v4
- **Desktop**: Tauri v1 (macOS)
- **Backend**: FastAPI (Python) + ArangoDB + DuckDB
- **Data Pipeline**: Airflow

---

## 快速開始

### 前置需求

```bash
# 1. ArangoDB (Docker)
docker compose up -d

# 2. Python 虛擬環境
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 3. Node.js 依賴
cd frontend && pnpm install

# 4. 建立前端 production build (Tauri 模式需要)
cd frontend && pnpm build
```

### 開發模式

```bash
# 一次啟動 Backend (FastAPI) + Frontend (Next.js dev server)
bash scripts/dev.sh

# 個別啟動也可以：
#   終端 1: cd backend && source .venv/bin/activate && python -m uvicorn src.main:app --reload --port 38000
#   終端 2: cd frontend && pnpm dev
```

- Frontend → http://localhost:33300
- Backend  → http://localhost:38000

### Tauri 桌面模式

```bash
# 打包好的桌面應用（自動啟動 Backend + Frontend）
bash scripts/start.sh
```

Tauri 應用會自動：
1. 啟動 FastAPI backend (`localhost:38000`)
2. 啟動 Next.js production server (`localhost:33300`)
3. 開啟桌面視窗

### 停止

```bash
bash scripts/stop.sh
```

---

## 專案結構

```
aiStock/
├── scripts/                  # 專案層級啟動/停止腳本
├── docker-compose.yml        # ArangoDB 基礎設施
├── frontend/                 # Next.js + Tauri
│   ├── src/                  # 頁面、元件、API proxy
│   ├── src-tauri/            # Tauri 桌面包裝 (Rust)
│   └── scripts/              # 前端專用腳本 (資料庫 seed 等)
├── backend/                  # FastAPI 微服務
│   ├── src/                  # API、資料庫、指標計算
│   └── scripts/              # 資料播種腳本
├── airflow/                  # Airflow 資料管線
└── AGENTS.md                 # 開發規範 (給 AI agent)
```

## Port 一覽

| 服務 | Port | 說明 |
|---|---|---|
| Next.js (dev) | 33300 | Hot reload |
| Next.js (production) | 33300 | Tauri 模式 |
| FastAPI Backend | 38000 | REST API |
| ArangoDB | 8530 | 文件資料庫 |

---

## 技術棧

- **Frontend**: Next.js 16, shadcn/ui, Tailwind CSS v4, TypeScript
- **Desktop**: Tauri v1 (Rust)
- **Backend**: FastAPI, Python 3.14, ArangoDB, DuckDB
- **Data**: ArangoDB (文檔), DuckDB (時序), FinMind API (法人資料)

## 開發規範

詳細規範請見 [AGENTS.md](AGENTS.md)，包含：
- TypeScript / Python 程式碼風格
- Git 提交規範 (Conventional Commits)
- 架構設計原則與守則
