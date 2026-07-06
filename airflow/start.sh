#!/bin/bash
# Airflow Startup Script for macOS/Linux
# Usage: ./start-airflow.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Airflow..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Pull images first (in case they're not cached)
echo "📦 Pulling Docker images..."
docker compose pull

# Start services
echo "📦 Starting services..."
docker compose up -d

# Wait for webserver to be ready
echo "⏳ Waiting for Airflow webserver..."
sleep 30

# Check status
if curl -s http://localhost:8090/health > /dev/null 2>&1; then
    echo "✅ Airflow is ready!"
    echo "   Web UI: http://localhost:8090"
    echo "   Username: admin"
    echo "   Password: admin"
else
    echo "⚠️  Airflow is starting, check status with: docker compose logs -f"
fi
