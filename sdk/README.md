# sdk/ — 券商 SDK 統一存放區

本目錄集中管理各家券商/交易 API 的 SDK。**所有券商 SDK 一律放在此目錄下，一家一個子目錄。**

## 目錄規範

```
sdk/
├── README.md              # 本檔（共同規範）
├── fubon/                 # 富邦證券（富邦新一代 API / Fubon Neo）
│   ├── README.md          # 該券商安裝/憑證/登入說明
│   ├── wheels/            # 官方下載的 wheel / zip / nupkg（gitignore，可重新下載）
│   └── certs/             # 憑證檔（.pfx/.p12 等，gitignore，絕不入版控）
├── yuanta/                # 元大（未來）
└── kgi/                   # 凱基（未來）
```

### 每個券商子目錄的固定結構

| 路徑 | 內容 | 是否入版控 |
|---|---|---|
| `README.md` | 安裝方式、官方下載 URL、憑證申請、登入範例 | ✅ 是 |
| `wheels/` | 官方下載的安裝檔（`.whl`/`.zip`/`.nupkg`/`.tgz`） | ❌ 否（`sdk/**/wheels/` 已 gitignore） |
| `certs/` | 憑證（`.pfx`/`.p12`/`.pem`）與相關金鑰檔 | ❌ 否（`sdk/**/certs/`、`*.pfx`、`*.p12` 已 gitignore） |
| `examples/` |（選用）最小登入/下單範例 | ✅ 是 |

空目錄以 `.gitkeep` 佔位，讓結構能進版控。

## 憑證與金鑰管理原則

1. **憑證檔（`.pfx` 等）只放 `sdk/<broker>/certs/`，永不提交。** 已在 `.gitignore` 排除。
2. **帳密與 API Key 一律從專案根目錄 `.env` 讀取**，命名規則為 `<BROKER>_<欄位>`，全大寫。
   - 例：`FUBON_PERSONAL_ID`、`FUBON_PASSWORD`、`FUBON_CERT_PATH`、`FUBON_CERT_PASSWORD`、`FUBON_API_KEY`
   - 未來：`YUANTA_*`、`KGI_*`
3. `.env` 本身已在 `.gitignore`（不提交）。新增變數時同步更新本目錄對應 README。
4. **程式碼不得硬編碼券商帳密/憑證路徑**，一律經 `.env` → config → SDK 呼叫。

## 安裝原則

- Python 類 SDK **優先以官方 PyPI 套件 `pip install` 進 backend venv**；同時把官方 wheel 留底於 `sdk/<broker>/wheels/`（可重現、可離線重裝）。
- 非 Python SDK（C#/.NET、Node.js...）依各券商官方說明安裝，安裝檔留於 `wheels/`。
- 各券商實際安裝指令、版本、相容性見該券商 `README.md`。

## 已納入券商

| 券商 | 目錄 | SDK / 套件 | 狀態 |
|---|---|---|---|
| 富邦證券 | [`sdk/fubon/`](./fubon/README.md) | 富邦新一代 API（PyPI `fubon-neo`） | 目錄已建立，待憑證 |
