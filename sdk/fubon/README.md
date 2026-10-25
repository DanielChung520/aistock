# 富邦證券 — 富邦新一代 API（Fubon Neo API）

> Python SDK 套件：**`fubon-neo`**（import `fubon_neo`）｜官方入口：https://www.fbs.com.tw/TradeAPI/

## 1. 前置條件（憑證為門檻，SDK 本身免費下載）

SDK 檔案可公開下載，但**能登入**需先完成：

1. 富邦證券**電子交易帳戶**
2. 申請**憑證**（`.pfx`）
3. 簽署「API 服務申請書暨聲明書」+ 完成**連線測試**
4. （選用）申請 **API Key**：https://www.fbs.com.tw/TradeAPI/docs/key

> **憑證取得有兩條路，只有一條綁 Windows：**
> - **檔案式憑證（憑證e總管 / `TCEM.exe`）** → 存於 `C:\CAFubon\<身分證字號>\<身分證字號>.pfx`。
>   **官方明載：檔案式憑證僅支援 Windows 10+**
>   （頁面：https://www.fbs.com.tw/Certificate/Management/ ← 這頁只有 Windows，別在此找跨平台）。
> - **網頁憑證（WebCA）＋ 匯出** → **純瀏覽器、跨平台（Linux/macOS 可用）**。入口二選一：
>   1. **新一代 API 金鑰頁** https://www.fbs.com.tw/TradeAPI/docs/key/ →「金鑰管理與憑證匯出」區塊登入
>      （身分證＋電子平台密碼＋OTP）→ 申請網頁版憑證 → **匯出憑證**（v2.2.8+）。
>   2. 富邦官網 https://www.fbs.com.tw 登入（官網即採 WebCA 驗證，偵測無憑證會引導申請）。
> - 匯出的憑證檔放 `sdk/fubon/certs/`，並更新 `.env` 的 `FUBON_CERT_PATH`（指向實際 `.pfx`，非目錄）。
> - 聯絡：證券 API `pm.trading.sec@fubon.com`。

## 2. 相容性

| 項目 | 要求 |
|---|---|
| Python | **3.8 – 3.13**（3.7 已於 v2.0.1 移除；**不支援 3.14**） |
| 本專案 | backend venv = Python 3.12.3 ✅ |
| OS | Windows / macOS / Linux（x86-64、arm64） |

## 3. 安裝

### 方式 A（建議）：官方 PyPI

```bash
cd /home/daniel/github/aistock/backend
source .venv/bin/activate
pip install "fubon_neo==2.3.1"     # PyPI 現為 2.3.1；官方文件已到 2.4.0
```

### 方式 B：官方 wheel 留底 + 安裝（對應 `wheels/`）

官方各平台 wheel（v2.4.0）：

```bash
# Linux x86-64
curl -L -o sdk/fubon/wheels/fubon_neo-2.4.0.zip \
  https://www.fbs.com.tw/TradeAPI_SDK/fubon_binary/fubon_neo-2.4.0-cp37-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.zip

# 解壓後 pip 安裝（wheel 為 cp37-abi3，相容 3.8+）
unzip sdk/fubon/wheels/fubon_neo-2.4.0.zip -d sdk/fubon/wheels/
pip install sdk/fubon/wheels/fubon_neo-2.4.0-cp37-abi3-*.whl
```

> 其他平台 URL 見官方下載頁：https://www.fbs.com.tw/TradeAPI/docs/download/download-sdk
> 下載頁亦提供範例程式：`https://www.fbs.com.tw/TradeAPI_SDK/sample_code/python_sample_code.zip`

## 4. 憑證與 `.env` 設定

`.pfx` 放入 `sdk/fubon/certs/`，帳密放**專案根目錄 `.env`**（已 gitignore）：

```ini
FUBON_PERSONAL_ID=        # 身分證字號（登入 ID）
FUBON_PASSWORD=           # 電子交易密碼
FUBON_CERT_PATH=./sdk/fubon/certs/<身分證字號>.pfx
FUBON_CERT_PASSWORD=      # 憑證密碼（若用「預設密碼」可留空，SDK v1.3.2+）
FUBON_API_KEY=            # 選用；API Key 登入時使用
```

## 5. 登入範例

```python
import os
from dotenv import load_dotenv
from fubon_neo.sdk import FubonSDK

load_dotenv()

sdk = FubonSDK()
accounts = sdk.login(
    os.environ["FUBON_PERSONAL_ID"],
    os.environ["FUBON_PASSWORD"],
    os.environ["FUBON_CERT_PATH"],
    os.environ.get("FUBON_CERT_PASSWORD"),  # 預設密碼時可省略
)
acc = accounts.data[0]

# 選用：API Key 登入（v2.2.7+，適合自動化）
# sdk.apikey_login(os.environ["FUBON_PERSONAL_ID"], os.environ["FUBON_API_KEY"],
#                  os.environ["FUBON_CERT_PATH"], os.environ.get("FUBON_CERT_PASSWORD"))

# 行情（需額外初始化）
sdk.init_realtime()
reststock = sdk.marketdata.rest_client.stock
```

