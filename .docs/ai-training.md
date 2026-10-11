# AI 資料訓練 — 設計規格

> 目的：在已有「特徵值生成」（`stock_daily_features` 89 欄 × 59 檔）之上，提供監督式
> 學習的引導式訓練流程。涵蓋模型選擇、參數設定、資料準備、訓練、回測與模型評估。
>
> 與本專案其他規格的關係：
> - 特徵規格：`.docs/charact.md`（89 欄定義、缺值規則）
> - 回測引擎：`backend/src/backtest.py`（本次複用 run_backtest）
> - Celery job 模式：`backend/src/tasks/feature_generate.py`（訓練任務直接複用）

---

## 一、範圍（In / Out）

### In（本次 v1 交付）
- 引導式 6 步驟 wizard（前端）
- 三種預測目標：隔日漲跌、隔日價格、隔日報酬率
- 兩大類模型：機器學習（XGBoost、LightGBM、RandomForest）、類神經網路（MLP、LSTM）
- 時間序資料集分割（train/val/test）+ 標準化（依模型自動建議，可覆寫）
- 訓練動態過程（epoch/step 進度 + 損失曲線 + 取消）
- 模型評估（雙軌：ML 指標 + 回測績效）
- 訓練好的模型存入 ArangoDB（`model_artifacts` collection，附 metadata）
- Celery task 執行訓練 + 進度追蹤

### Out（本次不做，之後再議）
- 訓練後每日預測 → 看板串接
- 多模型集成（ensemble）
- 模型監控與漂移偵測（drift detection）
- AutoML（自動超參搜尋）
- GPU 訓練（先 CPU，能跑就好）

---

## 二、架構脈絡（與既有模組的關係）

```
┌──────────────┐   POST /api/ai-training/jobs     ┌─────────────────┐
│ 前端 wizard  │ ───────────────────────────────▶ │ FastAPI router  │
│ (6 步驟)     │   GET  /api/ai-training/jobs/{id}│  (routers/...)  │
└──────────────┘                                   └────────┬────────┘
                                                            │ enqueue
                                                            ▼
                                                   ┌─────────────────┐
                                                   │ Celery worker   │
                                                   │ (tasks/ai_train)│
                                                   └────────┬────────┘
                                                            │
                          ┌─────────────────────────────────┼─────────────────────────────────┐
                          ▼                                 ▼                                 ▼
                ┌──────────────────┐              ┌──────────────────┐              ┌──────────────────┐
                │ ArangoDB         │              │ ArangoDB         │              │ ArangoDB         │
                │ stock_daily_     │              │ ai_training_jobs │              │ model_artifacts  │
                │ features         │              │ (進度追蹤)       │              │ (模型權重+meta)  │
                │ (89 欄 × 28641)  │              └──────────────────┘              └──────────────────┘
                └──────────────────┘
                          ▲
                          │ 訓練後評估呼叫
                ┌──────────────────┐
                │ run_backtest     │
                │ (backtest.py)    │
                └──────────────────┘
```

### 複用資產
| 既有模組 | 用途 |
|---|---|
| `stock_daily_features`（89 欄，ArangoDB） | 訓練特徵源（X） |
| `run_backtest`（`backend/src/backtest.py`） | 訓練後回測評估 |
| Celery + `feature_jobs` 模式 | 訓練任務執行 + 進度追蹤（直接複用模式，獨立 collection） |
| `FeatureSettingsModal` 引導式 UI | wizard 各步驟的 UI 模式參考 |
| `research-universe-ai-memory-passive.json` | 訓練股票清單（預設 59 檔） |
| `AGENTS.md G13-G14` | LLM 設定（如訓練後要 LLM 總結，遵循系統設定） |

### 新增模組
| 模組 | 角色 |
|---|---|
| `backend/src/ai_training.py` | 訓練邏輯（資料準備、特徵切分、模型擬合、評估） |
| `backend/src/routers/ai_training.py` | API 端點（建立 job、查進度） |
| `backend/src/tasks/ai_training.py` | Celery 任務（`train_model_task`） |
| `frontend/src/app/ai-training/page.tsx` | wizard 主頁 |
| `frontend/src/components/ai-training/` | wizard 各步驟子元件 |
| ArangoDB collection：`ai_training_jobs`、`model_artifacts` | 進度追蹤 + 模型保存 |

