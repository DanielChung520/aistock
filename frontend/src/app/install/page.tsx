const RELEASE_BASE =
  'https://github.com/DanielChung520/aistock/releases/download/v0.4.2'

const OFFERS = [
  {
    title: '離線自足版（推薦）',
    desc: '內建資料庫與後端，開機即用，不需依賴本網站。',
    files: [
      {
        name: 'Windows 安裝程式 (.exe)',
        url: `${RELEASE_BASE}/EEA.-.My.AI.Stock_0.4.2_x64_offline-setup.exe`,
        size: '307MB',
      },
      {
        name: 'Windows 企業部署 (.msi)',
        url: `${RELEASE_BASE}/EEA.-.My.AI.Stock_0.4.2_x64_offline.msi`,
        size: '438MB',
      },
    ],
  },
  {
    title: '線上版（輕量）',
    desc: '薄殼視窗，直接載入本網站（需可連線 stk.k84.org）。',
    files: [
      {
        name: 'Windows 安裝程式 (.exe)',
        url: `${RELEASE_BASE}/EEA.-.My.AI.Stock_0.4.2_x64-setup.exe`,
        size: '2MB',
      },
      {
        name: 'Windows 企業部署 (.msi)',
        url: `${RELEASE_BASE}/EEA.-.My.AI.Stock_0.4.2_x64_en-US.msi`,
        size: '3MB',
      },
    ],
  },
]

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">安裝下載</h1>
      <p className="text-muted-foreground">
        EEA - My AI Stock 台股分析平台桌面版。安裝檔未簽章，Windows
        SmartScreen 出現提示時請選擇「更多資訊 → 仍要執行」。
      </p>
      {OFFERS.map((offer) => (
        <section key={offer.title} className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold">{offer.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{offer.desc}</p>
          <ul className="mt-3 space-y-2">
            {offer.files.map((file) => (
              <li key={file.url}>
                <a
                  href={file.url}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  {file.name}
                  <span className="text-xs text-muted-foreground">
                    ({file.size})
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="rounded-lg border p-5 text-sm">
        <h2 className="text-lg font-semibold">安裝說明</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>下載 .exe 後雙擊執行，依精靈完成安裝。</li>
          <li>首次啟動會自動初始化本機資料庫（需網路抓取股票資料）。</li>
          <li>離線版不需連線本網站即可使用。</li>
        </ol>
      </section>
    </div>
  )
}
