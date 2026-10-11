# aiStock 頁面佈局與表格規範

> **適用範圍**:`frontend/src/app/**/page.tsx` 內所有非首頁(`/`)頁面,以及它們共用的 `<AppShell>` / `<Table>` 元件。
> **最後更新**:2026-07-08
> **基準視口**:**1440 × 900**(其他尺寸按比例計算)

---

## 一、為什麼需要這份規範

aiStock 的功能頁有兩個常見的「撞牆點」:

1. **資料量大,但 viewport 固定**:1845 支股票、1010 家券商、跨年度競拍資料 — 任一頁載入後,如果沒有高度規範,內容會把 `<main>` 撐大,**蓋過 footer** 或讓**分頁按鈕擠出可見範圍**。
2. **跨平台執行**:aiStock 透過 Next.js (port 33300) 在「瀏覽器直開」、「iframe 嵌入桌面版 (Tauri)」、「之後可能用 `frontend/iframe/` 的 config-driven 框架」三種環境下運作。頁面不能依賴任何單一環境的特殊行為。

這份規範就是為了解上述問題而存在:**讓頁面在任何環境、任何資料量、任何視口下都長一樣**。

---

## 二、執行環境(Iframe / Tauri / 純瀏覽器)

| 環境 | URL/路徑 | 高度計算 | 備註 |
|---|---|---|---|
| **純瀏覽器直開** | `http://localhost:33300/<route>` | 全 `window.innerHeight` | 目前開發/驗收用 |
| **Tauri 桌面版** | Tauri webview → 內嵌 Next.js | Tauri window height | `aiStock_0.2.0_x64.dmg` |
| **iframe 嵌入** | 任一父頁 `<iframe src="…33300/<route>">` | 父頁設定的 iframe height | 後續場景,先保留設計彈性 |

> **`frontend/iframe/` 是另一個獨立的 config-driven 框架**(零商業邏輯、純 JSON 設定),目的是讓專案之後能拷貝給非台股專案用。**目前 aiStock 沒有使用 `frontend/iframe/`**,主框架是 `src/components/app-shell.tsx`。兩者**不互通**,頁面規範只規範前者。

設計原則:**頁面不該依賴任一環境的特殊行為**(例如不要假設有「iframe resize」event、或 Tauri window 高度通知),而是用 CSS flex 自動分配 → 在任何環境下自然填滿。

---

## 三、設計目標(Why)

| # | 規則 | 為什麼這樣 |
|---|---|---|
| 1 | **Title 統一在 Header** | Header 是「跨頁切換時仍在」的全域元素。Title 放 page 內會被滾動洗走、也跟側欄 / breadcrumb / 設定選單的地位不一致。→ 用 `<AppShell title="...">` 傳入;page 內**不再放 `<h1>`**。 |
| 2 | **Toolbar 永遠可見**(共 N 筆、搜尋、篩選 tabs) | 使用者任何時候都要能篩選;不能因為看資料列就把篩選滾掉。 |
| 3 | **表格 Card 撐滿剩餘高度,內部獨立滾動** | 資料量大時,只滾「表格 Card 內的內容」、Toolbar / 分頁列 / footer 不動。 |
| 4 | **Table thead 永遠可見 (sticky)** | 資料列很多時,滾到第 100 列還是要能看「啊現在是哪一欄」。 |
| 5 | **分頁列永遠在 Card 底** | 同上,任何時候可切下一頁。 |
| 6 | **不用 fixed / absolute / hardcode 高度** | 用 flex 自動分配,跨 viewport / 跨環境都自動適應。 |
| 7 | **Page 不該假設「外層一定有 X scroll」**,也不要 hardcode width | 用 `w-full` 自適應父容器,撐滿 viewport 寬。 |

---

## 四、高度數學

### 4.1 全域可用空間

```
全螢幕(1440 × 900):
  h-screen            = 900
  − AppShell Header   = 60   ← src/components/header.tsx h-[60px]
  − AppShell Footer   = 50   ← src/components/footer.tsx h-[50px]
  ─────────────────────────
  main 可用高度       = 790
```