---

## 三、預測目標（Y）

| 選項 | Y 定義 | 任務類型 | 評估指標（ML 軌） | 實務價值 |
|---|---|---|---|---|
| 隔日漲跌 | `1 if next_close > close else 0` | 二分類 | accuracy、AUC、F1 | ⭐⭐ |
| 隔日價格 | `next_close` | 回歸 | MAE、RMSE、R² | ⭐ |
| 隔日報酬率（**預設推薦**） | `(next_close - close) / close` | 回歸 | MAE、RMSE、R²、勝率（>0 樣本佔比） | ⭐⭐⭐ |

> **Y 計算位置**：特徵生成（`stock_daily_features`）目前不含 label。
> 訓練時於 `ai_training.py` 內**即時計算**（避免每天重新生成）：

```python
df["y"] = (df["next_close"] / df["close"] - 1).shift(-1)  # 報酬率
df = df.dropna(subset=["y"])  # 最後一天無 label
```

> 報酬率分布通常肥尾，建議在訓練前 winsorize（±3σ 或 ±5%），可作為參數選項。

---

## 四、資料集分割（時間序）

**禁止隨機 shuffle**（會引入 future → past 的 leakage）。

| 方案 | train | val | test | 適用情境 | 預設 |
|---|---|---|---|---|---|
| 60/20/20 | 60% | 20% | 20% | val/test 樣本多、調參穩定 | |
| **70/15/15** | 70% | 15% | 15% | 標準權衡（推薦） | ✓ |
| 80/10/10 | 80% | 10% | 10% | 訓練多、val/test 樣本少 | |
| 自訂 | — | — | — | 邊界手動指定 | |

**前端提供 4 個選項（3 預設 + 自訂）**。

> **G6 守則延伸**：股票資料若用未來資訊（未來 1~N 日的 close）會污染特徵。
> `stock_daily_features` 目前 89 欄皆為「截至當日」可得的歷史計算結果（MA、KDJ 等），
> 但**訓練前需抽樣驗證**沒有 shift 錯誤（見 §十三風險）。

---

## 五、訓練方式與模型清單

### 機器學習（樹模型）

| 模型 | 用途 | 主要參數 | 標準化 |
|---|---|---|---|
| **XGBoost** | 表格資料常用基線 | n_estimators、max_depth、learning_rate、subsample、colsample_bytree | ❌ 不需要 |
| **LightGBM** | 大資料更快 | n_estimators、num_leaves、learning_rate、min_child_samples | ❌ 不需要 |
| **RandomForest** | 簡單基線、抗噪 | n_estimators、max_depth、min_samples_split | ❌ 不需要 |

### 類神經網路

| 模型 | 用途 | 主要參數 | 標準化 |
|---|---|---|---|
| **MLP**（多層感知器） | 特徵交叉學習 | hidden_layers、dropout、epochs、batch_size、lr | ✅ 必須 |
| **LSTM** | 時序依賴 | sequence_length、hidden_units、layers、epochs、batch_size、lr | ✅ 必須 |

> **依模型自動建議標準化方式**（見 §六），使用者可覆寫。

---

## 六、標準化（Scaler）

**標準化參數必須在 train 上 fit，val/test 用 train 的參數轉換**（不能全資料 fit）。

| 方法 | 適用 | 公式 |
|---|---|---|
| `none` | 樹模型 | 不標準化 |
| `standard` | 神經網路、線性模型 | `(x - mean_train) / std_train` |
| `robust` | 資料有離群值 | `(x - median_train) / IQR_train` |
| `minmax` | 神經網路（需 0~1 輸入） | `(x - min_train) / (max_train - min_train)` |

### 前端設計原則
- 模型選定後，**自動帶入預設 scaler**（樹模型 → none、神經網路 → standard）
- 使用者可覆寫（下拉選單）
- 儲存 scaler 物件於模型 artifact（預測時必須用同一 scaler）

---

