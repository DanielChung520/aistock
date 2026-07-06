'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Header } from '@/components/header'
import { SidebarNav } from '@/components/sidebar-nav'
import { PageTabsBar } from '@/components/page-tabs-bar'
import { RightSidebar } from '@/components/right-sidebar'
import { Footer } from '@/components/footer'
import { AIChatModal } from '@/components/ai-chat-modal'
import { MyStocksDrawer } from '@/components/my-stocks-drawer'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const pathname = usePathname()

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

      <div className="flex flex-1 min-h-0">
        <div className="hidden lg:block w-[60px] shrink-0 h-full">
          <SidebarNav className="h-full w-full" />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <Header onMenuClick={() => setMobileMenuOpen(true)} title={title} />
          <main className="flex-1 min-h-0 overflow-hidden">
            {children}
          </main>
          <Footer />
        </div>

        <div className="hidden lg:block h-full">
          <RightSidebar />
        </div>
      </div>

      <MyStocksDrawer />
      <AIChatModal />
    </div>
  )
}