其他 viewport 等比例推算:
| Viewport 高 | Header | Footer | main 可用 |
|---:|---:|---:|---:|
| 800 | 60 | 50 | **690** |
| 900(基準) | 60 | 50 | **790** |
| 1024 | 60 | 50 | **914** |
| 1200 | 60 | 50 | **1090** |

> 寬度變化不影響高度數學。

### 4.2 各頁「Toolbar 高度」(1440 × 900 實測)

每頁的 toolbar 是固定的(`shrink-0`)、高度可量測出來:

| 頁面                              | toolbar 區塊                                              | toolbar 高 (px) | 表格 Card 淨高(估算)|
|---|---|---:|---:|
| `/auction/announcements`          | 共 N 筆 + 年份 Select + 搜尋                              | **120**         | **638** |
| `/auction/my-bids`                | 共 N 筆 + 返回按鈕                                         | **56**          | **702** |
| `/basics/stock-codes`             | 共 N 檔 + 更新資料 + Tabs + 搜尋                           | **104**         | **638** |
| `/basics/brokers`                 | 共 N 家 + 搜尋                                            | **64**          | **694** |
| `/watchlist`                      | 共 N 檔 + 新增股票                                        | **40**          | **718** |
| `/admin/menu`                     | (無統一 toolbar,多個 Card 各自 fit)                       | —               | —        |

> 數字是基於目前的 className 在 1440 × 900 desktop 下的實際渲染。若 className 改了(例如 padding 變大),需重測。

### 4.3 表格 Card 內可見列數估算(row 高 ≈ 44 px)

```
Card 淨高 = 790 − toolbar − 2 × gap − CardContent padding ≈ 上述欄位
可見列數 = Card 淨高 / 44
```

| 頁面 | 預估可見列數 |
|---:|---:|
| `/auction/announcements` | **≈ 14 列** |
| `/auction/my-bids` | **≈ 16 列** |
| `/basics/stock-codes` | **≈ 14 列** |
| `/basics/brokers` | **≈ 15 列** |
| `/watchlist`(最多 50 筆) | **≈ 16 列**,不會滾動 |

> 這只是估算。**不要 hardcode 表格高度**;讓 flex 自動計算實際可視列數,並驗收。

### 4.4 高度示意

```
┌──────────────────────────────────────────────────┐ shell: h-screen
│ Header (60)                                       │
├──────────────────────────────────────────────────┤
│ main (790)                                        │
│  └ <div h-full flex flex-col p-4 md:p-6 gap-4>    │
│     ├─ toolbar       (shrink-0)                   │
│     ├─ filters/tool  (shrink-0)                   │
│     ├─ loading/empty (shrink-0, natural height)   │
│     └─ <Card flex-1 min-h-0 gap-0 overflow-hidden>│
│        └ <CardContent p-0 flex-1 min-h-0 flex-col>│
│           ├─ <div overflow-auto flex-1 min-h-0>   │ ← Y 滾動區
│           │  ├─ <thead sticky top-0 bg-card>      │ ← thead 永遠在頂
│           │  └─ <tbody> ...                       │
│           └─ <div shrink-0 border-t> 分頁         │
├──────────────────────────────────────────────────┤
│ Footer (50)                                       │
└──────────────────────────────────────────────────┘
```

### 4.5 為什麼「不用 hardcode 高度」是關鍵

假設你寫 `<div className="h-[500px] overflow-y-auto">`,後果:
- 視口 800 × 600 → 500 太擠,擋到 footer
- 視口 2560 × 1440 → 500 太矮,浪費空間
- Tauri window resize → 不會跟著更新

改用 `<div className="h-full flex flex-col"><div className="flex-1 min-h-0 overflow-auto">`:
- 任何視口下「表格 Card 自動吃滿」可用空間
- 不需要 resize listener
- 跨環境(Iframe / Tauri / 瀏覽器)行為一致