## 七、6 步驟引導式 Wizard 詳細規格

### 步驟 1：訓練方式選擇

| UI 元素 | 內容 |
|---|---|
| 大選項 | 「機器學習（樹模型）」/「類神經網路」 |
| 模型清單 | 依選擇展開（§五） |
| 每個模型卡 | 名稱、簡介（1~2 句話）、優缺點、典型使用情境 |
| 下一步按鈕 | 「下一步：設定參數」（未選模型 disabled） |

**預設選項**：機器學習 → XGBoost（基線起點）。

### 步驟 2：訓練參數

每個模型有自己的參數表（§五）。UI 用 `Label + Input + 說明 Tooltip` 排版，Tooltip 顯示：
- 參數意義
- 合理範圍
- 預設值（從經驗值帶入，使用者可調）
- 對訓練時間/效果的影響提示

> 參考 UI 模式：`frontend/src/components/stocks/IndicatorSettingsPopup.tsx` 的參數 + Tooltip 設計。

### 步驟 3：預測目標 + 股票清單

| 區塊 | 內容 |
|---|---|
| 預測目標 | 單選：隔日漲跌 / 隔日價格 / 隔日報酬率（預設報酬率） |
| 訓練股票清單 | 預設 59 檔（研究清單全選），可勾選子集 |
| 區間 | 預設 `stock_daily_features` 全範圍（2024-08-01 ~ 2026-08-07），可改 |

### 步驟 4：資料準備

| 區塊 | 內容 |
|---|---|
| 分割比例 | 4 選項（§四），預設 70/15/15 |
| 標準化 | 下拉選單，預設依模型（§六），可覆寫 |
| 標籤處理 | 顯示 Y 計算方式與 winsorize 設定（如選報酬率才顯示 winsorize） |
| 預覽 | 「訓練樣本數：xxx 筆、驗證：xxx 筆、測試：xxx 筆」（即時計算） |

### 步驟 5：開始訓練

| UI 元素 | 內容 |
|---|---|
| 摘要卡 | 顯示前述所有設定（最終確認） |
| 訓練動態 | 進度條（epoch/N 或 step/N）+ 當前 loss/val_loss + 已耗時間 + 預估剩餘 |
| 損失曲線 | 即時折線圖（train_loss、val_loss 兩條線，輕量級 recharts 或 canvas） |
| 控制 | 「停止訓練」按鈕（發送取消訊號，graceful stop） |

### 步驟 6：回測與模型評估

| 區塊 | 內容 |
|---|---|
| ML 指標軌 | accuracy / AUC / F1（分類）或 MAE / RMSE / R²（回歸）— 對 train/val/test 各自顯示 |
| 回測績效軌 | 對 val/test 各跑一次 `run_backtest`（把模型預測值轉成交易訊號）→ 報酬率、勝率、最大回撤、交易次數 |
| 模型比較 | 與「基線」（如恆買或前一日漲跌）的對比 |
| 儲存 | 「儲存模型」按鈕（寫入 `model_artifacts` collection） |

> **回測訊號轉換**（簡化版）：模型預測 Y > 某閾值（如 0.5%）→ buy；
> Y < -某閾值 → sell；其餘 hold。閾值於步驟 6 顯示為可調參數。

---

## 六.5、列表頁 + 創建 Dialog（入口流程）

### 設計動機
原設計 `/ai-training` 直接是 wizard，每次進入都要重新填寫所有設定。
新設計引入「訓練項目」概念：

```
列表頁（/ai-training）
  ├── 顯示所有訓練項目（含 pending / running / completed / saved 等狀態）
  ├── 「+ 新建訓練」按鈕 → 開 Dialog 填名稱 + tag → 儲存後跳轉到該項目的 wizard
  └── 點任一行 → 進入該項目的 wizard（/ai-training/{job_id}）

wizard（/ai-training/{job_id}）
  └── 6 步驟：訓練方式 → 參數 → 目標 → 資料準備 → 訓練 → 評估
      （設定自動儲存於該 job 的 doc，下次進入時載入）
```

### 列表頁（`/ai-training`）

