'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Header } from '@/components/header'
import { SidebarNav } from '@/components/sidebar-nav'
import { PageTabsBar } from '@/components/page-tabs-bar'
import { RightSidebar } from '@/components/right-sidebar'
import { Footer } from '@/components/footer'
import { AIChatModal } from '@/components/ai-chat-modal'
import { AIDrawer } from '@/components/ai-drawer'
import { MyStocksDrawer } from '@/components/my-stocks-drawer'
import { StrategyDrawer } from '@/components/strategy-drawer'
import { NotificationsDrawer } from '@/components/notifications-drawer'
import { WatchlistModal } from '@/components/watchlist-modal'
import { SystemSettingsModal } from '@/components/system-settings-modal'
import { ScheduleSettingsModal } from '@/components/schedule-settings-modal'
import { FeatureSettingsModal } from '@/components/feature-settings-modal'
import { WatchlistModalProvider } from '@/lib/watchlist-modal-context'
import { StrategyDrawerProvider } from '@/lib/strategy-drawer-context'
import { NotificationsDrawerProvider } from '@/lib/notifications-drawer-context'
import { useAIDrawer, AI_DRAWER_WIDTH } from '@/lib/ai-drawer-context'
import { useStockTabs } from '@/lib/stock-tab-context'
import { StockDetailPanel } from '@/components/stocks/StockDetailPanel'
import { SystemSettingsModalProvider, useSystemSettingsModal } from '@/lib/system-settings-modal-context'
import { ScheduleSettingsModalProvider, useScheduleSettingsModal } from '@/lib/schedule-settings-modal-context'
import { FeatureSettingsModalProvider, useFeatureSettingsModal } from '@/lib/feature-settings-modal-context'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'

function AppShellInner({ children, title }: { children: React.ReactNode; title?: string }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const pathname = usePathname()
  const { isOpen: settingsOpen, close: closeSettings } = useSystemSettingsModal()
  const { isOpen: scheduleOpen, close: closeSchedule } = useScheduleSettingsModal()
  const { isOpen: featuresOpen, close: closeFeatures } = useFeatureSettingsModal()
  const { isOpen: aiOpen, mode: aiMode } = useAIDrawer()
  const aiPushed = aiOpen && aiMode === 'drawer'
  const { tabs, activeTab } = useStockTabs()
  const activeStock = activeTab ? tabs.find((t) => t.symbol === activeTab) : null
  const headerTitle = activeStock ? `${activeStock.name}-${activeStock.symbol}` : title

  React.useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  return (
    <div className="relative h-screen flex flex-col bg-background overflow-hidden">
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-64 border-r-0 bg-[#1e2433]">
          <SheetTitle className="sr-only">導航選單</SheetTitle>
          <SheetDescription className="sr-only">網站導航選單</SheetDescription>
          <SidebarNav className="w-full h-full" onNavClick={() => setMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <PageTabsBar />

      <div
        className="flex flex-1 min-h-0 transition-[padding-right] duration-300 ease-out"
        style={{ paddingRight: aiPushed ? AI_DRAWER_WIDTH : 0 }}
      >
        <div className="hidden lg:block w-[60px] shrink-0 h-full">
          <SidebarNav className="h-full w-full" />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <Header onMenuClick={() => setMobileMenuOpen(true)} title={headerTitle} />
          <main className="flex-1 min-h-0 overflow-auto">
            {/* 首頁 tab 內容（功能頁）— 股票 tab 啟用時隱藏，但保持 mounted 以保留狀態 */}
            <div className={activeStock ? 'hidden' : 'h-full'}>{children}</div>
            {/* 股票圖表 tabs — 全部保持 mounted，僅顯示啟用者；關閉才銷毀 */}
            {tabs.map((tab) => (
              <div key={tab.symbol} className={activeTab === tab.symbol ? 'h-full' : 'hidden'}>
                <div className="p-4 md:p-6 max-w-[100vw] overflow-x-hidden h-full">
                  <StockDetailPanel symbol={tab.symbol} stockName={tab.name} showHeader={false} />
                </div>
              </div>
            ))}
          </main>
          <Footer />
        </div>

        <div className="hidden lg:block h-full">
          <RightSidebar />
        </div>
      </div>

      <MyStocksDrawer />
      <StrategyDrawer />
      <NotificationsDrawer />
      <AIDrawer />
      <AIChatModal />
      <WatchlistModal />
      <SystemSettingsModal isOpen={settingsOpen} onClose={closeSettings} />
      <ScheduleSettingsModal isOpen={scheduleOpen} onClose={closeSchedule} />
      <FeatureSettingsModal isOpen={featuresOpen} onClose={closeFeatures} />
    </div>
  )
}

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
      <StrategyDrawerProvider>
        <NotificationsDrawerProvider>
          <WatchlistModalProvider>
            <SystemSettingsModalProvider>
              <ScheduleSettingsModalProvider>
                <FeatureSettingsModalProvider>
                  <AppShellInner title={title}>{children}</AppShellInner>
                </FeatureSettingsModalProvider>
              </ScheduleSettingsModalProvider>
            </SystemSettingsModalProvider>
          </WatchlistModalProvider>
        </NotificationsDrawerProvider>
      </StrategyDrawerProvider>
  )
}
