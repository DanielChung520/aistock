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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Search, AlertCircle, ChevronLeft, ChevronRight, Star, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ApplyListingItem {
  sequence: string
  company_code: string
  company_name: string
  application_date: string
  chairman: string
  capital_at_application: string
  review_meeting_date: string
  board_approval_date: string
  contract_filing_date: string
  listing_date: string
  lead_broker: string
  underwriting_price: string
  notes: string
  category: 'Local' | 'Foreign' | 'TIB' | string
  application_year: number
}

interface ApplyListingResponse {
  data: ApplyListingItem[]
  total: number
  type: string
  updated_at: string
  title: string
  error?: string
}

interface WatchedItem {
  company_code: string
  company_name: string
  application_date: string
  added_at: string
}

const ITEMS_PER_PAGE = 20
const STORAGE_KEY = 'aistock-apply-listing-watched'

const CATEGORY_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  Local: { label: '本國', variant: 'default' },
  Foreign: { label: '外國', variant: 'secondary' },
  TIB: { label: '創新板', variant: 'outline' },
}

export default function ApplyListingPage() {
  const [items, setItems] = useState<ApplyListingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string>('')

  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedYear, setSelectedYear] = useState<string>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [watched, setWatched] = useState<Record<string, WatchedItem>>({})

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, WatchedItem>
        setWatched(parsed)
      }
    } catch (e) {
      console.error('Failed to parse watched items', e)
    }
  }, [])

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/auction/apply-listing', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: ApplyListingResponse = await res.json()
        if (json.error) throw new Error(json.error)
        setItems(json.data)
        setUpdatedAt(json.updated_at)
      } catch (e) {
        setError(e instanceof Error ? e.message : '載入失敗')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    items.forEach((it) => {
      if (it.application_year > 0) years.add(it.application_year)
    })
    return Array.from(years).sort((a, b) => b - a)
  }, [items])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const matches = items.filter((it) => {
      if (selectedYear !== 'all' && String(it.application_year) !== selectedYear) return false
      if (selectedCategory !== 'all' && it.category !== selectedCategory) return false
      if (!keyword) return true
      return (
        it.company_code.toLowerCase().includes(keyword) ||
        it.company_name.toLowerCase().includes(keyword) ||
        it.chairman.toLowerCase().includes(keyword) ||
        it.lead_broker.toLowerCase().includes(keyword)
      )
    })
    return matches.sort((a, b) => {
      const aWatched = watched[a.company_code] ? 1 : 0
      const bWatched = watched[b.company_code] ? 1 : 0
      if (aWatched !== bWatched) return bWatched - aWatched
      return b.application_date.localeCompare(a.application_date)
    })
  }, [items, search, selectedYear, selectedCategory, watched])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [search, selectedYear, selectedCategory])

  const toggleWatch = (item: ApplyListingItem) => {
    setWatched((prev) => {
      const next = { ...prev }
      if (next[item.company_code]) {
        delete next[item.company_code]
      } else {
        next[item.company_code] = {
          company_code: item.company_code,
          company_name: item.company_name,
          application_date: item.application_date,
          added_at: new Date().toISOString(),
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch (e) {
        console.error('Failed to persist watched items', e)
      }
      return next
    })
  }

  const watchedCount = Object.keys(watched).length

  return (
    <AppShell title="已申請競標">
      <div className="h-full flex flex-col p-4 md:p-6 gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="font-mono text-xs">
            {watchedCount} 已關注
          </Badge>
          <span>
            資料來源：臺灣證券交易所
            <a
              href="https://www.twse.com.tw/zh/listed/listed/apply-listing.html"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-primary hover:underline"
            >
              apply-listing
            </a>
            {updatedAt && (
              <span className="ml-2 text-xs">
                · 更新於 {new Date(updatedAt).toLocaleString('zh-TW')}
              </span>
            )}
          </span>
        </div>

        <Card className="flex-1 min-h-0 gap-0 overflow-hidden">
          <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
            <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜尋代號/名稱/董事長/承銷商..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="申請年份" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部年份</SelectItem>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y} 年
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="公司類別" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部類別</SelectItem>
                  <SelectItem value="Local">本國公司</SelectItem>
                  <SelectItem value="Foreign">外國公司</SelectItem>
                  <SelectItem value="TIB">創新板公司</SelectItem>
                </SelectContent>
              </Select>
              <div className="ml-auto text-sm text-muted-foreground">
                共 <span className="font-semibold text-foreground">{filtered.length}</span> 筆
                {filtered.length !== items.length && (
                  <span className="text-xs ml-1">(總 {items.length})</span>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <AlertCircle className="h-8 w-8" />
                  <p>載入失敗：{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.reload()}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    重試
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <p>無符合條件的資料</p>
                </div>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-[56px] text-center">關注</TableHead>
                      <TableHead className="w-[60px]">類別</TableHead>
                      <TableHead className="w-[80px]">代號</TableHead>
                      <TableHead className="w-[140px]">公司簡稱</TableHead>
                      <TableHead className="w-[100px]">申請日期</TableHead>
                      <TableHead className="w-[100px]">董事長</TableHead>
                      <TableHead className="w-[110px] text-right">申請時股本(仟元)</TableHead>
                      <TableHead className="w-[100px]">審議日期</TableHead>
                      <TableHead className="w-[100px]">通過日期</TableHead>
                      <TableHead className="w-[100px]">備查日期</TableHead>
                      <TableHead className="w-[100px]">買賣日期</TableHead>
                      <TableHead className="w-[100px]">承銷商</TableHead>
                      <TableHead className="w-[80px] text-right">承銷價</TableHead>
                      <TableHead>備註</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((it) => {
                      const isWatched = !!watched[it.company_code]
                      const cat = CATEGORY_LABELS[it.category] ?? { label: it.category, variant: 'secondary' as const }
                      return (
                        <TableRow
                          key={`${it.company_code}-${it.sequence}`}
                          className={cn(isWatched && 'bg-amber-500/5')}
                        >
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => toggleWatch(it)}
                              title={isWatched ? '取消關注' : '加入關注'}
                            >
                              <Star
                                className={cn(
                                  'h-4 w-4',
                                  isWatched
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-muted-foreground',
                                )}
                              />
                            </Button>
                          </TableCell>
                          <TableCell>
                            <Badge variant={cat.variant} className="font-normal">
                              {cat.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono">{it.company_code}</TableCell>
                          <TableCell className="font-medium">{it.company_name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {it.application_date}
                          </TableCell>
                          <TableCell>{it.chairman}</TableCell>
                          <TableCell className="text-right font-mono">
                            {it.capital_at_application
                              ? Number(it.capital_at_application).toLocaleString()
                              : ''}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {it.review_meeting_date}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {it.board_approval_date}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {it.contract_filing_date}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {it.listing_date}
                          </TableCell>
                          <TableCell>{it.lead_broker}</TableCell>
                          <TableCell className="text-right font-mono">
                            {it.underwriting_price}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={it.notes}>
                            {it.notes}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            {!loading && !error && filtered.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
                <div className="text-muted-foreground">
                  第 {(safePage - 1) * ITEMS_PER_PAGE + 1}–
                  {Math.min(safePage * ITEMS_PER_PAGE, filtered.length)} 筆，共 {filtered.length} 筆
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2 text-muted-foreground">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
