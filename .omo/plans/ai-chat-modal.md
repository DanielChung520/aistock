# AI 改為可拖曳獨立 Modal 視窗

## TL;DR
> 把 `AIDrawer`（右側滑出面板）改成 `AIChatModal`（可拖曳的獨立視窗），使用者在 RS 點 AI 後出現可任意移動的對話視窗。

---

## Context

### 使用者需求
「RS 的 ai 應該點擊後出現獨立的 Ai 聊天的 modal 而且可以移動視窗」

### 目前狀態
- `AIDrawer.tsx`：右側滑出 420px 固定面板
- `AIIconButton`：呼叫 `useAIDrawer().open()` 開啟 Drawer
- Drawer 用 `top-10 right-0 bottom-0 fixed z-[100]`

### 設計決定
- Modal 預設位置：螢幕中央偏右（不擋住 chart）
- 預設尺寸：480 x 600px（比 Drawer 寬，方便看對話）
- 可拖曳 header 區
- 可關閉（X 按鈕、ESC、點背景）
- 拖曳時 cursor 變 grab/grabbing
- 拖曳範圍限制在視窗內
- 重新打開時記住上次位置（localStorage）

---

## Files

### 新增
1. `frontend/src/components/ai-chat-modal.tsx` — 可拖曳 modal 主元件
2. `frontend/src/lib/use-draggable.ts` — 共用拖曳 hook（optional，可內嵌）

### 修改
3. `frontend/src/components/ai-icon-button.tsx` — 改用 AIChatModal 的 context（保留 `useAIDrawer` 名稱或重命名）
4. `frontend/src/components/app-shell.tsx` — 用 `AIChatModal` 取代 `AIDrawer`
5. （Optional）刪除 `frontend/src/components/ai-drawer.tsx`

---

## Component Specs

```
┌─────────────────────────────┐ ← drag handle (整個 header)
│ ✨ AI 助手  Powered by ...   │ × │
├─────────────────────────────┤
│                              │
│  對話訊息區                  │
│  （可滾動）                  │
│                              │
│                              │
│                              │
├─────────────────────────────┤
│ [輸入框.........]  [送出]  │
└─────────────────────────────┘
```

- 寬度 480px（比 Drawer 420px 寬）
- 高度 600px
- Header 可拖曳
- Body 和 footer 不能拖
- 圓角 rounded-xl
- shadow-2xl

---

## 互動

| 行為 | 結果 |
|---|---|
| 點 AI icon | modal 出現在預設位置 |
| 按住 header 拖曳 | 移動位置 |
| 拖到視窗外 | 限制在 viewport 內 |
| X 按鈕 | 關閉 |
| ESC | 關閉 |
| 點背景 | 關閉（半透明遮罩） |
| 重新開啟 | 記住上次位置 |

---

## Verification

- [ ] ts-check 通過
- [ ] 點 AI 出現 modal（不在側邊）
- [ ] 可拖曳到任意位置
- [ ] ESC 關閉
- [ ] 截圖驗證