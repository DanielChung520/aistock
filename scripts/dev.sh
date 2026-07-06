#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Starting aiStack Dev Environment ==="

# ── Backend (FastAPI) ──
echo "[Backend] Starting FastAPI on port 38000..."
cd "$ROOT/backend"
source .venv/bin/activate
python -m uvicorn src.main:app --host 0.0.0.0 --port 38000 --reload &
BACKEND_PID=$!
echo "[Backend] PID: $BACKEND_PID"

sleep 2

# ── Frontend (Next.js dev) ──
echo "[Frontend] Starting Next.js dev server on port 33300..."
cd "$ROOT/frontend"
npx next dev --webpack --port 33300

# ── Cleanup on exit ──
echo "Shutting down..."
kill $BACKEND_PID 2>/dev/null || true
