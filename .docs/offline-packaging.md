# 離線自足版打包 Spec（Offline Self-Contained Windows Installer）

> 狀態：**待實作確認**。決策已定（使用者確認）：打包 `arangod`、排除 `torch`、先出 spec 再動工。
> 對應需求：(a) 線上版指向 `https://stk.k84.org` 已完成；(c) 本文件。

## 1. 目標

Windows 安裝檔內建全部元件，安裝後**不需依賴 `https://stk.k84.org` 遠端站台**即可啟動（仍需網路抓取股票資料：yfinance / TWSE）。webview 載入本機 `http://127.0.0.1:33300`。

## 2. 已定案決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| ArangoDB | **打包 `arangod`** | 完全自足、後端代碼零修改；代價安裝檔 +~200MB |
| torch | **排除** | TX-RL 訓練是伺服器排程工作；排除後 PyInstaller 產物從數 GB 降到 ~500MB |
| 執行方式 | **先出本 spec** | 數天量級 + 只能 Windows CI 反覆測，方向先確認 |

## 3. 架構

```
aistock-setup.exe (Tauri Rust shell)
├── 內建 4 元件
│   1. arangod.exe                    → 127.0.0.1:8530（資料目錄 %APPDATA%/EEA/arangodb）
│   2. aistock-backend.exe            → 127.0.0.1:38000（PyInstaller onedir，排除 torch）
│   3. node.exe + next-standalone     → 127.0.0.1:33300（BACKEND_URL=http://127.0.0.1:38000）
│   4. Rust shell（webview → http://127.0.0.1:33300）
├── 啟動順序：arangod → backend(/health OK) → next(HTTP 200) → 開視窗
└── 關閉：依序 terminate 三子程序，確認無殘留 process
```

## 4. 調查結論（已驗證）

- **前端 100% 走 Next.js proxy**：`frontend/src/app/api/*/route.ts` 內 `BACKEND_URL || 'http://localhost:38000'`，瀏覽器從不直連後端。
  → 無法 static export，必須打包 **Next.js standalone server**。
- **torch 全為函式內 lazy import**（`ml_training.py` / `model_artifacts.py` / `tasks/ai_training.py` / `routers/ai_training.py` 內縮排 `import torch`），`main.py` 啟動鏈不觸發 → PyInstaller 預設不會帶入；再加 `--exclude-module torch` 保險。
- **`/health` endpoint 已存在**（`backend/src/main.py:117`），backend 就緒檢查免新增。
- **Arango 連線可 env 覆寫**：`config.py` 的 `ARANGO_URL`（`http://localhost:8530`）、`ARANGO_DB=aistock`、`ARANGO_USER=root`、`ARANGO_PASSWORD=aistock2024` 為 pydantic-settings 欄位。

## 5. Phase 1 — Backend sidecar（PyInstaller）

- 建置 spec：`backend/pyinstaller-offline.spec`（**onedir**，啟動快、可 debug）
  - `hiddenimports`：`celery`、`duckdb`、`xgboost`、`lightgbm`、`sklearn`、`yfinance`、`twstock`、`python_arango`
  - `excludes`：`torch`、`torchvision`、`torchaudio`
  - 產物 `dist/aistock-backend/`（exe + `_internal/`）→ 放入 `frontend/src-tauri/binaries/`
- 啟動：`aistock-backend.exe --host 127.0.0.1 --port 38000`
- 健康檢查：`GET http://127.0.0.1:38000/health`
- Arango：離線 `arangod` 用 `--server.authentication false`（僅綁 127.0.0.1），backend 的 root/aistock2024 照舊可連。

## 6. Phase 2 — Next.js standalone + Node runtime

- `frontend/next.config.ts` 加 `output: 'standalone'`（不影響既有部署，standalone 為加值產出）
- build 後組裝：
  ```
  cp -r .next/static            .next/standalone/.next/static
  cp -r public                  .next/standalone/public
  ```