唯一例外:`<iframe>` 內嵌的場景如果需要絕對高度(嵌入方指定 iframe height = X),因為 `<iframe>` 本身是 fixed-height,main 才是 790 的概念會變成「iframe height − 110」。這種場景下,Table flex 還是有用(自動填滿 iframe 內的 main),所以不用 hardcode。

---

## 五、分頁(計算筆數)

### 5.1 為什麼有些頁有分頁、有些沒有

| 頁面 | 資料量 | 分頁? | 每頁筆數 (ITEMS_PER_PAGE) |
|---|---:|:---:|---:|
| `/auction/announcements` | ~500/年 | ✅ | **20** |
| `/auction/my-bids` | ≤ 50(設計上限) | ❌ 全部列出 | — |
| `/basics/stock-codes` | **1845** | ✅ | **50** |
| `/basics/brokers` | **1010** | ❌ 全列(獨立滾動) | — |
| `/watchlist` | ≤ **50**(系統上限) | ❌ 全列(獨立滾動) | — |
| `/admin/menu` | 取決 menu 數量 | ❌ 全列(獨立滾動) | — |

> 「分頁 vs 獨立滾動」的選擇:
> - **靜態、總量小的資料** (< 100 列,例 watchlist/my-bids):不分頁,直接全列。
> - **可下鑽的列表** (例 stock-codes 一列可進 `basics/company/[symbol]`):分頁,因為使用者不太可能滾 1845 列。
> - **大量但每列簡單** (例 brokers 1010 列 5 欄):不分頁,獨立滾動更快(因為「下一頁」又要重 fetch)。

### 5.2 分頁計算公式

```ts
const total = filtered.length
const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1
const slice = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
```

顯示文字:
```ts
顯示 {(page - 1) * ITEMS_PER_PAGE + 1} 至 {Math.min(page * ITEMS_PER_PAGE, total)} 筆,共 {total} 筆
第 {page} / {totalPages} 頁
```

### 5.3 為什麼 stock-codes 是 50 / 競拍是 20?

- **stock-codes (50)** 每列簡單(8 欄含 ISIN/產業/狀態),且「不需點進個股觀看歷史」時 50 列一批是好體驗。
- **競拍 (20)** 13 欄含多個 `text-right` 數字與中文日期,每列 44 px 以上,每頁 20 列 = 880-1000 px 表格高 — 獨立滾動下大概能看到一半左右就 pagination;看完整個分頁的「下一頁」點擊率會增加。

**規則**:每頁筆數 × 每列高 ≈ viewport 高度的 0.7-1.5 倍最舒服(讓使用者一次能看到 1-2 頁、且「看完想換頁」的機率低)。

---

## 六、結構範本(每個非首頁頁面照抄)

```tsx
export default function XxxPage() {
  // ...hooks...

  return (
    <AppShell title="頁面標題">
      <div className="h-full flex flex-col p-4 md:p-6 gap-4 md:gap-6">

        {/* 1. 固定頂部:標題旁的「共 N 筆」+ 主動作 */}
        <div className="shrink-0 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">共 N 筆</p>
          {/* 新增、返回等 DialogTrigger 或 Link Button */}
        </div>

        {/* 2. 固定頂部:次要工具(篩選 Tabs、搜尋 Input) */}
        <div className="shrink-0 flex flex-col md:flex-row gap-4">
          <Tabs>...</Tabs>
          <Input placeholder="搜尋..." className="md:w-72" />
        </div>

        {/* 3. 三種狀態:獨立 Card,自然高度,不會撐爆 */}
        {error && !loading && (
          <Card className="shrink-0 border-destructive">...</Card>
        )}
        {loading && !error && (
          <Card className="shrink-0">... Skeleton ...</Card>
        )}
        {!loading && !error && items.length === 0 && (
          <Card className="shrink-0">... empty ...</Card>
        )}

        {/* 4. 主表格 Card:撐滿剩餘高度 */}
        {!loading && !error && items.length > 0 && (
          <Card className="flex-1 min-h-0 gap-0 overflow-hidden">
            <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
              <div className="overflow-auto flex-1 min-h-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>...</TableHead>
                      {/* thead 預設 sticky (見 §7) */}
                    </TableRow>
                  </TableHeader>
                  <TableBody>{items.map(...)}</TableBody>
                </Table>
              </div>
              <div className="shrink-0 border-t px-4 py-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">顯示 X 至 Y 筆,共 Z 筆</p>
                <div className="flex gap-2">
                  <Button>上一頁</Button>
                  <span>第 N / M 頁</span>
                  <Button>下一頁</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
```

