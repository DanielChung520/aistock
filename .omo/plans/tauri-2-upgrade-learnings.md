# Tauri 1.x → 2.x 升級 + CI/CD 部署踩坑記錄

> 從一個 Taiwan stock 平台專案 (aiStock) 升級 Tauri 到 2.x 並建立 GitHub Actions CI/CD 的完整踩坑清單，供其他 Tauri 專案參考。

---

## TL;DR

Tauri 1.x → 2.x 升級涉及 **Schema / Plugin / Rust API / Icons / Cargo.lock** 五大改動，CI 上每改一個地方都會再撞下一個。預估整個遷移 + CI 建置需要 **1-2 天**處理。

---

## 完整問題清單（依發生順序）

### 🔴 Phase 1: 結構性 Schema 改動

#### 問題 1: `tauri.conf.json` 結構翻轉
**錯誤訊息**：
```
Error "tauri.conf.json" error: "identifier" is a required property
Error "tauri.conf.json" error: Additional properties are not allowed ('package', 'tauri' were unexpected)
```

**原因**：Tauri 2.x 改為 **flat structure**，原本在 `tauri.package`、`tauri.bundle`、`tauri.windows` 下的設定全部移到頂層。

**修法**：
```diff
- {
-   "tauri": {
-     "package": { "productName": "x", "version": "0.1.0" },
-     "bundle": { "active": true, "identifier": "com.x", ... },
-     "windows": [...],
-     "updater": {...}
-   }
- }
+ {
+   "productName": "x",
+   "version": "0.1.0",
+   "identifier": "com.x",
+   "app": { "windows": [...], "security": {...} },
+   "bundle": { "active": true, ... },
+   "updater": {...}
+ }
```

**注意**：`identifier` 原本在 `bundle.identifier`，現在移到頂層必填。

---

#### 問題 2: `dangerousRemoteDomainIpcAccess` 已移除
**錯誤訊息**：
```
Error "tauri.conf.json" error on `app > security`: Additional properties are not allowed ('dangerousRemoteDomainIpcAccess' was unexpected)
```

**原因**：Tauri 1 用 `dangerousRemoteDomainIpcAccess` 允許 dev 模式存取 `localhost`，Tauri 2 改用其他機制（capabilities + 環境變數）。

**修法**：直接刪除 `app.security.dangerousRemoteDomainIpcAccess` 整個 block。

---

#### 問題 3: 頂層 `updater` 區塊不允許
**錯誤訊息**：
```
Error "tauri.conf.json" error: Additional properties are not allowed ('updater' was unexpected)
```

**原因**：Tauri 2 的 updater 配置移到 `plugins.updater` 或由 Rust 端控制，不在頂層。

**修法**：刪除頂層 `updater` block，endpoints 和 pubkey 透過 **Cargo.toml 的 `tauri-plugin-updater` + capabilities** 配置。

---

### 🔴 Phase 2: Cargo / Rust 改動

#### 問題 4: `Cargo.lock` 還停在 v1
**錯誤訊息**：
```
tauri (v1.8.3) : @tauri-apps/api (v2.11.1)
Error Found version mismatched Tauri packages.
```

**原因**：Cargo.lock 不會自動更新，需要手動 `rm Cargo.lock && cargo generate-lockfile` 重新解析依賴。

**修法**：
```bash
cd frontend/src-tauri
rm Cargo.lock
cargo generate-lockfile
```

**教訓**：版本升級後**第一件事**就是重新生成 lock 檔。

---

#### 問題 5: 缺 `icon.ico` 等平台 icons
**錯誤訊息**：
```
`icons/icon.ico` not found; required for generating a Windows Resource file during tauri-build
```

**原因**：Tauri 2 各平台需要專屬 icon（Windows 要 .ico、macOS 要 .icns、Linux 要 .png）。

**修法**：
```bash
# 1. 準備一張 1024x1024 來源 PNG（或用 sips/ImageMagick 生成）
# 2. 用 Tauri CLI 自動產生所有平台 icons
cd frontend
pnpm exec tauri icon src-tauri/icons/icon-source.png
# 會自動產生：
#   - icon.ico (Windows)
#   - icon.icns (macOS)
#   - icon.png + 32x32/64x64/128x128/128x128@2x.png
#   - Square*.png (Windows Store)
#   - android/ 與 ios/ 子目錄
```

**3. 更新 `tauri.conf.json`**：
```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

**教訓**：起新 Tauri 專案時**第一件事**是產生 icons，否則 build 永遠失敗。

---

#### 問題 6: `reqwest` 沒在 Cargo.toml
**錯誤訊息**：
```
error[E0433]: cannot find module or crate `reqwest` in this scope
```

**原因**：`lib.rs` 使用 `reqwest::blocking::get()` 但 Cargo.toml 沒列。

**修法**：直接移除 `wait_for_url` 函式（Tauri 啟動後 webview 載入本地 URL 本來就需要時間，額外等待沒意義）。

---

#### 問題 7: `tauri::Manager` trait 沒 import
**錯誤訊息**：
```
no method named `get_window` found for mutable reference `&mut tauri::App`
```

**原因**：`get_window` / `get_webview_window` 是 `tauri::Manager` trait 的方法，必須在 scope。

**修法**：
```rust
use tauri::Manager;  // ← 必須
// Tauri 2 還把 get_window 改為 get_webview_window
if let Some(window) = app.get_webview_window("main") { ... }
```

**教訓**：Tauri 的 App 相關方法幾乎都在 `Manager` trait，要使用必須 import。

---

### 🟡 Phase 3: GitHub Actions 設定

#### 問題 8: OAuth 沒有 `workflow` scope
**錯誤訊息**：
```
refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope
```

**原因**：`gh` CLI 預設 scope 不包含 `workflow`，無法 push workflow 檔案。

**修法**：
```bash
gh auth refresh -h github.com -s workflow
# 會開瀏覽器授權 workflow scope
# 授權完成後就能 push workflow files
```

**替代方案**：用 Personal Access Token（PAT）建立時勾選 `workflow` scope。

---

#### 問題 9: 矩陣 job 預設 `windows-latest` 失敗
**症狀**：Ubuntu / macOS 跑 4-6 分鐘成功，Windows 跑 9 分鐘失敗。

**可能原因**：
- Windows runner 較慢
- Windows 編譯記憶體/磁碟空間問題
- WebView2 runtime 缺失

**建議**：把 Windows 的矩陣先暫時註解掉，先讓其他平台 build 成功驗證流程。

---

### 🟢 Phase 4: 完整工作流

```bash
# 1. 升級 Cargo.toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-updater = "2"
tauri-plugin-process = "2"

