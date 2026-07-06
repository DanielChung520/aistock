'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { StockDetailPanel } from './StockDetailPanel'
import { X } from 'lucide-react'

interface StockTab {
  symbol: string
  name: string
}

let globalOpenTab: ((symbol: string, name: string) => void) | null = null

export function openStockTab(symbol: string, name: string) {
  globalOpenTab?.(symbol, name)
}

export function StockTabs() {
  const [tabs, setTabs] = useState<StockTab[]>([])
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  const openTab = useCallback((symbol: string, name: string) => {
    setTabs((prev) => {
      const existing = prev.findIndex((t) => t.symbol === symbol)
      if (existing >= 0) {
        setActiveIndex(existing)
        return prev
      }
      setActiveIndex(prev.length)
      return [...prev, { symbol, name }]
    })
  }, [])

  globalOpenTab = openTab

  const closeTab = useCallback(
    (index: number) => {
      setTabs((prev) => {
        const next = prev.filter((_, i) => i !== index)
        if (next.length === 0) {
          setActiveIndex(-1)
        } else if (activeIndex >= next.length) {
          setActiveIndex(next.length - 1)
        } else if (activeIndex > index) {
          setActiveIndex(activeIndex - 1)
        }
        return next
      })
    },
    [activeIndex],
  )

  return (
    <div className="space-y-3">
      {tabs.length > 0 && (
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-0.5 pb-1">
            {tabs.map((tab, i) => (
              <div
                key={tab.symbol}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-md cursor-pointer select-none
                  transition-colors border border-border
                  ${i === activeIndex
                    ? 'bg-card text-foreground border-b-background'
                    : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 border-b-border'
                  }
                `}
                onClick={() => setActiveIndex(i)}
              >
                <span className="font-mono text-xs">{tab.symbol}</span>
                <span className="truncate max-w-[80px]">{tab.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 ml-0.5 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(i)
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="h-1.5" />
        </ScrollArea>
      )}

      {activeIndex >= 0 && activeIndex < tabs.length && (
        <div className="border border-border rounded-lg p-3 md:p-4 bg-card/30">
          <StockDetailPanel
            symbol={tabs[activeIndex].symbol}
            stockName={tabs[activeIndex].name}
            showHeader={false}
          />
        </div>
      )}
    </div>
  )
}
