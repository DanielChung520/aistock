# aistock 部署與更新機制建置計畫

## TL;DR
> 建立 GitHub repo → 初始化 git → 升級 Tauri 1.x → 2.x → 加 updater → 寫 CI workflow → 實作前端「檢查更新」menu

---

## Phase 1: GitHub Repo 與 CI

### 1.1 建立 GitHub repo
使用 `gh` CLI（已登入為 DanielChung520）：
```bash
cd /home/daniel/github/aistock
gh repo create aistock --public --source=. --remote=origin --description="aiStock - 台股分析平台"
```

### 1.2 初始化 git
```bash
git init
git add .gitignore  # 若不存在則建立
git add .
git commit -m "chore: initial commit"
git branch -M main
git push -u origin main
```

### 1.3 .gitignore（需建立）
涵蓋：Python、Node、Tauri、IDE、.env 等

### 1.4 CI Workflow：`.github/workflows/ci.yml`
- 矩陣：ubuntu + macos + windows
- 觸發：push to main, pull_request
- 步驟：setup Node、setup Python、setup Rust、install deps、lint、type-check、build
- 上傳 artifacts

### 1.5 Release Workflow：`.github/workflows/release.yml`
- 觸發：push tag v*
- 跨平台打包（dmg, msi, AppImage）
- 產出 latest.json（Tauri updater 用）
- 建立 GitHub Release 上傳 artifacts

---

## Phase 2: Tauri 1.x → 2.x 升級

### 2.1 更新 Cargo.toml
```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
log = "0.4"
env_logger = "0.11"
```

### 2.2 更新 src-tauri/Cargo.toml build deps
```toml
[build-dependencies]
tauri-build = { version = "2", features = [] }
```

### 2.3 新增 src-tauri/src/lib.rs (Tauri 2 結構改變)
- `tauri::Builder` → `tauri::Builder::default()`
- 命令註冊改用 `tauri::generate_handler!`

### 2.4 更新 tauri.conf.json
- 加入 updater 設定
- 加入 plugins.updater 區塊

### 2.5 升級前端 @tauri-apps/api
```json
"@tauri-apps/api": "^2.0.0",
"@tauri-apps/plugin-updater": "^2.0.0"
```

---

## Phase 3: Frontend「檢查更新」UI

### 3.1 Header 設定 menu 加項目
- 「檢查更新」item，呼叫 Tauri updater API
- 顯示檢查中 / 已是最新 / 有新版本
- Modal 顯示更新內容 + 下載進度

### 3.2 新元件
- `src/components/update-notifier.tsx` — 全域更新提示 toast
- `src/components/update-modal.tsx` — 更新確認對話框

### 3.3 API
- `src/lib/updater.ts` — 包裝 Tauri updater API
- 啟動時背景檢查最新版本
- Header 設定 menu 手動觸發

---

## Phase 4: 驗證

- [ ] GitHub repo 建立成功
- [ ] CI workflow 第一次跑成功
- [ ] Tauri 2.x 編譯通過
- [ ] 本地 `pnpm tauri dev` 正常啟動
- [ ] Header 設定 menu 有「檢查更新」
- [ ] 點擊檢查更新能看到版本資訊

---

## Rollback Plan
若 Tauri 2.x 升級遇到無法解決的問題，可暫時保持 1.x：
- 跳過 Phase 2
- 只做 Phase 1 + Phase 3（前端用 fetch 實作檢查更新）
- 改成純前端 release 通知