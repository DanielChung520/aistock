'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { TickerSearch } from '@/components/stocks/TickerSearch'
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
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Trash2, Eye, Star } from 'lucide-react'
import type { WatchlistItem } from '@/types/stock'

const WATCHLIST_LIMIT = 50

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist')
      if (!res.ok) throw new Error(`載入失敗 (${res.status})`)
      const data = (await res.json()) as WatchlistItem[]
      setWatchlist(data)
    } catch (err: unknown) {
      console.error('自選股載入失敗:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWatchlist()
  }, [fetchWatchlist])

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

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-0 mb-2 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">自選股管理</h1>
            <p className="text-sm text-muted-foreground mt-1">
              共 {watchlist.length} 檔 / {WATCHLIST_LIMIT} 上限
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={watchlist.length >= WATCHLIST_LIMIT} className="w-full md:w-auto">
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
          <Card>
            <CardContent className="space-y-3 py-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {!loading && watchlist.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Star className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">
                尚未加入自選股
              </p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                點擊上方「新增股票」按鈕開始追蹤
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && watchlist.length > 0 && (
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-lg md:text-xl">自選股清單</CardTitle>
            </CardHeader>
            <CardContent className="p-0 md:p-6 md:pt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap px-4 md:px-2">代碼</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-2">名稱</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-2">加入時間</TableHead>
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
                        <TableCell className="text-right px-4 md:px-2">
                          <div className="flex items-center justify-end gap-1 md:gap-2">
                            <Button variant="ghost" size="sm" className="h-8 px-2 md:px-3" asChild>
                              <Link href={`/?stock=${item.stock_id}&name=${encodeURIComponent(item.name || '')}`}>
                                <Eye className="h-4 w-4 md:mr-1" />
                                <span className="hidden md:inline">查看</span>
                              </Link>
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
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