---

## 七、表頭 sticky 怎麼生效(以及誰會破壞它)

### 7.1 CSS Sticky 行為

`position: sticky; top: 0` 會把元素黏在「**最近的 scroll container 的 top**」,而不是 viewport 的 top。

關鍵:**scroll container 是「`overflow` 非 `visible` 的祖先」**。對於大多數布局是 `<html>` 或 `<body>`。

### 7.2 為什麼 `<Table>` wrapper 不能是 `overflow-x: auto`

shadcn `<Table>` 元件原本的 wrapper 是 `<div className="relative w-full overflow-x-auto">`。當 table 寬於父容器時,wrapper 自己就是 scroll container(X 軸)。

如果同一個 wrapper 也是 `<thead>` 的最近 scroll 祖先,thead 的 `sticky top-0` 會黏到這個 wrapper 的頂部 — 但這個 wrapper 因為內容剛好 = table 高度,**不會 scroll**,所以 sticky 看起來「沒效果」。

**修正**:`<Table>` wrapper 移除 `overflow-x-auto`,改為 `overflow-visible`。X 滾動透過外層的 `.overflow-auto flex-1 min-h-0` 統一處理(`overflow-auto` 同時作用 X + Y)。

### 7.3 預設樣式

| 元件 | 加上什麼 |
|---|---|
| `TableHeader` (`<thead>`) | `sticky top-0 z-20 bg-card shadow-sm` |
| `Table` wrapper | 移除預設 `overflow-x-auto` |
| Page 外層 | `<CardContent className="overflow-auto flex-1 min-h-0">` |

`shadow-sm` 提供「表頭浮起」的視覺提示;`z-20` 確保 thead 不被 Card 其他元素遮住;`bg-card` 避免後面的 row 內容透出。

---

## 八、品質驗收(Playwright 7 項)

每個非首頁頁面都必須通過以下 7 項檢查(`scripts/check-page-quality.mjs --sticky-test`):

| # | 檢查 | 通過條件 |
|---|---|---|
| 1 | Header title 與 `<AppShell title>` 一致 | `<header h1>` 文字 === 傳入值 |
| 2 | `<main>` 內沒有 visible `<h1>` | sr-only 排除 |
| 3 | Main 內容不溢位 | `main.scrollHeight ≤ main.clientHeight + 1` |
| 4 | Footer 在 viewport 內 | `footer.bottom ≤ window.innerHeight` |
| 5 | Footer 不被 main 內容覆蓋 | `footer.top ≥ main.bottom` |
| 6 | 無 console error | page console error === 0 |
| 7 | Sticky thead | scroll 滾動區 240 px 後,`<thead>` 與滾動區 `top` 距離 < 4 px |

### 跑驗收指令

```bash
# 一般頁面
node scripts/check-page-quality.mjs <path> <expectedTitle> --shot --sticky-test

# 範例
node scripts/check-page-quality.mjs /basics/stock-codes 證券代號查詢 --shot --sticky-test

# 需 localStorage 預設資料的頁(如 /auction/my-bids 有資料版)
node scripts/check-page-quality-seeded.mjs /auction/my-bids 我的競拍 \
  --shot --sticky-test \
  --seed-aistock-my-auction-bids='[{...JSON...}]'
```

`--shot` 把視窗截圖存到 `qa-shots/<path>.png`。

### 8.1 沒資料的頁面怎麼辦?

`empty` Card 狀態沒有表格,所以第 7 項自動 skip(顯示 "skipped")。這是預期行為,不視為 fail。

但仍要驗 `loader` / `empty` / `error` 三狀態的 Card 排版不破壞 layout — 手動開瀏覽器看、或用 playwright 模擬 network 失敗。

