'use client'

import { X, Home } from 'lucide-react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useStockTabs } from '@/lib/stock-tab-context'
import { cn } from '@/lib/utils'
import appConfig from '@/config/app.json'

export function PageTabsBar() {
  const { tabs, activeTab, setActiveTab, closeTab } = useStockTabs()

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

      <button
        onClick={() => setActiveTab(null)}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors',
          activeTab === null
            ? 'bg-card text-foreground border border-border shadow-sm'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
        title="首頁"
      >
        <Home className="h-3.5 w-3.5" />
        <span>首頁</span>
      </button>

      {tabs.length > 0 && (
        <>
          <div className="h-5 w-px bg-border mx-0.5" />
          <ScrollArea className="flex-1 whitespace-nowrap">
            <div className="flex gap-1">
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
            </div>
            <ScrollBar orientation="horizontal" className="h-1" />
          </ScrollArea>
        </>
      )}
    </div>
  )
}
