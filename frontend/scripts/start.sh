#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$FRONTEND_DIR/src-tauri"
APP_PATH="$TAURI_DIR/target/release/bundle/macos/aiStock.app"

echo "Stopping any running aiStock processes..."
pkill -f "aiStock.app" 2>/dev/null || true
pkill -f "uvicorn.*8000" 2>/dev/null || true
pkill -f "next start.*5000" 2>/dev/null || true
pkill -f "node.*next" 2>/dev/null || true
sleep 1

lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :5000 | xargs kill -9 2>/dev/null || true

echo "Starting aiStock..."
open "$APP_PATH"
echo "aiStock launched."