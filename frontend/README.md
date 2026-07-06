# aiStock Frontend

Next.js 16 + shadcn/ui + Tauri 桌面應用。

> 專案整體說明、啟動方式、架構請見[根目錄 README](../README.md)。

## 常用指令

```bash
pnpm dev          # 啟動 Next.js dev server (port 3300)
pnpm build        # 建置 frontend production (.next/)
pnpm lint         # ESLint
pnpm ts-check     # TypeScript 檢查
pnpm db:seed      # 寫入選單資料到 ArangoDB
pnpm db:reset     # 重置選單資料
```

## 架構

- `src/app/` — Next.js App Router 頁面與 API proxy routes
- `src/components/` — React 元件（shadcn/ui 在 `ui/` 下）
- `src/lib/` — 工具函式（ArangoDB 連線等）
- `src-tauri/` — Tauri v1 桌面包裝 (Rust)

## 開發規範

- 使用 pnpm（preinstall hook 強制檢查）
- TypeScript strict mode，禁止 `as any` / `@ts-ignore`
- UI 文字使用繁體中文
- Server Component 優先，`'use client'` 只在需要瀏覽器 API 時使用
