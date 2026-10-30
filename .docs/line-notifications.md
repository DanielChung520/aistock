# LINE OA 通知（來源註冊 + 授權矩陣）

> 狀態：已實作（2026-10-29；2026-10-29 改為來源註冊 + 授權矩陣）
> 關聯：`sdk/lineOA/.env`、`AGENTS.md` G18

---

## 1. 架構原則

- **來源設定屬於「各功能自己」**：哪個功能會產生訊息，就在該功能的設定裡決定「要不要發、何時發（排程）」。來源**註冊**後才納入管理。
- **收件管理（`/settings/recipients`）只做「授權」**：決定**誰**收得到**哪個來源**的訊息（列＝收件者、欄＝來源的權限矩陣）。
- **發送一律依訂閱權限**：不論自動（排程）或手動，都只發給「該來源 × 已訂閱」的人。

## 2. 來源註冊表（extensible）

程式碼級註冊表 `backend/src/line_sources.py`（新增來源＝加一筆，矩陣與發送過濾自動生效）：

| key | label |
|---|---|
| `strategy` | 策略執行結果（＝工作站1） |
| `workstation2` | 工作站2 |
| `workstation3` | 工作站3 |
| `other` | 其他通知 |

- 每個來源的**發送開關**存 ArangoDB `line_sources`（`{_key, enabled}`），由各功能透過 `PUT /api/line/sources/{key}` 設定（預設 enabled=true）。

## 3. 資料模型

- `line_recipients`：`{ user_id, display_name, picture_url, status: followed|blocked, note, category, subscriptions: { <sourceKey>: bool } }`。
- `line_messages`：`{ user_id, direction: in|out, text, at }`（webhook 收 `message` 事件寫 in；推播寫 out）。
- `line_sources`：`{ _key, enabled }`。
- 新加入的使用者 `subscriptions` 預設**全開**；舊資料 `enabled:false` 遷移為全關。

## 4. Webhook / API

Webhook URL（LINE Console）：**`https://stk.k84.org/api/line/webhook`**
（Next route **原封轉發 raw body + `X-Line-Signature`** → backend 驗簽。）

| 端點 | 說明 |
|---|---|
| `POST /api/line/webhook` | 驗簽；`follow`/`unfollow`/`message`（寫入收件者與對話） |
| `GET /api/line/sources` | 來源註冊表 + 各來源 enabled |
| `PUT /api/line/sources/{key}` | 設定某來源的發送開關（各功能呼叫） |
| `GET /api/line/recipients` | 名單（含 note/category/subscriptions）+ sources + configured |
| `PATCH /api/line/recipients/{user_id}` | 更新 note / category / subscriptions |
| `DELETE /api/line/recipients/{user_id}` | 移除 |
| `GET /api/line/recipients/{user_id}/messages` | 該使用者對話記錄 |
| `POST /api/line/send` | `{source, text}` → 依訂閱權限發送（手動發送用） |
| `POST /api/line/recipients/sync` | 主動同步名單（打 LINE `followers/ids`）；未開放時回 `available:false` |
| `POST /api/line/recipients/refresh-all` | 批次更新全部聯絡人顯示名稱 |
| `POST /api/line/broadcast` | `{text, user_ids?}` 群發給全部（或指定）followed 使用者 |

憑證：`sdk/lineOA/.env`（`Channel_ID`/`Channel_secret`/`access_token`(檔內 `assess_token`)/`Your_user_ID`），**不進瀏覽器**。

## 5. 觸發

- **排程選股**：`strategy_screen` job → `routers/strategy.py:run_strategy(source="scheduled")` → 完成後 `push_source("strategy", …)`（依來源開關 + 訂閱權限）。
- **手動執行選股**（`POST /strategy/screen`）**不自動發送**；改由清單上的「手動發送」呼叫 `POST /api/line/send`（同樣依訂閱權限）。
- 發送前先檢查來源 `enabled`（`push_source` 內），停用即不發。

## 6. 前端

- 頁面 `/settings/recipients`：**管理區**（搜尋 / 同步聯絡人 / 更新名稱 / 群發信息）+ **權限矩陣**（使用者 × 來源，逐格勾選）+ 備註/分類編輯 + **對話記錄**面板。
- 入口：sidebar 下方「功能表」popover 底部 **「收件管理」**。

## 7. 限制 / 待辦

- 需為 **Messaging API channel**（非 LINE Notify）。
- **名單只能靠事件**：LINE **未提供「列出所有好友」的公開能力給一般帳號**——`GET /v2/bot/followers/ids` 在**未認證/免費層級回 403**（`Access to this API is not available for your account`），需**認證帳號（藍勾）/付費方案**才可用。未開放時，「同步聯絡人」按鈕會回 `available:false`；漏掉的名單只能請對方**傳訊息**或**封鎖→解除封鎖**（重送 `follow`）。
- webhook 端點上線前加入的舊好友，其 `follow` 已流失且不會補送。
- multicast 一次上限 500，超過需分批（尚未實作）。
- 「手動發送」按鈕在個股/策略清單上尚未接線（後端 `POST /api/line/send` 已就緒）。
- 工作站2/3 為預留來源（功能未實作，尚無發送端）。

---

*相關程式碼：`backend/src/line_sources.py`、`backend/src/line_notify.py`、`backend/src/routers/line.py`、`backend/src/routers/strategy.py`、`frontend/src/app/settings/recipients/page.tsx`、`frontend/src/app/api/line/**`、`frontend/src/components/sidebar-nav.tsx`。*
