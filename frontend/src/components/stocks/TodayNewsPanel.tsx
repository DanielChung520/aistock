'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Newspaper, ExternalLink, Settings2, Clock, Tag, Lightbulb } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface NewsItem {
  symbol: string
  stock_name: string
  title: string
  summary: string
  source: string
  url: string
  published_at: string
}

interface NewsResponse {
  updated_at: string
  news: NewsItem[]
  symbols: string[]
  source: string
}

interface TodayNewsPanelProps {
  watchlistSymbols?: string[]
  onSelectStock?: (symbol: string, name: string) => void
  className?: string
}

export function TodayNewsPanel({ watchlistSymbols = [], onSelectStock, className }: TodayNewsPanelProps) {
  const [data, setData] = useState<NewsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchNews() {
      try {
        setLoading(true)
        const symbols = watchlistSymbols.join(',')
        const url = `/api/news/today${symbols ? `?symbols=${encodeURIComponent(symbols)}` : ''}`
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`News API failed: ${resp.status}`)
        const json = (await resp.json()) as NewsResponse
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchNews()
    return () => {
      cancelled = true
    }
  }, [watchlistSymbols.join(',')])

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return '--:--'
    }
  }

  return (
    <Card className={cn('h-full flex flex-col border-border bg-card/50 backdrop-blur-sm shadow-sm', className)}>
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="text-lg font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Newspaper className="h-4 w-4" />
            今日消息
          </span>
          <button className="text-muted-foreground hover:text-foreground transition-colors" title="設定">
            <Settings2 className="h-4 w-4" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-hidden">
        {/* AI 摘要 - 上半部 (40%) */}
        <div className="basis-2/5 min-h-0 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 p-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
            <Sparkles className="h-3.5 w-3.5" />
            AI 解析摘要
            <span className="ml-auto text-[10px] text-muted-foreground font-normal">mock</span>
          </div>
          <div className="text-xs text-foreground/90 leading-relaxed flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-4/6" />
              </div>
            ) : data?.news.length ? (
              <>
                <div className="font-medium mb-1">市場概覽</div>
                <ul className="space-y-1 list-disc list-inside text-muted-foreground">
                  <li>半導體類股今日聚焦台積電 Q2 法說，3奈米製程需求超預期</li>
                  <li>聯發科天璣 9400 預計採用 3奈米，下半年出貨動能強勁</li>
                  <li>AI 伺服器供應鏈持續受惠，鴻海 GB200 產線將於 Q4 量產</li>
                </ul>
                <div className="mt-2 text-[10px] text-muted-foreground/70 italic">
                  此為示意內容，AI 摘要功能尚未連接 LLM
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">無可用新聞資料</span>
            )}
          </div>
        </div>

        {/* 新聞列表 - 下半部 (60%) */}
        <div className="basis-3/5 min-h-0 flex flex-col">
          <div className="text-xs font-medium text-muted-foreground mb-1.5 px-1 flex items-center justify-between">
            <span>新聞 ({data?.news.length ?? 0})</span>
            {data?.symbols && data.symbols.length > 0 && (
              <span className="text-[10px]">關注：{data.symbols.slice(0, 3).join(', ')}{data.symbols.length > 3 ? ` +${data.symbols.length - 3}` : ''}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {loading ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="space-y-1 p-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))
            ) : error ? (
              <div className="text-xs text-red-400 p-2">載入失敗：{error}</div>
            ) : data?.news.length === 0 ? (
              <div className="text-xs text-muted-foreground p-2 text-center">目前沒有相關新聞</div>
            ) : (
              data?.news.map((n, i) => (
                <button
                  key={`${n.symbol}-${i}`}
                  onClick={() => onSelectStock?.(n.symbol, n.stock_name)}
                  className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
                >
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-foreground/80">{n.symbol}</span>
                      <span>{n.stock_name}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTime(n.published_at)}
                    </span>
                  </div>
                  <div className="text-xs font-medium leading-snug line-clamp-2 mb-0.5">{n.title}</div>
                  <div className="text-[10px] text-muted-foreground line-clamp-2">{n.summary}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Footer - 設定狀態 */}
        <div className="shrink-0 pt-2 border-t border-border text-[10px] text-muted-foreground flex items-center justify-between gap-2">
          <span className="flex items-center gap-1" title="最後更新">
            <Clock className="h-3 w-3" />
            {data?.updated_at ? formatTime(data.updated_at) : '--:--'}
          </span>
          <span className="flex items-center gap-1" title="關鍵字">
            <Tag className="h-3 w-3" />
            {watchlistSymbols.length || 0} 關鍵
          </span>
          <span className="flex items-center gap-1" title="資料來源">
            <Lightbulb className="h-3 w-3" />
            {data?.source === 'finmind' ? 'FinMind' : 'mock'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
