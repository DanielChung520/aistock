'use client'

import { X, Home } from 'lucide-react'
import { useTabs } from '../lib/tabs'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export interface PageTabsBarProps {
  className?: string
}

export function PageTabsBar({ className }: PageTabsBarProps) {
  const { tabs, activeTabId, setActiveTab, closeTab, homeTitle } = useTabs()

  return (
    <div
      className={cn(
        'h-10 border-b border-border bg-card/40 backdrop-blur-sm flex items-center px-2 gap-1 shrink-0',
        className,
      )}
    >
      <button
        onClick={() => setActiveTab(null)}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors',
          activeTabId === null
            ? 'bg-card text-foreground border border-border shadow-sm'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
        title="首頁"
      >
        <Home className="h-3.5 w-3.5" />
        <span>{homeTitle}</span>
      </button>

      {tabs.length > 0 && (
        <>
          <div className="h-5 w-px bg-border mx-0.5" />
          <ScrollArea className="flex-1 whitespace-nowrap">
            <div className="flex gap-1">
              {tabs.map((tab) => {
                const isActive = activeTabId === tab.id
                return (
                  <div
                    key={tab.id}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs cursor-pointer select-none transition-colors border',
                      isActive
                        ? 'bg-card text-foreground border-border shadow-sm'
                        : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 border-transparent',
                    )}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span className="font-mono">{tab.id}</span>
                    <span className="truncate max-w-[80px]">{tab.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.id)
                      }}
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
