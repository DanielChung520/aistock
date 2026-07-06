'use client'

import { useState, useEffect, useMemo } from 'react'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search } from 'lucide-react'

interface EntityItem {
  code: string
  name: string
  business_types?: string
  phone?: string
  _cat?: string
}

interface ApiResponse {
  dealers: EntityItem[]
  foreign_brokers: EntityItem[]
  investment_trusts: EntityItem[]
  error?: string
}

type CategoryKey = 'all' | 'dealer' | 'foreign_broker' | 'investment_trust'

const CATEGORIES: { key: CategoryKey; label: string; count?: (d: ApiResponse) => number }[] = [
  { key: 'all', label: '全部' },
  { key: 'dealer', label: '自營商', count: (d) => d.dealers.length },
  { key: 'foreign_broker', label: '外商券商', count: (d) => d.foreign_brokers.length },
  { key: 'investment_trust', label: '投信', count: (d) => d.investment_trusts.length },
]

const CAT_LABELS: Record<string, string> = {
  dealer: '自營商',
  foreign_broker: '外商券商',
  investment_trust: '投信',
}

export default function InstitutionalPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('all')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/basics/institutional-entities')
        if (!res.ok) {
          throw new Error(`載入失敗 (${res.status})`)
        }
        const json: ApiResponse = await res.json()
        if (json.error) {
          setError(json.error)
        } else {
          setData(json)
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '載入資料時發生未知錯誤')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const filteredItems = useMemo(() => {
    if (!data) return []
    let items: EntityItem[] = []

    if (selectedCategory === 'all') {
      items = [
        ...data.dealers.map((e) => ({ ...e, _cat: 'dealer' })),
        ...data.foreign_brokers.map((e) => ({ ...e, _cat: 'foreign_broker' })),
        ...data.investment_trusts.map((e) => ({ ...e, _cat: 'investment_trust' })),
      ]
    } else if (selectedCategory === 'dealer') {
      items = data.dealers.map((e) => ({ ...e, _cat: 'dealer' }))
    } else if (selectedCategory === 'foreign_broker') {
      items = data.foreign_brokers.map((e) => ({ ...e, _cat: 'foreign_broker' }))
    } else {
      items = data.investment_trusts.map((e) => ({ ...e, _cat: 'investment_trust' }))
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      items = items.filter(
        (e) =>
          e.code.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q),
      )
    }

    return items.sort((a, b) => a.code.localeCompare(b.code))
  }, [data, selectedCategory, searchQuery])

  const totalCount = data
    ? data.dealers.length + data.foreign_brokers.length + data.investment_trusts.length
    : 0

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-2 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">三大法人機構</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {loading ? '載入中...' : `共 ${totalCount} 個機構`}
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <Tabs
            value={selectedCategory}
            onValueChange={(v) => setSelectedCategory(v as CategoryKey)}
            className="w-full md:w-auto"
          >
            <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full md:w-auto">
              {CATEGORIES.map((cat) => (
                <TabsTrigger key={cat.key} value={cat.key}>
                  {cat.label}
                  {data && cat.count && ` (${cat.count(data)})`}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="搜尋代號或名稱..."
              className="pl-9 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {error && !loading && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-10 w-10 text-destructive/80 mb-3" />
              <p className="text-destructive font-medium">{error}</p>
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                className="mt-4"
              >
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

        {!loading && !error && filteredItems.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-lg font-medium text-muted-foreground">找不到符合的機構</p>
              <p className="text-sm text-muted-foreground/70 mt-1">請嘗試其他搜尋條件</p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && filteredItems.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4">類型</TableHead>
                      <TableHead className="px-4">代號</TableHead>
                      <TableHead className="px-4">名稱</TableHead>
                      <TableHead className="px-4 hidden md:table-cell">業務類型</TableHead>
                      <TableHead className="px-4 hidden md:table-cell">電話</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={`${item._cat}-${item.code}`}>
                        <TableCell className="px-4">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                              item._cat === 'dealer'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
                                : item._cat === 'foreign_broker'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300'
                                  : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                            }`}
                          >
                            {CAT_LABELS[item._cat || ''] || item._cat}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 font-mono font-medium">{item.code}</TableCell>
                        <TableCell className="px-4">{item.name}</TableCell>
                        <TableCell className="px-4 hidden md:table-cell text-muted-foreground text-sm">
                          {item.business_types || '-'}
                        </TableCell>
                        <TableCell className="px-4 hidden md:table-cell text-muted-foreground text-sm">
                          {item.phone || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="px-4 py-3 border-t text-sm text-muted-foreground">
                顯示 {filteredItems.length} 筆
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
