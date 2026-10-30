#!/bin/bash
# Build Tauri desktop app with updater signing.
# 從 frontend/.env.local 載入根金鑰（TAURI_SIGNING_PRIVATE_KEY / _PASSWORD），
# 之後 tauri build 產出的 bundle 會自動簽章（配合 tauri.conf.json 的 createUpdaterArtifacts）。
set -Eeuo pipefail

cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
source .env.local
set +a

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "ERROR: TAURI_SIGNING_PRIVATE_KEY 未設定（請放在 frontend/.env.local）" >&2
  exit 1
fi

echo "載入簽章金鑰完成，開始 tauri build..."
pnpm exec tauri build "$@"
