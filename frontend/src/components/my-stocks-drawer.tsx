'use client'

import { useEffect } from 'react'
import { X, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MyStocksList } from '@/components/stocks/MyStocksList'
import { useMyStocksDrawer } from '@/lib/my-stocks-drawer-context'
import { cn } from '@/lib/utils'
import { useStockTabs } from '@/lib/stock-tab-context'

export function MyStocksDrawer() {
  const { isOpen, close } = useMyStocksDrawer()
  const { openTab } = useStockTabs()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  const handleSelect = (stockId: string, stockName: string) => {
    openTab(stockId, stockName)
    close()
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[99] bg-black/30 animate-in fade-in-0"
          onClick={close}
        />
      )}
      <aside
        className={cn(
          'fixed top-10 right-0 bottom-0 z-[100] w-[450px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="h-[60px] shrink-0 border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-amber-500 flex items-center justify-center">
              <Star className="h-4 w-4 text-white" fill="white" />
            </div>
            <div>
              <div className="text-sm font-semibold">我的股票</div>
              <div className="text-[10px] text-muted-foreground">自選股清單</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={close} title="關閉 (ESC)">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-hidden flex flex-col">
          <MyStocksList onSelect={handleSelect} />
        </div>
      </aside>
    </>
  )
}