[build-dependencies]
tauri-build = { version = "2", features = [] }

# 2. 升級 frontend package.json
"@tauri-apps/api": "^2.0.0",
"@tauri-apps/plugin-updater": "^2.0.0",
"@tauri-apps/plugin-process": "^2.0.0",
"@tauri-apps/cli": "^2.0.0"

# 3. 重新生成 lock 檔
cd frontend/src-tauri
rm Cargo.lock
cargo generate-lockfile

# 4. 產生 icons
cd ../..
pnpm exec tauri icon path/to/source.png

# 5. 重寫 lib.rs 結構（Tauri 2 用 lib + main pattern）

# 6. 重寫 tauri.conf.json（flat structure）

# 7. 設定 capabilities/default.json
{
  "permissions": ["core:default", "updater:default", "process:default"]
}

# 8. 產生 updater 簽章
pnpm exec tauri signer generate -w ~/.tauri/aistock.key.json --ci

# 9. 提交 + push + 設 GitHub Secrets

# 10. 創第一個 release tag
git tag v0.2.0
git push origin v0.2.0
```

---

## CI/CD 完整鏈設計

```
PR 推送 → ci.yml 跑：
  ├─ Backend (FastAPI) compile check
  ├─ Frontend (Next.js) lint + typecheck
  └─ Tauri 跨平台 build (mac/ubuntu/windows)

main 推送 → 同上

tag v* 推送 → release.yml 跑：
  ├─ 4 平台 build + sign
  ├─ 產生 latest.json
  └─ 自動建立 GitHub Release draft
```

桌面版啟動時：
1. 開啟 app
2. 5 秒後自動檢查 `https://github.com/.../releases/latest/download/latest.json`
3. 若有新版本 → 顯示更新對話框
4. 使用者確認 → 下載、安裝、重啟

---

## 給其他專案的 Checklist

升級 Tauri 1.x → 2.x 時，**按順序**確認：

- [ ] 1. `Cargo.toml`：tauri 改 `"2"`，加 `tauri-plugin-updater`、`tauri-plugin-process`
- [ ] 2. `package.json`：@tauri-apps/* 全部改 `^2.0.0`
- [ ] 3. **刪除 `Cargo.lock`** 重新生成（避免版本衝突）
- [ ] 4. 重寫 `tauri.conf.json` 為 flat structure（`productName`/`version`/`identifier` 移到頂層）
- [ ] 5. 刪除 `app.security.dangerousRemoteDomainIpcAccess`
- [ ] 6. 刪除頂層 `updater` 區塊
- [ ] 7. **先產生 icons**（用 `pnpm tauri icon` 從 1024x1024 來源）
- [ ] 8. 在 `tauri.conf.json` 的 `bundle.icon` 列出所有 icon 檔案
- [ ] 9. 重寫 `lib.rs`：`get_window` → `get_webview_window`、`use tauri::Manager`
- [ ] 10. 移除 `reqwest::blocking::get` 等未列 dep 的程式碼
- [ ] 11. 建立 `capabilities/default.json`
- [ ] 12. 執行 `cargo tauri signer generate` 產生簽章金鑰
- [ ] 13. 設定 GitHub Secrets：`TAURI_SIGNING_PRIVATE_KEY`
- [ ] 14. `gh auth refresh -h github.com -s workflow` 啟用 workflow scope
- [ ] 15. Push 後等 CI 跑，第一次幾乎一定會失敗，逐個修

---

## 預估時間

| 階段 | 時間 |
|---|---|
| 升級 Cargo.toml + package.json | 30 分鐘 |
| 重寫 tauri.conf.json | 1 小時（schema 反覆嘗試） |
| 產生 icons | 10 分鐘 |
| 重寫 lib.rs（Tauri 2 API） | 1 小時 |
| 設定 CI workflow | 30 分鐘 |
| CI 排錯（4 平台 × 多次失敗） | 3-4 小時 |
| 設定 updater + 簽章 | 30 分鐘 |
| **總計** | **~1-2 天** |

---

## 推薦工具

- **本地驗證**：`cargo check --offline`（不下載依賴，只檢查語法）
- **線上驗證**：GitHub Actions 的 log（含完整錯誤訊息）
- **快速查 Tauri 文件**：https://v2.tauri.app/
- **Migration guide**：https://v2.tauri.app/start/migrate/from-tauri-1/

---

## 給自己的一句話

> **Tauri 2 升級的本質是「重新學一次 Tauri」**，不要假設 1.x 的設定可以直接改版本號就升級。先讀 migration guide，再從零開始配置。
