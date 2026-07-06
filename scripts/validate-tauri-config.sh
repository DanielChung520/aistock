#!/usr/bin/env bash
# validate-tauri-config.sh — 在 build 前檢查 tauri.conf.json 是否有常見陷阱
# 在 CI 或本地 build 前執行：bash scripts/validate-tauri-config.sh
set -euo pipefail

CONFIG="frontend/src-tauri/tauri.conf.json"
LIBRS="frontend/src-tauri/src/lib.rs"

echo "=== Tauri Config Pre-flight Check ==="

# 1. 檢查 JSON 語法
if ! python3 -c "import json; json.load(open('$CONFIG'))" 2>/dev/null; then
  echo "❌ $CONFIG: JSON 語法錯誤"
  exit 1
fi
echo "✅ JSON 語法正確"

# 2. 檢查 version 與 Cargo.toml 一致
TAURI_VER=$(python3 -c "import json; print(json.load(open('$CONFIG'))['version'])")
CARGO_VER=$(grep '^version =' frontend/src-tauri/Cargo.toml | head -1 | sed 's/version = "\(.*\)"/\1/')
if [ "$TAURI_VER" != "$CARGO_VER" ]; then
  echo "❌ 版本不一致: tauri.conf.json=$TAURI_VER, Cargo.toml=$CARGO_VER"
  exit 1
fi
echo "✅ 版本一致 ($TAURI_VER)"

# 3. 檢查 plugins 設定與 lib.rs 是否匹配
HAS_UPDATER_PLUGIN=$(grep -c "tauri_plugin_updater" "$LIBRS" || true)
HAS_UPDATER_CONFIG=$(python3 -c "
import json
c = json.load(open('$CONFIG'))
p = c.get('plugins', {})
print('yes' if 'updater' in p else 'no')
")

if [ "$HAS_UPDATER_PLUGIN" -gt 0 ] && [ "$HAS_UPDATER_CONFIG" = "no" ]; then
  echo "❌ lib.rs 註冊了 updater plugin 但 tauri.conf.json 缺少 plugins.updater 設定"
  exit 1
fi
echo "✅ plugins 設定與 lib.rs 一致"

# 4. 檢查 frontendDist 目錄是否存在
if [ ! -d "frontend/.next" ]; then
  echo "⚠️  frontend/.next 不存在（若在 dev 模式可忽略）"
else
  echo "✅ frontend/.next 存在"
fi

echo ""
echo "=== All checks passed ==="
