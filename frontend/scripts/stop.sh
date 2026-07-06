#!/bin/bash
set -e

echo "Stopping aiStock processes..."
pkill -f "aiStock.app" 2>/dev/null || true
pkill -f "uvicorn.*8000" 2>/dev/null || true
pkill -f "next" 2>/dev/null || true
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3300 | xargs kill -9 2>/dev/null || true
sleep 1
echo "All aiStock processes stopped."