#### 表格欄位
| 欄位 | 內容 | 說明 |
|---|---|---|
| 名稱 | 訓練項目名稱（`{YYYYMMDD}-{HHmm}-NNN` 預設，可改） | 連結到 wizard |
| 狀態 | pending / running / completed / failed / stopped / saved | 狀態徽章（顏色區分） |
| 模型類型 | XGBoost / LightGBM / ... | 來自 wizard Step 1 |
| 標籤 | 多選 tag chips | 列表內顯示前 3 個 + 「+N」 |
| 建立時間 | YYYY-MM-DD HH:mm | |
| 最後訓練 | YYYY-MM-DD HH:mm 或 「—」 | 從 `finished_at` |
| 訓練指標 | test RMSE / test accuracy 等 | 顯示最後一次 run 的 test 指標 |

#### 排序 / 過濾
- 預設按「最後訓練」倒序
- 篩選器：狀態（多選）、模型類型（多選）、tag（多選）
- 搜尋：名稱模糊比對

#### 「+ 新建訓練」Dialog

| 欄位 | 必填 | 預設 | 說明 |
|---|---|---|---|
| 名稱 | ✅ | `{YYYYMMDD}-{HHmm}-001`（前端預生成，遞增找未衝突的） | 唯一性不強制（同名不阻擋，靠 job_id 區分） |
| 標籤 | ❌ | `[]` | 多選 chip；預設清單：`baseline` / `production` / `experimental` / `retired`；可自訂新增 |
| 描述 | ❌ | `''` | 選填，專案說明 |

確定後：
1. POST `/api/ai-training/projects` 建立 doc，狀態 `pending`
2. router 回傳 `job_id`
3. 前端 router.push(`/ai-training/{job_id}`) 跳轉到 wizard

### 狀態說明（列表用）
| 狀態 | 顯示 | 顏色 | 觸發條件 |
|---|---|---|---|
| `pending` | 待訓練 | 灰 | 建立後、尚未開始訓練 |
| `running` | 訓練中 | 藍 | POST `/jobs` 後、Celery 開始執行 |
| `completed` | 已完成 | 綠 | 訓練成功完成（val/test 指標已寫入） |
| `failed` | 失敗 | 紅 | 訓練拋出例外 |
| `stopped` | 已停止 | 黃 | 使用者按停止或強制取消 |
| `saved` | 已儲存 | 紫 | 「儲存為模型」後，額外標記（model_artifacts 已寫入） |

### 與「wizard 詳細頁」的關係
- 進入 wizard（`/ai-training/{job_id}`）時，先從 `ai_training_jobs` 讀取 doc：
  - 若狀態為 `pending` / `failed` / `stopped` → 載入設定（如果有 `config_snapshot`），讓使用者從斷點繼續
  - 若狀態為 `running` → 顯示「訓練中，請至列表頁查看進度」並提供「停止」按鈕
  - 若狀態為 `completed` / `saved` → 載入設定與最後一次訓練結果，Step 5 顯示「重新訓練」按鈕（產生新 run，仍綁定同一 job_id，version+1）
- 點 wizard Step 5「開始訓練」：
  - 觸發 POST `/api/ai-training/jobs` with `{job_id, config}` → Celery 建立新 run（version+1）
  - 同一個 job_id 可有多個 run（訓練歷史），列表顯示「最新 run」的狀態

### 單 vs 多 Run
- 簡化：v1 一個 job 只跑一次 run（status 直接更新，不做 version）
- 進階：未來若需要「同設定多次訓練取平均」或「超參搜尋」，再擴充 runs 子集合
- **v1 採簡化**：`ai_training_jobs` doc 同時是 project + 單次 run；重新訓練時**覆寫** doc 內容

---

## 八、API 端點設計

### GET `/api/ai-training/projects`
列出所有訓練項目（從列表頁讀取）。

**Query params**：
- `status`：多選，例 `?status=pending,completed`
- `tags`：多選，例 `?tags=baseline`
- `model_type`：多選
- `q`：名稱模糊搜尋
- `sort`：預設 `updated_at desc`

