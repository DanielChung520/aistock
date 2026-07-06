# aistock Release & Auto-Update 狀態文件

> 記錄每次 release 與 auto-update 相關的狀態、限制、待辦

最後更新：2026-07-06 v0.2.0

---

## v0.2.0 狀態（2026-07-06）

| 項目 | 狀態 |
|---|---|
| GitHub Release | ✅ Published |
| macOS Intel `.dmg` | ✅ 9MB |
| macOS Apple Silicon `.dmg` | ✅ 8MB |
| Windows `.exe` | ✅ 7MB |
| Windows `.msi` | ✅ 8MB |
| Linux `.deb` | ✅ 9MB |
| Linux `.AppImage` | ✅ 80MB |
| `latest.json` | ⚠️ 0 bytes（空殼）|
| `*.sig` 簽章檔 | ❌ 未上傳 |
| 桌面版自動下載更新 | ❌ **會失敗**（缺 latest.json）|
| 桌面版手動下載/安裝 | ✅ 可用 |
| 桌面版 Header「檢查版本更新」→ GitHub API | ✅ 正常（用 v0.2.0 會顯示「已是最新」）|

**可下載**：https://github.com/DanielChung520/aistock/releases/tag/v0.2.0

---

## latest.json 為什麼失敗

Tauri 2.x + GitHub Actions 矩陣 build 的已知問題：

1. `tauri-action@v0` 的 `includeUpdaterJson: true` 只在**單一 build job** 有效
2. 矩陣 build（mac/win/linux 分開）時，每個 job 只看到自己平台的 `.sig`
3. 後處理 job 想下載所有 `.sig` 組合，但 `actions/upload-artifact@v4` 對 `**` glob pattern 支援不佳
4. 多次 debug 都卡在路徑問題

**結論**：要解需要重新設計 workflow 架構（單 job 跑全部平台，或自架 runner）。已超出當前範圍。

---

## 什麼能正常運作（已驗證）

### ✅ 桌面版 v0.2.0 安裝
- 下載 `.dmg`/`.exe`/`.deb`/`.AppImage`
- 雙擊安裝
- **完全可運行**（FastAPI + Next.js 自動 spawn）

### ✅ 桌面版「檢查版本更新」UI
- 點 Header 設定 → 檢查版本更新
- 會 fetch GitHub API
- 顯示 v0.2.0（已裝的就是最新版 → 「已是最新」）

### ✅ 瀏覽器 dev 模式測試
- http://localhost:33300
- 點選單的「檢查版本更新」
- 完整測試過 v0.1.0 → v0.2.0 偵測

---

## 什麼不能運作（已知限制）

### ❌ 桌面版自動下載 v0.3.0+
- 原因：缺 `latest.json` + `.sig` 簽章
- 影響：用戶需要手動下載新版本
- 暫時解法：在 app 內顯示「請到 GitHub 下載最新版本」連結

---

## 後續 roadmap

### 短期（1-2 小時）
- [ ] 在 app 內加「手動下載最新版本」按鈕（fallback）
- [ ] 當偵測到新版本時，UI 顯示 GitHub release URL 讓用戶手動下載

### 中期（需要重構 CI）
- [ ] 重新設計 release.yml：單一 build job 跑 4 平台（慢但簡單）
- [ ] 或：自架 GitHub Actions runner with all SDKs
- [ ] 或：放棄最新 JSON，用 Web fallback 機制

### 長期
- [ ] 等 Tauri 官方修好矩陣 + includeUpdaterJson 支援
- [ ] 或：升級到更穩定的更新方案（如 Electron autoUpdater）

---

## CI 改動歷史

| Commit | 說明 | 結果 |
|---|---|---|
| `fix(tauri): migrate tauri.conf.json to Tauri 2.x flat schema` | Schema 修正 | ✅ |
| `chore: bump version to 0.2.0` | 升版號 | ✅ |
| `ci: add TAURI_SIGNING_PRIVATE_KEY env to release workflow` | 加 signing | ✅ |
| `fix(tauri): regenerate Cargo.lock for tauri v2.11.5` | Cargo.lock | ✅ |
| `feat(tauri): add platform icons` | icons | ✅ |
| `fix(tauri): migrate lib.rs to Tauri 2 API` | 移除 reqwest + 用 WebviewWindow | ✅ |
| `fix(tauri): add tauri::Manager import` | Manager trait | ✅ |
| `fix(updater): use GitHub API instead of latest.json for CORS` | Web fallback | ✅ |
| `chore: remove .github/_disabled` | 清理 | ✅ |
| `chore(gitignore): exclude .env` | 保護 | ✅ |
| `chore: remove tauri build artifacts` | 清理 | ✅ |
| `ci(release): add generate-latest-json job` | 嘗試1（artifacts 路徑錯）| ❌ |
| `ci(release): rewrite workflow with proper generate-latest-json job` | 嘗試2 | ⚠️ partial |
| `ci(release): fix softprops action inputs + add sig discovery debug` | 嘗試3 | ⚠️ partial |
| `ci(release): fix sig upload path with target triple glob` | 嘗試4 | ⚠️ latest.json 0 bytes |

---

## 私鑰管理

| 位置 | 狀態 |
|---|---|
| `~/.tauri/aistock.key.json` | 私鑰（已 chmod 600）|
| `~/github/.env` | base64 備份 + 公鑰（已 chmod 600）|
| GitHub Secrets | `TAURI_SIGNING_PRIVATE_KEY`（已設 4 個 repo）|

⚠️ **若私鑰遺失**：未來所有版本無法升級，使用者卡在 v0.2.0

---

## 待手動測試的項目

1. **Intel Mac 安裝**（您）：
   ```bash
   gh release download v0.2.0 -p "aiStock_0.2.0_x64.dmg"
   open aiStock_0.2.0_x64.dmg
   ```
2. 從 GitHub 看 v0.2.0：https://github.com/DanielChung520/aistock/releases/tag/v0.2.0
3. 桌面版開啟後，Header 設定 → 檢查版本更新（應顯示「已是最新」）
4. 5 秒後會自動檢查（同樣結果）
