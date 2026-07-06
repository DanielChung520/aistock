'use client'

import { useState, useEffect, useMemo } from 'react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Search, AlertCircle, ChevronLeft, ChevronRight, Star } from 'lucide-react'

interface Announcement {
  sequence: string
  opening_date: string
  security_name: string
  security_code: string
  market: string
  issue_type: string
  auction_method: string
  bid_start_date: string
  bid_end_date: string
  auction_quantity: string
  min_bid_price: string
  min_bid_quantity: string
  max_bid_quantity: string
  deposit_ratio: string
  processing_fee: string
  settlement_date: string
  lead_broker: string
  total_winning_amount: string
  winning_fee_rate: string
  total_qualified: string
  qualified_bid_quantity: string
  min_winning_price: string
  max_winning_price: string
  weighted_avg_price: string
  actual_underwriting_price: string
  cancelled: string
}

interface ApiResponse {
  data: Announcement[]
  total: number
  year: string
  updated_at: string
  title: string
}

interface YearsApiResponse {
  data: {
    startYear: number
    endYear: number
  }
  total: number
  updated_at: string
}

interface SavedBid {
  security_code: string
  security_name: string
  opening_date: string
  added_at: string
}

const ITEMS_PER_PAGE = 20
const STORAGE_KEY = 'aistock-my-auction-bids'

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedYear, setSelectedYear] = useState<string>('')
  const [availableYears, setAvailableYears] = useState<number[]>([])
  const [savedBids, setSavedBids] = useState<SavedBid[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setSavedBids(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to parse saved bids', e)
    }
  }, [])

  useEffect(() => {
    async function fetchYears() {
      try {
        const res = await fetch('/api/auction/years')
        if (!res.ok) throw new Error('無法獲取年份')
        const json = (await res.json()) as YearsApiResponse
        
        const years = []
        for (let y = json.data.endYear; y >= json.data.startYear; y--) {
          years.push(y)
        }
        setAvailableYears(years)
        
        if (years.length > 0) {
          setSelectedYear(years[0].toString())
        }
      } catch (err) {
        console.error('Failed to fetch years:', err)
        const defaultYear = new Date().getFullYear()
        setAvailableYears([defaultYear])
        setSelectedYear(defaultYear.toString())
      }
    }
    fetchYears()
  }, [])

  useEffect(() => {
    if (!selectedYear) return

    async function fetchData() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/auction/announcements?year=${selectedYear}`)
        if (!res.ok) {
          throw new Error(`獲取資料失敗 (${res.status})`)
        }
        const json = (await res.json()) as ApiResponse
        setAnnouncements(json.data)
        setCurrentPage(1)
      } catch (err: unknown) {
        console.error('Failed to fetch announcements:', err)
        setError(err instanceof Error ? err.message : '載入資料時發生未知錯誤')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [selectedYear])

  const toggleSaveBid = (announcement: Announcement) => {
    const isSaved = savedBids.some(b => b.security_code === announcement.security_code && b.opening_date === announcement.opening_date)
    let newSavedBids: SavedBid[]
    
    if (isSaved) {
      newSavedBids = savedBids.filter(b => !(b.security_code === announcement.security_code && b.opening_date === announcement.opening_date))
    } else {
      newSavedBids = [
        ...savedBids,
        {
          security_code: announcement.security_code,
          security_name: announcement.security_name,
          opening_date: announcement.opening_date,
          added_at: new Date().toISOString()
        }
      ]
    }
    
    setSavedBids(newSavedBids)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSavedBids))
  }

  const isBidSaved = (announcement: Announcement) => {
    return savedBids.some(b => b.security_code === announcement.security_code && b.opening_date === announcement.opening_date)
  }

  const filteredAnnouncements = useMemo(() => {
    if (search.trim() === '') return announcements
    
    const q = search.trim().toLowerCase()
    return announcements.filter(
      (a) => a.security_code.toLowerCase().includes(q) || a.security_name.toLowerCase().includes(q)
    )
  }, [announcements, search])

  const totalPages = Math.ceil(filteredAnnouncements.length / ITEMS_PER_PAGE) || 1

  const paginatedAnnouncements = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredAnnouncements.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }, [filteredAnnouncements, currentPage])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString('zh-TW')
    } catch {
      return dateStr
    }
  }

  const formatNumber = (numStr: string) => {
    if (!numStr || numStr === '0' || numStr === '0.00' || numStr === '0.0000') return '—'
    return Number(numStr).toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-0 mb-2 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">競拍公告</h1>
            <p className="text-sm text-muted-foreground mt-1">
              共 {loading ? '--' : announcements.length} 筆資料
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <div className="w-full md:w-48">
            <Select value={selectedYear} onValueChange={setSelectedYear} disabled={loading || availableYears.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="選擇年份" />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(year => (
                  <SelectItem key={year} value={year.toString()}>{year} 年</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="搜尋代號或名稱..."
              className="pl-9 w-full"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setCurrentPage(1)
              }}
            />
          </div>
        </div>

        {loading && (
          <Card>
            <CardContent className="space-y-3 py-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {error && !loading && (
          <Card className="border-destructive">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <AlertCircle className="h-12 w-12 text-destructive/80 mb-4" />
              <p className="text-lg font-medium text-destructive">{error}</p>
              <Button onClick={() => window.location.reload()} variant="outline" className="mt-4">
                重試
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && !error && filteredAnnouncements.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">找不到符合的競拍資料</p>
              <p className="text-sm text-muted-foreground/70 mt-1">請嘗試其他搜尋條件或年份</p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && filteredAnnouncements.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">開標日期</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">證券名稱</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">代號</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 hidden lg:table-cell">發行市場</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 hidden lg:table-cell">發行性質</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 hidden xl:table-cell">投標期間</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 text-right">競拍數量</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 text-right">最低投標價</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 text-right hidden lg:table-cell">得標加權均價</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 text-right hidden lg:table-cell">實際承銷價</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 hidden xl:table-cell">主辦券商</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 text-center">狀態</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 w-10 text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedAnnouncements.map((item) => {
                      const saved = isBidSaved(item)
                      return (
                        <TableRow key={`${item.security_code}-${item.opening_date}`}>
                          <TableCell className="whitespace-nowrap px-4 md:px-6">
                            {formatDate(item.opening_date)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 font-bold">
                            {item.security_name}
                          </TableCell>
                          <TableCell className="font-mono px-4 md:px-6">
                            {item.security_code}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 hidden lg:table-cell">
                            <Badge variant="outline">{item.market}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 hidden lg:table-cell text-muted-foreground text-sm">
                            {item.issue_type}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 hidden xl:table-cell text-muted-foreground text-sm">
                            {formatDate(item.bid_start_date)} ~ {formatDate(item.bid_end_date)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 text-right">
                            {formatNumber(item.auction_quantity)} 張
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 text-right">
                            {formatNumber(item.min_bid_price)} 元
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 text-right hidden lg:table-cell">
                            {item.weighted_avg_price !== '0' && item.weighted_avg_price !== '0.00' ? `${formatNumber(item.weighted_avg_price)} 元` : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 text-right hidden lg:table-cell">
                            {item.actual_underwriting_price !== '0' && item.actual_underwriting_price !== '0.00' && item.actual_underwriting_price !== '0.0000' ? `${formatNumber(item.actual_underwriting_price)} 元` : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 hidden xl:table-cell text-muted-foreground">
                            {item.lead_broker}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-4 md:px-6 text-center">
                            {item.cancelled === 'Y' ? (
                              <Badge variant="destructive">流標/取消</Badge>
                            ) : (
                              <Badge variant="default" className="bg-green-600 hover:bg-green-700">正常</Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-4 md:px-6 text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleSaveBid(item)}
                              title={saved ? "取消追蹤" : "加入追蹤"}
                            >
                              <Star className={`h-4 w-4 ${saved ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between px-4 py-4 border-t">
                <div className="text-sm text-muted-foreground hidden sm:block">
                  顯示 {(currentPage - 1) * ITEMS_PER_PAGE + 1} 至{' '}
                  {Math.min(currentPage * ITEMS_PER_PAGE, filteredAnnouncements.length)} 筆，共 {filteredAnnouncements.length} 筆
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