**Response**：
```json
{
  "items": [
    {
      "job_id": "uuid",
      "name": "20260809-1430-001",
      "tags": ["baseline"],
      "description": "...",
      "model_type": "xgboost",
      "status": "completed",
      "created_at": "...",
      "updated_at": "...",
      "finished_at": "...",
      "test_metric": { "rmse": 0.031, "r2": 0.32 }
    }
  ],
  "total": 12
}
```

### GET `/api/ai-training/projects/{job_id}`
取得單一訓練項目完整 doc（給 wizard 載入設定用）。

**Response**：`ai_training_jobs` doc 完整內容（含 `config_snapshot` 若有）。

### POST `/api/ai-training/projects`
建立訓練項目（從列表頁「+ 新建訓練」Dialog 觸發）。

**Request**：
```json
{
  "name": "20260809-1430-001",       // 必填：訓練名稱（預設 YYYYMMDD-HHmm-NNN；可改）
  "tags": ["baseline", "experimental"],  // 選填：多選 tag，預設 []
  "description": "XGBoost 基線 89 欄"  // 選填：選填說明
}
```

**Response**：
```json
{
  "job_id": "uuid-hex",              // 用於跳轉到 /ai-training/{job_id}
  "status": "pending"
}
```

> 建立後 doc 狀態為 `pending`，使用者被導向 `/ai-training/{job_id}` 進行 wizard。

### POST `/api/ai-training/jobs`
從既有訓練項目啟動一次訓練 run（從 wizard Step 5 觸發）。

**Request**：
```json
{
  "job_id": "uuid-hex",               // 必填：要啟動的訓練項目 ID
  "model_type": "xgboost",
  "model_params": {
    "n_estimators": 200,
    "max_depth": 6,
    "learning_rate": 0.05
  },
  "data": {
    "target": "next_return",
    "stock_ids": ["2330", "2454", ...],
    "start_date": "2024-08-01",
    "end_date": "2026-08-07"
  },
  "split": {
    "method": "time_sequential",
    "ratios": [0.7, 0.15, 0.15]
  },
  "preprocessing": {
    "scaler": "standard",
    "winsorize_threshold": null
  }
}
```

**Response**：
```json
{
  "job_id": "uuid-hex",
  "status": "running"               // 立刻回傳 running（Celery 已開始）
}
```

> **v1 簡化**：重新訓練時**覆寫**原 doc 的 status / config_snapshot / metrics（不做 runs 子集合）。
> name / tags / description 從 project 帶過來，不需重傳。


### GET `/api/ai-training/jobs/{job_id}`
查詢訓練進度。

**Response**：
```json
{
  "job_id": "...",
  "status": "running",           // running | completed | failed | stopped
  "model_type": "xgboost",
  "current_epoch": 45,           // 樹模型為 n_estimators 進度
  "total_epochs": 200,
  "train_loss": 0.0234,
  "val_loss": 0.0267,
  "metrics": {
    "train": {"accuracy": 0.58, "auc": 0.61},
    "val": {...},
    "test": null                  // 訓練完成才會填
  },
  "backtest_results": {
    "train_period": {...},
    "val_period": {...}
  },
  "error": null,
  "finished_at": null
}
```

### POST `/api/ai-training/jobs/{job_id}/stop`
停止訓練（發送取消旗標）。

### POST `/api/ai-training/models`
儲存訓練好的模型（從已完成 job）。

**Request**：
```json
{
  "job_id": "...",                  // 必填：從哪個訓練任務儲存
  "name": "XGB-v1-20260808",       // 必填：模型顯示名稱（使用者自訂）
  "description": "XGBoost 基線，89 欄特徵，70/15/15",  // 必填：一句話說明用途/特色
  "tags": ["baseline", "xgboost", "v1"]   // 多選 tag（從預設清單 + 自由輸入），用於過濾
}
```

> **設計備註**：
> - v1 規劃支援多用戶（user system 尚未實作），目前 `created_by` 為 `null`
> - tags 預設清單（前端 chip 多選）：`baseline`、`production`、`experimental`、`retired`；使用者可自訂
> - 模型本體存檔案（`/var/aistock/models/{artifact_id}/model.joblib`），ArangoDB 只存 metadata

