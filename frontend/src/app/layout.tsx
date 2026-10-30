import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { StockTabProvider } from '@/lib/stock-tab-context';
import { PageTabProvider } from '@/lib/page-tab-context';
import { AIDrawerProvider } from '@/lib/ai-drawer-context';
import { UpdateNotifier } from '@/components/update-notifier';
import { MyStocksDrawerProvider } from '@/lib/my-stocks-drawer-context';

export const metadata: Metadata = {
  title: {
    default: 'EEA - My AI Stock | 台股分析平台',
    template: '%s | EEA - My AI Stock',
  },
  description: 'EEA - My AI Stock - AI 驅動的台股分析平台',
  keywords: ['EEA', 'aiStock', '台股', '股票分析', 'K線圖', '技術指標'],
  authors: [{ name: 'EEA - My AI Stock' }],
  generator: 'EEA - My AI Stock',
  icons: {
    icon: [
      { url: '/favicon-light.png', type: 'image/png', media: '(prefers-color-scheme: light)' },
      { url: '/favicon-dark.png', type: 'image/png', media: '(prefers-color-scheme: dark)' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/favicon-light.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className={`antialiased`} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {isDev && <Inspector />}
          <StockTabProvider>
            <PageTabProvider>
              <AIDrawerProvider>
                <MyStocksDrawerProvider>
                  {children}
                  <UpdateNotifier />
                </MyStocksDrawerProvider>
              </AIDrawerProvider>
            </PageTabProvider>
          </StockTabProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