### 測試環境（下單測試）

```python
# SDK v2.2.1+
sdk = FubonSDK(30, 2, url="wss://neoapitest.fbs.com.tw/TASP/XCPXWS")
# SDK <= v2.2.0
sdk = FubonSDK(url="wss://neoapitest.fbs.com.tw/TASP/XCPXWS")
```

測試環境僅證券、需簽署後 email 申請；測試帳號為測試憑證上的 ID，登入密碼與憑證密碼皆 `12345678`。
測試包：`https://www.fbs.com.tw/TradeAPI_SDK/sample_code/test_environment.zip`

## 6. 已知限制 / 注意事項

- **憑證是必要條件，非選用**（官方「事前準備」明列必要條件＝富邦帳戶 + **數位憑證** + API 聲明 + 連線測試；登入方式＝憑證登入）。
  - `login` 與 `apikey_login` **兩者都要 `cert_path`**；連行情也要（`login` 後才能取得行情權限）。
  - **唯一可省略的是 `cert_pass`**：若憑證採「預設密碼」（＝登入 ID／身分證字號），SDK v1.3.2+ 可只傳 3 個參數。
  - **「Windows-only」只指申請憑證的工具（憑證e總管 TCEM.exe）與連線測試程式**，不是憑證檔本身；
    **v2.2.8+ 可從網頁匯出憑證以支援跨平台**。取得方式：至 https://www.fbs.com.tw/TradeAPI/docs/key
    以「身分證字號 + 電子平台密碼 + OTP」登入 → 匯出 `.pfx` → 放 `sdk/fubon/certs/`。
- **API 介面跨版本會變**：請釘版本（`fubon_neo==<ver>`），勿裸 `pip install` 無版本。
- PyPI（2.3.1）可能落後官方最新（2.4.0）；需最新功能時走方式 B。
- 速率限制：同時 10 連線、50 單/秒、批次 10 筆/秒、帳務查詢 5 次/秒。
- 本目錄 `wheels/`、`certs/` 皆 gitignore；憑證不得提交。

## 7. 常見登入回應

| 回應訊息 | 意義 | 處理 |
|---|---|---|
| `無簽署完成API使用風險暨聲明書帳號…使用權限將應於次日開通` | **帳密/憑證正確、連線測試成功**，但 API 權限尚未開通 | 確認 e櫃台已簽「API 風險使用聲明書」；**次一營業日**權限開通後即可正常登入 |
| 憑證相關錯誤（如 `cert`/`憑證` 字樣） | 憑證路徑或密碼錯誤 | 檢查 `FUBON_CERT_PATH` 是否指向實際 `.pfx`、`FUBON_CERT_PASSWORD` 是否正確 |
| `Sign data is timeout` | 系統時間與伺服器差太多 | 校時，或加大連線參數 |

> 以 SDK 登入本身就是官方「連線測試」的方法之一（方法3）；出現上表第一列的訊息即代表連線測試完成。

> **重要：`login.is_success = False`（交易帳號未開通）不影響行情。**
> 實測在未開通交易權限時，以下**行情全部可取得**（行情權限與交易權限分開）：
> ```python
> sdk.init_realtime()
> r = sdk.marketdata.rest_client.stock
> r.intraday.ticker(symbol="2330")                          # 商品基本資料
> r.intraday.quote(symbol="2330")                           # 即時報價（含五檔）
> r.historical.candles(symbol="2330", timeframe="D")        # 日K（OHLCV）
> r.snapshot.quotes(market="TSE")                           # 市場快照
> ```
> 只有**下單/帳務**才需要交易權限開通（次一營業日）。範例：`examples/marketdata_test.py`。

## 官方連結

| 用途 | URL |
|---|---|
| Developer portal | https://www.fbs.com.tw/TradeAPI/ |
| SDK 下載 | https://www.fbs.com.tw/TradeAPI/docs/download/download-sdk |
| 快速開始 | https://www.fbs.com.tw/TradeAPI/docs/trading/quickstart |
| 事前準備（憑證/聲明/測試） | https://www.fbs.com.tw/TradeAPI/docs/trading/prepare |
| API Key 管理 | https://www.fbs.com.tw/TradeAPI/docs/key |
| 安裝/相容性 | https://www.fbs.com.tw/TradeAPI/docs/install-compatibility |