### GET `/api/ai-training/models`
列出已儲存模型（簡歷）。

---

## 九、Celery 任務設計

### 模式：直接複用 feature_generate 模式
- Collection：`ai_training_jobs`（同時記錄「項目」與「單次 run」）
- Doc 結構：
  ```json
  {
    "_key": "job_id (uuid)",       // 系統自動生成的 UUID（也是 wizard 路由的 :job_id）
    "name": "20260809-1430-001",   // 使用者在「+ 新建訓練」Dialog 輸入的名稱（之後不變）
    "tags": ["baseline", "xgboost"],  // 列表用 chip 多選 tag（與 model_artifacts 的 tags 概念獨立）
    "description": "XGBoost 基線 89 欄特徵",  // 選填
    "model_type": "xgboost",        // 從 wizard Step 1 寫入
    "status": "pending | running | completed | failed | stopped | saved",
    "current_epoch": 45,
    "total_epochs": 200,
    "train_loss": 0.0234,
    "val_loss": 0.0267,
    "metrics": { "train": {...}, "val": {...}, "test": {...} },
    "backtest_results": { "train_period": {...}, "val_period": {...} },
    "config_snapshot": {            // 訓練啟動時的設定快照（不可變，後續查詢能還原）
      "model_params": {...},
      "data": {...},
      "split": {...},
      "preprocessing": {...}
    },
    "created_at": 1694000000,
    "created_by": null,            // v1 為 null（未實作 user 系統）；未來接入 user_id
    "updated_at": 1694000123,       // 最後一次訓練啟動時間（與 created_at 區分）
    "finished_at": null,
    "error": null
  }
  ```
- `_update_job` 含並發重試（已修復，見 `feature_generate.py`）
- **`config_snapshot` 為訓練啟動時的設定快照**，確保後續查詢 job 時仍能看到當時的完整設定
- **狀態流轉**：
  - `pending`（建立後） → `running`（POST /jobs 後） → `completed` / `failed` / `stopped`
  - `completed` → `saved`（POST /models 後，model_artifacts 寫入成功）
  - 重新訓練：`running` → `completed` / `failed` / `stopped`，**覆寫** status / config_snapshot / metrics

### 任務流程
```
generate_training_job (entry, 同步建 doc + enqueue)
    └── train_model_task (worker, 異步)
            ├── 1. 載入 stock_daily_features
            ├── 2. 計算 Y、分割、標準化
            ├── 3. 模型初始化
            ├── 4. 訓練迴圈（每 epoch 更新 job doc）
            │       ├── 檢查取消旗標
            │       ├── train_one_epoch()
            │       └── emit progress
            ├── 5. 最終評估（train/val/test 指標）
            ├── 6. 回測（val/test 期 run_backtest）
            └── 7. 儲存 job doc 為 completed
```

### 取消機制
- 訓練任務內每 epoch 開頭檢查 `should_stop(job_id)` 旗標
- 設定旗標由 `/stop` 端點寫入（亦寫入 `ai_training_jobs` doc 或 redis）
- 取消時仍完成當前 epoch 才退出（graceful）

---

## 十、模型保存與版本管理

### `model_artifacts` collection
```json
{
  "_key": "uuid",
  "name": "XGB-v1-20260808",               // 必填：使用者命名
  "description": "XGBoost 基線，89 欄特徵",    // 必填
  "tags": ["baseline", "xgboost"],          // 多選 tag
  "job_id": "<關聯的 ai_training_jobs._key>", // 必填：可追溯到原始訓練
  "model_type": "xgboost",
  "model_params": {...},
  "data_config": {
    "target": "next_return",
    "stock_ids": [...],
    "start_date": "...",
    "end_date": "..."
  },
  "split_config": {...},
  "preprocessing_config": {...},
  "metrics": {
    "train": {...},
    "val": {...},
    "test": {...}
  },
  "backtest_results": {...},
  "model_blob": "<檔案路徑，例如 /var/aistock/models/{uuid}/model.joblib>",
  "model_format": "joblib",          // xgboost/sklearn → joblib；torch → state_dict
  "scaler_blob": "<檔案路徑>",
  "feature_columns": ["col1", "col2", ...],
  "created_at": 1694000000,
  "created_by": null                 // v1 為 null；未來接入 user_id
}
```