---

## 九、共用元件異動

### 9.1 `src/components/ui/table.tsx`

| 元件 | 變更 | 為什麼 |
|---|---|---|
| `Table` | wrapper className 從 `overflow-x-auto` 移除 | 避免變成 sticky 滾動容器 |
| `TableHeader` | 加 `sticky top-0 z-20 bg-card shadow-sm` | 表頭自動 sticky |
| `Table` className prop 行為 | 從 inner `<table>` 移到 outer div | 因為現在沒有任何 page 傳 className,所以沒 breaking change |

### 9.2 `src/components/app-shell.tsx`

- `title` prop 已實作 → Header 顯示。
- 結構沒變:`h-screen flex flex-col` + 左 sidebar + main + 右 sidebar + Footer。

---

## 十、反模式(PR review 時擋掉)

| 反模式 | 為什麼錯 |
|---|---|
| 頁內放 `<h1>頁面標題</h1>` | 跟 Header 重複,浪費垂直空間 |
| Outer container 寫 `max-w-6xl mx-auto` | 限制寬度讓資料擠在一起不易讀(應全頁寬) |
| `<main>` 自己 `overflow-visible` | 內容會推開 footer,失去 footer 保護 |
| Card 設 `flex-1` 但沒 `min-h-0` | flex item 預設 min-h 是 auto,會被內容撐破 |
| 用 `position: fixed` 固定分頁按鈕 | 跟 sticky thead 結構衝突;改用 `shrink-0` 在 flex 結構內 |
| `<table>` 上加 `min-w-[1200px]` | 會需要 X 滾動,sticky Y 會跟著失效 |
| `if (rows.length) show table else show error` 寫在同一個 Card 內 | error 狀態無法 flex 計算高度,需分開兩個 Card |
| 直接寫 `h-[600px] overflow-auto` | hardcode 高度,跨 viewport / 跨環境會壞 |

---

## 十一、對應到的檔案

| 檔案                                                       | 角色 |
|---|---|
| `frontend/src/components/app-shell.tsx`                    | title → Header 傳遞、整體 layout |
| `frontend/src/components/header.tsx`                       | 顯示 title 與全局右側 actions |
| `frontend/src/components/footer.tsx`                       | 底部狀態列(API/WS/時間) |
| `frontend/src/components/ui/table.tsx`                     | sticky thead + no overflow-x wrapper |
| `frontend/src/app/auction/announcements/page.tsx`          | 範例(共 638 px Card 淨高) |
| `frontend/src/app/auction/my-bids/page.tsx`                | 範例(空/有資料切換) |
| `frontend/src/app/basics/stock-codes/page.tsx`             | 範例(Tabs + 1845 列、50/頁) |
| `frontend/src/app/basics/brokers/page.tsx`                 | 範例(1010 列無分頁) |
| `frontend/src/app/watchlist/page.tsx` + `watchlist-manager` | 範例(compact / full 變體) |
| `frontend/src/app/admin/menu/page.tsx`                     | 範例(多 Card 自適應) |
| `frontend/iframe/`                                          | **未採用**的備用 config-driven 框架 |
| `frontend/scripts/check-page-quality.mjs`                   | 7 項 Playwright 檢查 |
| `frontend/scripts/check-page-quality-seeded.mjs`            | 7 項 + localStorage 預設 |
| `.docs/cache-strategy.md`                                   | 姊妹文件:ArangoDB + IndexedDB 快取策略 |

---

## 十二、更新紀錄

| 日期 | 變更 | 原因 |
|---|---|---|
| 2026-07-08 | 新增 `.docs/LAYOUT_GUIDE.md` | 處理 1845 列 stock-codes 蓋過 footer、`auction/announcements` 看不到分頁按鈕問題;統一 Title 位置 |
| 2026-07-08 | `<Table>` 加預設 sticky thead | 滾動資料時欄位標題不見 |
| 2026-07-08 | 加 `check-page-quality.mjs` 7 項驗收 | 把 layout 規範化、可被 CI / pre-commit 跑 |
