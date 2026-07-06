'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, AlertCircle, ChevronLeft, ChevronRight, Eye, RefreshCw } from 'lucide-react'

type StockCode = {
  code: string
  name: string
  isin: string
  listing_date: string
  market: string
  industry: string
  status: string
  remark: string
}

type ApiResponse = {
  data: StockCode[]
  total: number
  updated_at: string
  error?: string
}

const ITEMS_PER_PAGE = 50

export default function StockCodesPage() {
  const [stocks, setStocks] = useState<StockCode[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('全部')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    void fetchStocks(false)
  }, [])

  async function fetchStocks(useRefresh: boolean) {
    try {
      setLoading(!useRefresh)
      setError(null)
      const url = useRefresh
        ? '/api/basics/stock-codes?refresh=true'
        : '/api/basics/stock-codes'
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`獲取失敗 (${res.status})`)
      }
      const json: ApiResponse = await res.json()
      if (json.error) {
        setError(json.error)
      } else {
        setStocks(json.data || [])
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '載入資料時發生未知錯誤')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  function handleRefresh() {
    setRefreshing(true)
    void fetchStocks(true)
  }

  const filteredStocks = useMemo(() => {
    let result = stocks

    if (activeTab === '上市') {
      result = result.filter((s) => s.market === '上市')
    } else if (activeTab === '上櫃') {
      result = result.filter((s) => s.market === '上櫃')
    } else if (activeTab === '下市') {
      result = result.filter((s) => s.status === '下市')
    }

    if (search.trim() !== '') {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      )
    }

    return result
  }, [stocks, activeTab, search])

  const totalPages = Math.ceil(filteredStocks.length / ITEMS_PER_PAGE) || 1

  useEffect(() => {
    setCurrentPage(1)
  }, [search, activeTab])

  const paginatedStocks = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredStocks.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }, [filteredStocks, currentPage])

  const countTotal = stocks.length
  const countTse = stocks.filter((s) => s.market === '上市').length
  const countOtc = stocks.filter((s) => s.market === '上櫃').length
  const countDelisted = stocks.filter((s) => s.status === '下市').length

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString('zh-TW')
    } catch {
      return dateStr
    }
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-2 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">證券代號查詢</h1>
            <p className="text-sm text-muted-foreground mt-1">
              共 {loading ? '--' : countTotal} 檔證券
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '更新中...' : '更新資料'}
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
            <TabsList className="grid w-full grid-cols-4 md:w-[500px]">
              <TabsTrigger value="全部">全部 ({countTotal})</TabsTrigger>
              <TabsTrigger value="上市">上市 ({countTse})</TabsTrigger>
              <TabsTrigger value="上櫃">上櫃 ({countOtc})</TabsTrigger>
              <TabsTrigger value="下市">下市 ({countDelisted})</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="搜尋代號或名稱..."
              className="pl-9 w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && !loading && (
          <Card className="border-destructive">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <AlertCircle className="h-12 w-12 text-destructive/80 mb-4" />
              <p className="text-lg font-medium text-destructive">{error}</p>
              <Button onClick={() => void fetchStocks(false)} variant="outline" className="mt-4">
                重試
              </Button>
            </CardContent>
          </Card>
        )}

        {loading && !error && (
          <Card>
            <CardContent className="space-y-3 py-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {!loading && !error && filteredStocks.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">找不到符合的證券</p>
              <p className="text-sm text-muted-foreground/70 mt-1">請嘗試其他搜尋條件</p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && filteredStocks.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">代號</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">名稱</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 hidden md:table-cell">ISIN</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">上市日</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">市場別</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 hidden md:table-cell">產業別</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">狀態</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 hidden lg:table-cell">備註</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedStocks.map((stock) => (
                      <TableRow key={stock.code}>
                        <TableCell className="font-mono font-medium px-4 md:px-6">
                          {stock.code}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6">
                          {stock.name}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6 hidden md:table-cell text-muted-foreground">
                          {stock.isin}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6 text-muted-foreground">
                          {formatDate(stock.listing_date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6">
                          {stock.market}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6 hidden md:table-cell">
                          {stock.industry}
                        </TableCell>
                        <TableCell className="px-4 md:px-6">
                          {stock.status === '下市' ? (
                            <span className="inline-flex items-center rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-300">
                              下市
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-300">
                              正常
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 md:px-6 hidden lg:table-cell text-muted-foreground text-sm">
                          {stock.remark || '-'}
                        </TableCell>
                        <TableCell className="px-4 md:px-6">
                          <Link
                            href={`/basics/company?symbol=${stock.code}`}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between px-4 py-4 border-t">
                <div className="text-sm text-muted-foreground hidden sm:block">
                  顯示 {(currentPage - 1) * ITEMS_PER_PAGE + 1} 至{' '}
                  {Math.min(currentPage * ITEMS_PER_PAGE, filteredStocks.length)} 筆，共 {filteredStocks.length} 筆
                </div>
                <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    上一頁
                  </Button>
                  <div className="text-sm font-medium px-2">
                    第 {currentPage} / {totalPages} 頁
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    下一頁
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