> 模型本體較大，**先存檔案**（`/var/aistock/models/{uuid}/model.joblib`），
> ArangoDB 只存路徑與 metadata。實作細節於實作階段決定。

---

## 十一、評估指標

### 雙軌顯示

| 軌 | 指標 | 用途 |
|---|---|---|
| ML 軌 | 分類：accuracy、AUC、F1<br>回歸：MAE、RMSE、R² | 衡量模型擬合能力 |
| 回測軌 | 總報酬率、勝率、最大回撤、交易次數、盈虧比 | 衡量實務交易價值 |

> 回測訊號轉換：模型預測值 > 閾值 → buy、< -閾值 → sell。閾值於 wizard 步驟 6 顯示為可調參數。

### 三段評估
- 對 train / val / test **各**跑 ML 指標與回測
- 若 train 指標遠高於 val/test → overfitting，UI 顯示警告

---

## 十二、前端頁面結構

### 路由
- `/ai-training` — wizard 主頁（6 步驟 tabs 或 step indicator）
- `/ai-training/models` — 已儲存模型列表（之後做）

### 頁面骨架
```
<AiTrainingWizard>
  ├── StepIndicator (1→2→3→4→5→6)
  ├── <Step1 ModelSelection />         ← 卡片選模型
  ├── <Step2 Params />                 ← 參數表單 + Tooltip
  ├── <Step3 TargetAndStocks />        ← 目標 + 股票清單
  ├── <Step4 DataPrep />               ← 分割 + 標準化 + 預覽
  ├── <Step5 Training />               ← 進度 + 曲線 + 停止
  └── <Step6 Evaluation />             ← ML 軌 + 回測軌 + 儲存
```

### 複用模式
- 引導式 stepper：`FeatureSettingsModal` 的 4-tab 結構
- 參數 Tooltip：`IndicatorSettingsPopup` 的設計
- 即時計算預覽：類似 modal 的「訓練樣本數」即時計算

---

## 十三、環境需求

### 新增 Python 套件（`backend/requirements.txt`）
```
scikit-learn>=1.3
xgboost>=2.0
lightgbm>=4.1
torch>=2.0              # LSTM / MLP
joblib>=1.3
numpy>=1.24
pandas>=2.0
```

### 訓練硬體
- **CPU 即可**（MLP、樹模型、LSTM 小規模）
- 預期單次訓練時間：
  - 樹模型（XGBoost 200 rounds × 59 檔 × 490 天 × 89 欄）：**1~3 分鐘**
  - MLP（100 epochs × 59 檔）：**2~5 分鐘**
  - LSTM（50 epochs × sequence_length=20）：**10~30 分鐘**（CPU 較慢）

### 儲存
- 每個模型約 **1~50 MB**（XGBoost < 1MB；LSTM 5~20MB）
- 預留 `/var/aistock/models/` 目錄

---

## 十四、風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| **Data leakage**（特徵含未來資訊） | 訓練/測試成績虛高 | 訓練前抽樣驗證 89 欄皆為截至當日可得；測試集**僅用一次** |
| **Overfitting**（train 遠好於 val/test） | 模型無實戰價值 | UI 顯示 train-val gap 警告；提供 early stopping（LSTM/MLP） |
| **Look-ahead in labels**（Y shift 錯誤） | Y 不對應 | `ai_training.py` 內 label 計算用 `shift(-1)` 並加單元測試驗證 |
| **特徵缺值處理不一致** | 訓練/預測不一致 | 89 欄缺值規則在 `charact.md §九` 已定案；預測時必須用同樣規則 |
| **Scaler fit 範圍錯誤** | val/test 失真 | scaler 嚴格只 fit train；scaler 物件隨模型一同保存 |
| **訓練長任務 worker 死掉** | job 永久卡住 | Celery 任務設 `time_limit`、心跳、並發重試（已用 feature_generate 修復模式） |
| **股票樣本不平衡**（部分股票資料短） | 訓練偏差 | UI 步驟 4 顯示「每檔樣本數」分佈；可讓使用者排除資料 < N 天的股票 |
| **套件依賴膨脹** | 安裝時間、衝突 | 評估可選依賴（torch 較大，初期可只做 ML + MLP，LSTM 之後加） |

