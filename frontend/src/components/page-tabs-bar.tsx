'use client'

import { X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useStockTabs } from '@/lib/stock-tab-context'
import { usePageTabs } from '@/lib/page-tab-context'
import { FUNCTION_PAGES, HOME_ROUTE, type FunctionPage } from '@/lib/page-tabs'
import { cn } from '@/lib/utils'
import appConfig from '@/config/app.json'

export function PageTabsBar() {
  const { tabs, activeTab, setActiveTab, closeTab } = useStockTabs()
  const { pinnedRoutes, pinPage, unpinPage } = usePageTabs()
  const pathname = usePathname()
  const router = useRouter()

  const visiblePages = FUNCTION_PAGES.filter((p) => pinnedRoutes.includes(p.route))

  const handleFunctionClick = (page: FunctionPage) => {
    if (page.route === HOME_ROUTE) {
      if (pathname === HOME_ROUTE) {
        setActiveTab(null)
      } else {
        router.push(HOME_ROUTE)
      }
    } else {
      router.push(page.route)
    }
  }

  const handleClosePage = (page: FunctionPage) => {
    unpinPage(page.route)
    if (pathname === page.route) {
      router.push(HOME_ROUTE)
    }
  }

  return (
    <div className="h-10 border-b border-border bg-card/40 backdrop-blur-sm flex items-center px-2 gap-1 shrink-0">
      <img
        src={appConfig.logo.src}
        alt={appConfig.logo.alt}
        style={{ height: appConfig.logo.height }}
        className="object-contain shrink-0"
      />
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap pr-2">
        {appConfig.system.name}
      </span>
      <div className="h-5 w-px bg-border mx-0.5" />

      <ScrollArea className="flex-1 whitespace-nowrap">
        <div className="flex gap-1">
          {visiblePages.map((page) => {
            const isActive =
              page.route === HOME_ROUTE
                ? pathname === HOME_ROUTE && activeTab === null
                : pathname === page.route
            const canClose = page.route !== HOME_ROUTE
            const Icon = page.icon
            return (
              <div
                key={page.route}
                onClick={() => handleFunctionClick(page)}
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium cursor-pointer select-none transition-colors border',
                  isActive
                    ? 'bg-card text-foreground border border-border shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent',
                )}
                title={page.title}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{page.title}</span>
                {canClose && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleClosePage(page)
                    }}
                    className="ml-0.5 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                    title={`關閉「${page.title}」`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}

          {tabs.length > 0 && (
            <>
              <div className="h-5 w-px bg-border mx-0.5" />
              {tabs.map((tab) => {
                const isActive = activeTab === tab.symbol
                return (
                  <div
                    key={tab.symbol}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs cursor-pointer select-none transition-colors border',
                      isActive
                        ? 'bg-card text-foreground border border-border shadow-sm'
                        : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 border-transparent',
                    )}
                    onClick={() => setActiveTab(tab.symbol)}
                  >
                    <span className="font-mono">{tab.symbol}</span>
                    <span className="truncate max-w-[80px]">{tab.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.symbol) }}
                      className="ml-0.5 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                      title="關閉分頁"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </>
          )}
        </div>
        <ScrollBar orientation="horizontal" className="h-1" />
      </ScrollArea>
    </div>
  )
}
