#!/bin/bash
set -e

echo "Stopping aiStock processes..."

# Tauri app
pkill -f "aiStock.app" 2>/dev/null || true
pkill -f "aiStock" 2>/dev/null || true

# Backend
pkill -f "uvicorn.*38000" 2>/dev/null || true
lsof -ti :38000 | xargs kill -9 2>/dev/null || true

# Frontend
pkill -f "next" 2>/dev/null || true
lsof -ti :33300 | xargs kill -9 2>/dev/null || true

sleep 1
echo "All aiStock processes stopped."
