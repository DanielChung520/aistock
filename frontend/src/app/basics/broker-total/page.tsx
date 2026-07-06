'use client'

import { useState, useEffect } from 'react'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface BrokerRow {
  name: string
  nameKey: string
  buy: number
  sell: number
  net: number
}

interface ApiResponse {
  data: BrokerRow[]
  date: string
  error?: string
}

function formatAmount(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) {
    return (n / 1_000_000_000).toFixed(2) + ' 億'
  }
  if (Math.abs(n) >= 1_000_000) {
    return (n / 1_000_000).toFixed(2) + ' 萬'
  }
  return n.toLocaleString()
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const [y, m, d] = dateStr.split('-')
    return `${y}/${m}/${d}`
  } catch {
    return dateStr
  }
}

export default function BrokerTotalPage() {
  const [data, setData] = useState<BrokerRow[]>([])
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchData(false)
  }, [])

  async function fetchData(isRefresh: boolean) {
    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const res = await fetch('/api/basics/institutional-total')
      if (!res.ok) throw new Error(`載入失敗 (${res.status})`)
      const json: ApiResponse = await res.json()
      if (json.error) {
        setError(json.error)
      } else {
        setData(json.data || [])
        setDate(json.date || '')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '載入資料時發生未知錯誤')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-2 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">券商買賣超（總計）</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {loading ? '載入中...' : date ? `日期：${formatDate(date)}` : ''}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchData(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '更新中...' : '更新'}
          </Button>
        </div>

        {error && !loading && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-10 w-10 text-destructive/80 mb-3" />
              <p className="text-destructive font-medium">{error}</p>
              <Button onClick={() => void fetchData(false)} variant="outline" className="mt-4">
                重試
              </Button>
            </CardContent>
          </Card>
        )}

        {loading && !error && (
          <Card>
            <CardContent className="space-y-3 py-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {!loading && !error && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4">機構類型</TableHead>
                      <TableHead className="px-4 text-right">買超</TableHead>
                      <TableHead className="px-4 text-right">賣超</TableHead>
                      <TableHead className="px-4 text-right">淨買賣超</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row, idx) => (
                      <TableRow
                        key={`${row.nameKey}-${idx}`}
                        className={row.nameKey === 'total' ? 'font-bold bg-muted/50' : ''}
                      >
                        <TableCell className="px-4">{row.name}</TableCell>
                        <TableCell className="px-4 text-right text-green-600">
                          +{formatAmount(row.buy)}
                        </TableCell>
                        <TableCell className="px-4 text-right text-red-600">
                          -{formatAmount(row.sell)}
                        </TableCell>
                        <TableCell
                          className={`px-4 text-right font-medium ${
                            row.net >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {row.net >= 0 ? '+' : ''}
                          {formatAmount(row.net)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                資料來源：FinMind（TWSE T86 三大法人統計）
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
