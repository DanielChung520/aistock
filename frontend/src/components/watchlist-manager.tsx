'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { TickerSearch } from '@/components/stocks/TickerSearch'
import { CompanyInfoModal } from '@/components/company-info-modal'
import { cachedFetch, invalidate } from '@/lib/cache/cache-fetch'
import { makeCacheKey } from '@/lib/cache/cache-keys'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Trash2, Eye, Star, X } from 'lucide-react'
import type { WatchlistItem } from '@/types/stock'

const WATCHLIST_LIMIT = 100

export interface WatchlistManagerProps {
  /** When true, renders compactly inside a modal/drawer (no large headings) */
  compact?: boolean
}

export function WatchlistManager({ compact = false }: WatchlistManagerProps) {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<string, { status: string; progress: number; done_days: number; total_days: number; error?: string }>>({})
  const [companyModal, setCompanyModal] = useState<{ stockId: string; name: string } | null>(null)

  const fetchWatchlist = useCallback(async () => {
    try {
      const result = await cachedFetch<WatchlistItem[]>({
        key: makeCacheKey('watchlist'),
        category: 'watchlist',
        fetcher: async () => {
          const res = await fetch('/api/watchlist')
          if (!res.ok) throw new Error(`載入失敗 (${res.status})`)
          return (await res.json()) as WatchlistItem[]
        },
      })
      setWatchlist(result.data ?? [])
    } catch (err: unknown) {
      console.error('自選股載入失敗:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWatchlist()
  }, [fetchWatchlist])

  const [selectedJobStock, setSelectedJobStock] = useState<string | null>(null)

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist/jobs')
      if (!res.ok) return
      const data: Array<{ stock_id: string; status: string; progress: number; done_days: number; total_days: number }> = await res.json()
      const map: Record<string, { status: string; progress: number; done_days: number; total_days: number; error?: string }> = {}
      for (const job of data) map[job.stock_id] = job
      setJobs(map)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!watchlist.length) return
    fetchJobs() // immediate first poll
    const interval = setInterval(fetchJobs, 5000)
    return () => clearInterval(interval)
  }, [watchlist.length, fetchJobs])

  const handleAddStock = useCallback(
    async (stock: { stock_id: string; name: string }) => {
      try {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: stock.stock_id }),
        })
        if (!res.ok) throw new Error('新增失敗')
        setDialogOpen(false)
        await invalidate(makeCacheKey('watchlist'))
        await fetchWatchlist()
      } catch (err: unknown) {
        console.error('新增自選股失敗:', err)
      }
    },
    [fetchWatchlist],
  )

  const handleRemoveStock = useCallback(
    async (stockId: string) => {
      setRemovingId(stockId)
      try {
        const res = await fetch(`/api/watchlist/${stockId}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('移除失敗')
        await invalidate(makeCacheKey('watchlist'))
        await fetchWatchlist()
      } catch (err: unknown) {
        console.error('移除自選股失敗:', err)
      } finally {
        setRemovingId(null)
      }
    },
    [fetchWatchlist],
  )

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('zh-TW')
    } catch {
      return dateStr
    }
  }

  const jobDetail = selectedJobStock ? jobs[selectedJobStock] as { status: string; progress: number; done_days: number; total_days: number; error?: string } | undefined : null
  const jobDetailStock = selectedJobStock ? watchlist.find((w) => w.stock_id === selectedJobStock) : null

  function renderJobIndicator(job: { status: string; progress: number; done_days: number; total_days: number } | undefined, stockId: string) {
    const openDetail = () => setSelectedJobStock(stockId)

    if (!job) return <span className="text-muted-foreground text-[10px]">-</span>
    if (job.status === 'done') return <button onClick={openDetail} className="text-green-500 text-xs font-bold hover:opacity-80">✓</button>
    if (job.status === 'failed') return <button onClick={openDetail} className="text-red-500 text-xs font-bold hover:opacity-80">✗</button>
    if (job.status === 'running') {
      const pct = job.progress || 50
      return (
        <button onClick={openDetail} className="hover:opacity-80">
          <svg className="h-5 w-5 -rotate-90" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.15" />
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeDasharray={`${2 * Math.PI * 10 * pct / 100} ${2 * Math.PI * 10 * (100 - pct) / 100}`}
              strokeLinecap="round" className="text-primary animate-spin" style={{ animationDuration: '2s' }} />
          </svg>
        </button>
      )
    }
    return <button onClick={openDetail} className="text-muted-foreground text-[10px] hover:opacity-80">○</button>
  }

  return (
    <div className={compact ? 'space-y-3' : 'h-full flex flex-col p-4 md:p-6 gap-4 md:gap-6'}>
      <div className={compact ? 'space-y-2' : 'shrink-0 flex items-center justify-between gap-4'}>
        <p className="text-sm text-muted-foreground">
          共 {watchlist.length} 檔 / {WATCHLIST_LIMIT} 上限
        </p>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={watchlist.length >= WATCHLIST_LIMIT} className={compact ? '' : ''}>
              <Plus className="h-4 w-4 mr-2" />
              新增股票
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[95vw] max-w-lg">
            <DialogHeader>
              <DialogTitle>搜尋並新增股票</DialogTitle>
            </DialogHeader>
            <TickerSearch onSelect={handleAddStock} />
          </DialogContent>
        </Dialog>
      </div>

      {loading && (
        <Card className={compact ? '' : 'shrink-0'}>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {!loading && watchlist.length === 0 && (
        <Card className={compact ? '' : 'shrink-0'}>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Star className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">尚未加入自選股</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              點擊上方「新增股票」按鈕開始追蹤
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && watchlist.length > 0 && (
        <Card className={compact ? '' : 'flex-1 min-h-0 gap-0 overflow-hidden'}>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl">自選股清單</CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:px-6 md:pb-6 flex-1 min-h-0 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap px-4 md:px-2">代碼</TableHead>
                  <TableHead className="whitespace-nowrap px-4 md:px-2">名稱</TableHead>
                  <TableHead className="whitespace-nowrap px-4 md:px-2">加入時間</TableHead>
                  <TableHead className="whitespace-nowrap px-4 md:px-2 text-center">狀態</TableHead>
                  <TableHead className="text-right whitespace-nowrap px-4 md:px-2">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {watchlist.map((item) => (
                  <TableRow key={item.stock_id}>
                    <TableCell className="font-mono font-medium px-4 md:px-2">
                      {item.stock_id}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 md:px-2">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap px-4 md:px-2">
                      {formatDate(item.added_at)}
                    </TableCell>
                    <TableCell className="px-4 md:px-2 text-center">
                      {renderJobIndicator(jobs[item.stock_id] as any, item.stock_id)}
                    </TableCell>
                    <TableCell className="text-right px-4 md:px-2">
                      <div className="flex items-center justify-end gap-1 md:gap-2">
                        <Button variant="ghost" size="sm" className="h-8 px-2 md:px-3"
                          onClick={() => setCompanyModal({ stockId: item.stock_id, name: item.name })}>
                          <Eye className="h-4 w-4 md:mr-1" />
                          <span className="hidden md:inline">查看</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 md:px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                          disabled={removingId === item.stock_id}
                          onClick={() => handleRemoveStock(item.stock_id)}
                        >
                          <Trash2 className="h-4 w-4 md:mr-1" />
                          <span className="hidden md:inline">移除</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CompanyInfoModal
        isOpen={!!companyModal}
        onClose={() => setCompanyModal(null)}
        stockId={companyModal?.stockId ?? ''}
        stockName={companyModal?.name}
      />
      {selectedJobStock && jobDetail && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setSelectedJobStock(null)}>
          <div className="bg-background rounded-lg shadow-xl border border-border w-[360px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {jobDetailStock?.stock_id} {jobDetailStock?.name}
              </h3>
              <button onClick={() => setSelectedJobStock(null)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">狀態</span>
                <span className={
                  jobDetail.status === 'done' ? 'text-green-500 font-semibold' :
                  jobDetail.status === 'failed' ? 'text-red-500 font-semibold' :
                  jobDetail.status === 'running' ? 'text-primary font-semibold' : ''
                }>
                  {jobDetail.status === 'done' ? '✓ 已完成' :
                   jobDetail.status === 'failed' ? '✗ 失敗' :
                   jobDetail.status === 'running' ? '⟳ 計算中' : '○ 等待中'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">進度</span>
                <span>{jobDetail.done_days ?? 0} / {jobDetail.total_days ?? 0} 天</span>
              </div>
              {jobDetail.total_days > 0 && (
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${
                    jobDetail.status === 'done' ? 'bg-green-500' :
                    jobDetail.status === 'failed' ? 'bg-red-500' :
                    'bg-primary'
                  }`} style={{ width: `${((jobDetail.done_days ?? 0) / (jobDetail.total_days || 1)) * 100}%` }} />
                </div>
              )}
              <div className="text-[10px] text-muted-foreground pt-1">
                {jobDetail.status === 'done' ? '分價圖計算完成，可開啟 drawer 查看' :
                 jobDetail.status === 'failed' ? `錯誤: ${(jobDetail as any).error || '未知'}` :
                 '背景計算中，完成後會自動更新'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