---

## 十五、缺口與待定問題

| # | 問題 | 已決策 |
|---|---|---|
| ~~1~~ | ~~預測目標預設值~~ | ✅ 報酬率 |
| ~~2~~ | ~~模型範圍 v1~~ | ✅ XGBoost / LightGBM / RandomForest / MLP / LSTM |
| ~~3~~ | ~~評估指標雙軌~~ | ✅ ML 軌 + 回測軌 |
| ~~4~~ | ~~訓練股票清單預設~~ | ✅ 59 檔全選 |
| ~~5~~ | ~~分割比例預設~~ | ✅ 70/15/15 |
| ~~7~~ | ~~模型保存格式~~ | ✅ joblib + torch state_dict |
| ~~8~~ | ~~LSTM 是否 v1 必做~~ | ✅ 列入但標註「慢任務」 |
| 6 | 回測訊號閾值 | ⏳ v1 實作後調整（預設 ±0.5%） |
| 9 | 模型比較基線 | ⏳ 待實作時挑選（建議前一日漲跌） |
| 10 | 多任務學習（multi-task） | ❌ v1 不做，之後再議 |
| **11** | **訓練名稱預設格式** | ✅ `{YYYYMMDD}-{HHmm}-{NNN}`，NNN 為當日流水號 |
| **12** | **訓練 ID 來源** | ✅ 系統自動 UUID（內部用，使用者不可編輯） |
| **13** | **儲存模型必填欄位** | ✅ name + description + tags（多選） |
| **14** | **多用戶與 created_by** | 🟡 v1 `created_by` 為 null；未來接入 user_id |
| **15** | **入口流程（列表頁 + 創建 Dialog）** | ✅ 列表頁為入口；Dialog 填名稱+tags+描述；確定後跳轉 wizard |
| **16** | **路由規劃** | ✅ `/ai-training`（列表） + `/ai-training/[jobId]`（wizard 詳情） |
| **17** | **單 vs 多 run** | ✅ v1 簡化：單 run，重新訓練時覆寫 doc；未來再擴充 runs 子集合 |
| **18** | **狀態列舉** | ✅ `pending \| running \| completed \| failed \| stopped \| saved` |

---

## 十六、實作順序（建議）

1. **基礎設施**（1 天）
   - 套件安裝 + `ai_training_jobs`、`model_artifacts` collection 建立
   - Celery 任務骨架 + 進度追蹤
2. **訓練核心**（2~3 天）
   - 資料載入 + Y 計算 + 分割 + scaler
   - XGBoost 端到端跑通（最簡單，先通）
   - 擴充 LightGBM、RandomForest
   - 擴充 MLP
   - 擴充 LSTM
3. **評估**（1 天）
   - ML 指標計算
   - 回測串接（train/val/test 各跑一次）
4. **前端**（3~4 天）
   - 列表頁（表格 + 篩選 + 搜尋）
   - 「+ 新建訓練」Dialog（name + tags + description）
   - 6 步驟 wizard（從 `/ai-training/[jobId]` 載入設定）
   - 訓練動態（進度條 + 損失曲線）
   - 評估結果展示
5. **模型保存與版本**（1 天）
   - artifact 序列化
   - 「儲存為模型」Dialog（從 wizard Step 6 觸發）
   - `/ai-training` 列表顯示已儲存狀態（`saved`）
6. **優化**（持續）
   - early stopping
   - winsorize 參數化
   - 異常處理完善

---

## 十七、相關規格引用

- 特徵規格：`.docs/charact.md`（89 欄定義、缺值規則）
- 開發規範：`AGENTS.md`
  - G9：所有指標/特徵一律後端計算
  - G13-G14：AI/LLM 呼叫走系統設定（訓練後若加 LLM 總結要遵守）
- 既有回測：`backend/src/backtest.py`
- Celery 任務模式：`backend/src/tasks/feature_generate.py`
