'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Search, RefreshCw } from 'lucide-react'
import { useStockCatalog } from '@/hooks/use-stock-catalog'
import { invalidate } from '@/lib/cache/cache-fetch'
import { makeCacheKey } from '@/lib/cache/cache-keys'

export interface TickerSearchProps {
  onSelect: (stock: { stock_id: string; name: string }) => void
  placeholder?: string
  className?: string
}

export function TickerSearch({ onSelect, placeholder = '搜尋股票代碼或名稱...', className }: TickerSearchProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { items, isLoading, error, storedAt, search, refresh } = useStockCatalog()

  // Pure in-memory search (no network)
  const results = useMemo(() => {
    if (!query.trim()) return []
    return search(query, 30)
  }, [query, search])

  // Open dropdown when we have results
  useEffect(() => {
    if (results.length > 0) setIsOpen(true)
  }, [results])

  // Click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (stock: { stock_id: string; name: string }) => {
    setQuery('')
    setIsOpen(false)
    onSelect(stock)
  }

  const handleRefresh = async () => {
    await invalidate(makeCacheKey('stock-catalog'))
    await refresh()
  }

  const catalogAge = storedAt > 0
    ? Math.round((Date.now() - storedAt) / 1000 / 60) // minutes
    : null

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true)
          }}
          placeholder={isLoading ? '股票清單載入中…' : placeholder}
          disabled={isLoading}
          className="pl-9 pr-9"
        />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-50"
          title={catalogAge != null ? `快取 ${catalogAge} 分鐘前，按此刷新` : '重新載入股票清單'}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </button>
      </div>

      {isOpen && !isLoading && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-y-auto">
          {error ? (
            <div className="p-4 text-sm text-center text-destructive">
              載入股票清單失敗：{error}
            </div>
          ) : results.length > 0 ? (
            <ul className="py-1">
              {results.map((stock) => (
                <li
                  key={stock.code}
                  className="px-4 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                  onClick={() => handleSelect({ stock_id: stock.code, name: stock.name })}
                >
                  <span className="font-semibold font-mono w-16 shrink-0">{stock.code}</span>
                  <span className="flex-1 truncate">{stock.name}</span>
                  {stock.market && (
                    <span className="text-xs text-muted-foreground">{stock.market}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-sm text-center text-muted-foreground">
              找不到「{query}」相關股票
            </div>
          )}
        </div>
      )}
    </div>
  )
}
