#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="$ROOT/frontend/src-tauri/target/release/bundle/macos/aiStock.app"

echo "Stopping any running aiStock processes..."
pkill -f "aiStock.app" 2>/dev/null || true
pkill -f "uvicorn.*38000" 2>/dev/null || true
pkill -f "next" 2>/dev/null || true
sleep 1
lsof -ti :38000 | xargs kill -9 2>/dev/null || true
lsof -ti :33300 | xargs kill -9 2>/dev/null || true

echo "Starting aiStock (Tauri)..."
open "$APP_PATH"
echo "aiStock launched."
