#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Starting aiStack Dev Environment ==="

# ── Backend (FastAPI) ──
echo "[Backend] Starting FastAPI on port 38000..."
cd "$ROOT/backend"
source .venv/bin/activate
# --timeout-graceful-shutdown: long-lived SSE connections (market/stock/watchlist streams)
# otherwise block uvicorn's graceful shutdown, so `--reload` hangs after the first edit.
python -m uvicorn src.main:app --host 0.0.0.0 --port 38000 --reload --timeout-graceful-shutdown 5 &
BACKEND_PID=$!
echo "[Backend] PID: $BACKEND_PID"

sleep 2

# ── Celery worker (task queue for scheduled jobs) ──
# setsid: detach from this script's process group so a Ctrl-C / timeout that
# kills the group cannot take the worker down; nohup: survive terminal close.
# Log goes to /tmp/celery-worker.log for inspection.
echo "[Celery] Starting worker..."
cd "$ROOT/backend"
setsid nohup .venv/bin/celery -A src.celery_app worker --loglevel=info \
  > /tmp/celery-worker.log 2>&1 < /dev/null &
CELERY_PID=$!
echo "[Celery] PID: $CELERY_PID (log: /tmp/celery-worker.log)"

# ── Frontend (Next.js dev) ──
echo "[Frontend] Starting Next.js dev server on port 33300..."
cd "$ROOT/frontend"
npx next dev --webpack --port 33300

# ── Cleanup on exit ──
echo "Shutting down..."
kill $BACKEND_PID 2>/dev/null || true
kill $CELERY_PID 2>/dev/null || true
