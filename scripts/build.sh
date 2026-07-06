#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Building aiStock ==="

# ── Frontend ──
echo "[Frontend] Installing dependencies..."
cd "$ROOT/frontend"
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "[Frontend] Building..."
npx next build

echo ""
echo "Build completed successfully!"
echo "Run Tauri app:    bash scripts/start.sh"
echo "Run dev mode:     bash scripts/dev.sh"
