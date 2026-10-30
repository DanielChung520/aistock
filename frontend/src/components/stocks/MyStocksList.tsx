'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Plus, TrendingUp, TrendingDown } from 'lucide-react'
import { useWatchlistModal } from '@/lib/watchlist-modal-context'
import { useStockTabs } from '@/lib/stock-tab-context'

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
  prevClose: number
  prevVolume: number
  aiAnalysis: string
  suggestionAction: '買進' | '賣出' | '觀望' | '暫持'
  suggestionPrice: number | null
}

// ── Mock data pools (deterministic per stock_id) ──────────────────

const ANALYSIS_POOL = [
  '三盤跌破',
  'KD黃金交叉',
  'KD死亡交叉',
  '均線糾結',
  '出量突破',
  '帶量上攻',
  '量縮價跌',
  '布林觸頂',
  '布林觸底',
  'MACD黃金交叉',
  'MACD死亡交叉',
  'W底成型',
  'M頭成型',
  '突破前高',
  '跌破支撐',
]

const SUGGESTION_ACTIONS: { action: MyStockItem['suggestionAction']; label: string; css: string }[] = [
  { action: '買進', label: '買進', css: 'text-red-500' },
  { action: '賣出', label: '賣出', css: 'text-green-500' },
  { action: '觀望', label: '觀望', css: 'text-muted-foreground' },
  { action: '暫持', label: '暫持', css: 'text-amber-500' },
]

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function pickSeeded<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

function generateMock(seed: number, close: number) {
  const rng = seededRandom(seed)
  const aiAnalysis = pickSeeded(ANALYSIS_POOL, rng)
  const action = pickSeeded(SUGGESTION_ACTIONS, rng)
  const offset =
    action.action === '買進'
      ? close * (0.98 + rng() * 0.03)
      : action.action === '賣出'
        ? close * (0.97 + rng() * 0.03)
        : null
  const suggestionPrice = offset !== null ? Number(offset.toFixed(2)) : null
  return { aiAnalysis, suggestionAction: action.action, suggestionPrice }
}

function formatVolume(v: number) {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(2)}億`
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}萬`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toString()
}