- 打包 `node.exe`（win-x64 LTS 20/22 zip）→ `frontend/src-tauri/resources/node/`
- 啟動：`node.exe server.js`，env：`HOSTNAME=127.0.0.1 PORT=33300 BACKEND_URL=http://127.0.0.1:38000`
- 驗證：`curl http://127.0.0.1:33300` 回 200

## 7. Phase 3 — ArangoDB

- 下載 Windows community **zip（免安裝）** → `frontend/src-tauri/resources/arangodb/`
- 啟動（僅綁 127.0.0.1）：
  ```
  arangod --server.endpoint tcp://127.0.0.1:8530 \
          --database.directory <appdata>/arangodb \
          --server.authentication false \
          --javascript.startup-directory <bundle>/resources/arangodb/js \
          --javascript.app-path <appdata>/arangodb-apps
  ```
- 首次啟動：backend 的 `ensure_database()` / `ensure_collection()` 自動建 `aistock` DB 與 collections（實作時驗證 `db.py` 啟動路徑）。

## 8. Phase 4 — Tauri 整合

- **線上/離線 config 分離**，不動線上版：
  - 線上版維持 `tauri.conf.json`（remote URL）
  - 離線版新增 `tauri.offline.conf.json`，由 CI 以 `--config tauri.offline.conf.json` 合併（改 `window.url` → `http://127.0.0.1:33300` + `bundle.resources` 指定 sidecar/runtime）
- `src-tauri/src/lib.rs` `setup()`：
  - spawn `arangod` / `aistock-backend` / `node server.js`（sidecar 或 `std::process::Command`）
  - 健康檢查迴圈（各帶 timeout；失敗顯示錯誤視窗）
  - 離線版才 spawn；線上版維持現況
- 關閉：terminate 子程序（防殘留）

## 9. Phase 5 — CI

新增 `.github/workflows/build-offline.yml`（**windows-latest only**）：
1. `actions/setup-python` → `pip install -r requirements.txt` → `pyinstaller pyinstaller-offline.spec`
2. `actions/setup-node` + `pnpm` → `pnpm build`（standalone）
3. 下載 arangod zip + node zip → 組裝 `resources/`
4. `pnpm tauri build --bundles nsis,msi --config ../src-tauri/tauri.offline.conf.json`
5. 上傳 artifact
6. smoke test：啟動三程序 + `/health` + `:33300` 200

## 10. 風險與對策

| 風險 | 對策 |
|---|---|
| PyInstaller 對 duckdb/xgboost/lightgbm/celery 的 hidden import 漏包 | CI 上 smoke test 啟動 backend + `/health`，iterative 補 `hiddenimports` |
| arangod 首啟資料目錄/DB 初始化 | Phase 3 實作時在 CI 驗證 `ensure_database()` |
| Node runtime 授權/大小 | MIT 授權 OK；~40MB 可接受 |
| 安裝檔總大小 ~800MB | backend(無 torch ~500MB) + arangod(~200MB) + node(~40MB) + standalone(~50MB)；後續可 onedir 壓縮或精簡依賴 |
| 本機是 Ubuntu，只能 Windows CI 反覆測 | 每輪迭代慢；Phase 拆小、先在 CI 綠再繼續 |
| 離線模式 `--server.authentication false` | 僅綁 127.0.0.1，可接受 |

## 11. 驗收標準

- 安裝到乾淨 Win11：三程序自動啟動、首頁可載、K 線/指標/法人/新聞可用
- 關閉 app 後無殘留 process（工作管理員確認）
- 阻斷 `stk.k84.org` 仍可啟動使用（資料抓取需網路）
- 線上版（remote URL）不受影響

## 12. 里程碑（建議順序）

1. **M1**：Phase 1 backend sidecar（CI 產出 + `/health` smoke）— 獨立可驗證
2. **M2**：Phase 2 Next standalone + node（CI 產出 + 本機/CI 起 server）
3. **M3**：Phase 3 arangod 打包 + 首啟建 DB
4. **M4**：Phase 4 Tauri 三程序編排 + 離線 config
5. **M5**：Phase 5 完整 CI + 端到端驗收
