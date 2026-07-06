'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Plus, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useWatchlistModal } from '@/lib/watchlist-modal-context'

interface MyStockListProps {
  onSelect?: (stockId: string, stockName: string) => void
}

interface MyStockItem {
  stock_id: string
  name: string
  close: number
  change: number
  changePercent: number
  volume: number
  volumeChangePercent: number
}

export function MyStocksList({ onSelect }: MyStockListProps = {}) {
  const { open: openWatchlistModal } = useWatchlistModal()
  const [stocks, setStocks] = useState<MyStockItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchMyStocks = async () => {
      try {
        const res = await fetch('/api/watchlist')
        if (!res.ok) throw new Error('Failed to fetch watchlist')

        const watchlistData = await res.json()
        if (!Array.isArray(watchlistData) || watchlistData.length === 0) {
          setStocks([])
          setIsLoading(false)
          return
        }

        const stockPromises = watchlistData.map(
          async (item: { stock_id: string; name?: string }) => {
            try {
              const historyRes = await fetch(
                `/api/stocks/${item.stock_id}/history?months=1`,
              )
              if (!historyRes.ok) return null
              const historyData = await historyRes.json()

              if (Array.isArray(historyData) && historyData.length > 0) {
                const latest = historyData[historyData.length - 1]
                const previous =
                  historyData.length > 1
                    ? historyData[historyData.length - 2]
                    : latest
                if (!latest.close || !previous.close) return null

                const close = latest.close
                const change = close - previous.close
                const changePercent =
                  previous.close !== 0 ? (change / previous.close) * 100 : 0

                const volume = latest.volume ?? 0
                const previousVolume = previous.volume ?? 0
                const volumeChangePercent =
                  previousVolume !== 0
                    ? ((volume - previousVolume) / previousVolume) * 100
                    : 0

                return {
                  stock_id: item.stock_id,
                  name: item.name || item.stock_id,
                  close,
                  change,
                  changePercent,
                  volume,
                  volumeChangePercent,
                }
              }
            } catch {
            }
            return null
          },
        )

        const results = await Promise.all(stockPromises)
        setStocks(
          results.filter((s): s is MyStockItem => s !== null),
        )
      } catch {
        setStocks([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchMyStocks()
  }, [])

  return (
    <Card className="h-full border-border bg-card/50 backdrop-blur-sm shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-medium flex items-center justify-between">
          <span>我的股票</span>
          <button
            type="button"
            onClick={openWatchlistModal}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            管理
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-1 px-4 pb-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between py-2.5">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-12 bg-muted" />
                  <Skeleton className="h-3 w-16 bg-muted" />
                </div>
                <div className="text-right space-y-1">
                  <Skeleton className="h-4 w-16 bg-muted" />
                  <Skeleton className="h-3 w-14 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <div className="text-center py-10 px-4">
            <p className="text-muted-foreground text-sm mb-3">尚未加入任何股票</p>
            <Link
              href="/watchlist"
              className="text-sm text-blue-500 hover:underline"
            >
              前往新增
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {stocks.map((stock) => {
              const isUp = stock.change > 0
              const isDown = stock.change < 0
              const colorClass = isUp
                ? 'text-red-500'
                : isDown
                  ? 'text-green-500'
                  : 'text-muted-foreground'
              const Icon = isUp
                ? TrendingUp
                : isDown
                  ? TrendingDown
                  : Minus

              const volumeColorClass = stock.volumeChangePercent > 0
                ? 'text-red-500'
                : stock.volumeChangePercent < 0
                  ? 'text-green-500'
                  : 'text-muted-foreground'

              const formatVolume = (v: number) => {
                if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(2)}億`
                if (v >= 10_000) return `${(v / 10_000).toFixed(1)}萬`
                if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
                return v.toString()
              }

              const content = (
                <div className="flex w-full items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        {stock.stock_id}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {stock.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>量 {formatVolume(stock.volume)}</span>
                      <span className={volumeColorClass}>
                        {stock.volumeChangePercent > 0 ? '+' : ''}
                        {stock.volumeChangePercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn('text-sm font-semibold tabular-nums', colorClass)}>
                      {stock.close.toFixed(2)}
                    </div>
                    <div className={cn('flex items-center justify-end gap-0.5 text-xs mt-1', colorClass)}>
                      <Icon className="h-3 w-3" />
                      {stock.changePercent > 0 ? '+' : ''}
                      {stock.changePercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
              )

              if (onSelect) {
                return (
                  <button
                    key={stock.stock_id}
                    onClick={() => onSelect(stock.stock_id, stock.name)}
                    className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                  >
                    {content}
                  </button>
                )
              }

              return (
                <Link
                  key={stock.stock_id}
                  href={`/stock/${stock.stock_id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  {content}
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
