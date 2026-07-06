import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { StockTabProvider } from '@/lib/stock-tab-context';
import { AIDrawerProvider } from '@/lib/ai-drawer-context';
import { MyStocksDrawerProvider } from '@/lib/my-stocks-drawer-context';

export const metadata: Metadata = {
  title: {
    default: 'aiStock | 台股分析平台',
    template: '%s | aiStock',
  },
  description: 'aiStock - AI 驅動的台股分析平台',
  keywords: ['aiStock', '台股', '股票分析', 'K線圖', '技術指標'],
  authors: [{ name: 'aiStock' }],
  generator: 'aiStock',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className={`antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {isDev && <Inspector />}
          <StockTabProvider>
            <AIDrawerProvider>
              <MyStocksDrawerProvider>
                {children}
              </MyStocksDrawerProvider>
            </AIDrawerProvider>
          </StockTabProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