export function MyStocksList({ onSelect }: MyStockListProps = {}) {
  const { open: openWatchlistModal, isOpen: isWatchlistOpen } = useWatchlistModal()
  const { openTab } = useStockTabs()
  const [stocks, setStocks] = useState<MyStockItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [streamConnected, setStreamConnected] = useState(false)

  // Refresh when watchlist modal closes
  const prevOpen = useRef(isWatchlistOpen)
  useEffect(() => {
    if (prevOpen.current && !isWatchlistOpen) setRefreshKey(k => k + 1)
    prevOpen.current = isWatchlistOpen
  }, [isWatchlistOpen])

  // Also poll every 30s to catch changes (fallback when the live stream is down)
  useEffect(() => {
    if (!refreshKey || streamConnected) return
    const t = setInterval(() => setRefreshKey(k => k + 1), 30000)
    return () => clearInterval(t)
  }, [refreshKey, streamConnected])

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
          async (item: { stock_id: string; name?: string }, idx: number) => {
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

                const seed = item.stock_id
                  .split('')
                  .reduce((acc, c) => acc + c.charCodeAt(0), 0)
                const mock = generateMock(seed + idx, close)

                return {
                  stock_id: item.stock_id,
                  name: item.name || item.stock_id,
                  close,
                  change,
                  changePercent,
                  volume,
                  volumeChangePercent,
                  prevClose: previous.close,
                  prevVolume: previousVolume,
                  ...mock,
                }
              }
            } catch {
              /* ignore fetch error for individual stock */
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
  }, [refreshKey])

  const symbolsKey = stocks.map((s) => s.stock_id).join(',')

  useEffect(() => {
    if (!symbolsKey) return
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/watchlist/stream?symbols=${encodeURIComponent(symbolsKey)}`)

    source.onopen = () => setStreamConnected(true)
    source.onerror = () => setStreamConnected(false)
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          quotes?: Record<string, { close: number; volume: number }>
        }
        const quotes = payload.quotes
        if (!quotes) return
        setStocks((prev) =>
          prev.map((item) => {
            const quote = quotes[item.stock_id]
            if (!quote) return item
            const change = quote.close - item.prevClose
            return {
              ...item,
              close: quote.close,
              change,
              changePercent: item.prevClose !== 0 ? (change / item.prevClose) * 100 : 0,
              volume: quote.volume,
              volumeChangePercent:
                item.prevVolume !== 0 ? ((quote.volume - item.prevVolume) / item.prevVolume) * 100 : 0,
            }
          }),
        )
      } catch (error) {
        console.error('Failed to parse watchlist stream event:', error)
      }
    }

    return () => {
      source.close()
      setStreamConnected(false)
    }
  }, [symbolsKey])

  const renderSkeleton = () => (
    <div className="space-y-3 px-4 pb-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="py-2">
          <div className="grid grid-cols-5 gap-1">
            <Skeleton className="h-8 bg-muted col-span-2" />
            <Skeleton className="h-8 bg-muted" />
            <Skeleton className="h-8 bg-muted" />
            <Skeleton className="h-8 bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )

  const renderEmpty = () => (
    <div className="text-center py-10 px-4">
      <p className="text-muted-foreground text-sm mb-3">尚未加入任何股票</p>
      <Link
        href="/watchlist"
        className="text-sm text-blue-500 hover:underline"
      >
        前往新增
      </Link>
    </div>
  )

  const renderStock = (stock: MyStockItem) => {
    const isUp = stock.change > 0
    const isDown = stock.change < 0
    const colorClass = isUp
      ? 'text-red-500'
      : isDown
        ? 'text-green-500'
        : 'text-muted-foreground'
    const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null

    const volumeIsUp = stock.volumeChangePercent > 0
    const volumeIsDown = stock.volumeChangePercent < 0
    const volumeColorClass = volumeIsUp
      ? 'text-red-500'
      : volumeIsDown
        ? 'text-green-500'
        : 'text-muted-foreground'
    const VolumeIcon = volumeIsUp ? TrendingUp : volumeIsDown ? TrendingDown : null

    const suggestionMeta = SUGGESTION_ACTIONS.find(
      (s) => s.action === stock.suggestionAction,
    )

    const content = (
      <div className="w-full">
        {/* 5-column grid: each column has 2 rows stacked vertically */}
        <div className="grid grid-cols-5 gap-x-1">
          {/* ── Column 1: 第一欄 (stock_id / name) ── */}
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold text-foreground leading-tight">
              {stock.stock_id}
            </div>
            <div className="text-[11px] text-muted-foreground truncate leading-tight mt-1">
              {stock.name}
            </div>
          </div>

          {/* ── Column 2: 成交量 (量 / 增減幅) ── */}
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground leading-tight">
              量 {formatVolume(stock.volume)}
            </div>
            <div className={cn('flex items-center gap-0.5 text-[11px] leading-tight mt-1', volumeColorClass)}>
              {VolumeIcon && <VolumeIcon className="h-3 w-3 shrink-0" />}
              <span>
                {volumeIsUp ? '+' : volumeIsDown ? '' : ''}
                {stock.volumeChangePercent.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* ── Column 3: 成交價 (price / 漲跌幅) ── */}
          <div className="text-right min-w-0">
            <div className={cn('text-xs font-semibold tabular-nums leading-tight', colorClass)}>
              {stock.close.toFixed(2)}
            </div>
            <div className={cn('flex items-center justify-end gap-0.5 text-[11px] leading-tight mt-1', colorClass)}>
              {Icon && <Icon className="h-3 w-3 shrink-0" />}
              <span>
                {stock.changePercent > 0 ? '+' : ''}
                {stock.changePercent.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* ── Column 4: AI分析 (text / 空白) ── */}
          <div className="text-right min-w-0">
            <div className="text-[11px] font-medium text-foreground leading-tight">
              {stock.aiAnalysis}
            </div>
            <div className="text-[11px] leading-tight mt-1">&nbsp;</div>
          </div>

          {/* ── Column 5: 建議操作 (價格 / 動作) ── */}
          <div className="text-right min-w-0">
            <div className="text-[11px] font-semibold tabular-nums leading-tight">
              {stock.suggestionPrice !== null ? stock.suggestionPrice : '—'}
            </div>
            <div className={cn('text-[11px] font-medium leading-tight mt-1', suggestionMeta?.css)}>
              {stock.suggestionAction}
            </div>
          </div>
        </div>
      </div>
    )

    if (onSelect) {
      return (
        <button
          key={stock.stock_id}
          onClick={() => onSelect(stock.stock_id, stock.name)}
          className="flex w-full items-center px-4 py-2.5 hover:bg-muted/40 transition-colors text-left border-b border-border/50 last:border-b-0"
        >
          {content}
        </button>
      )
    }

    return (
      <button
        key={stock.stock_id}
        onClick={() => openTab(stock.stock_id, stock.name)}
        className="flex w-full items-center px-4 py-2.5 hover:bg-muted/40 transition-colors text-left border-b border-border/50 last:border-b-0"
      >
        {content}
      </button>
    )
  }

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
          renderSkeleton()
        ) : stocks.length === 0 ? (
          renderEmpty()
        ) : (
          <div>
            {/* Column header: 5 columns */}
            <div className="grid grid-cols-5 gap-x-1 px-4 py-1.5 border-b border-border/50">
              <span className="text-[10px] text-muted-foreground font-medium">股票</span>
              <span className="text-[10px] text-muted-foreground font-medium">成交量</span>
              <span className="text-[10px] text-muted-foreground font-medium text-right">成交價</span>
              <span className="text-[10px] text-muted-foreground font-medium text-right">AI分析</span>
              <span className="text-[10px] text-muted-foreground font-medium text-right">建議操作</span>
            </div>
            {/* Stock list */}
            <div>
              {stocks.map((stock) => renderStock(stock))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
