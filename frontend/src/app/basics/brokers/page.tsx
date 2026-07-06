'use client'

import { useState, useEffect, useMemo } from 'react'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search } from 'lucide-react'

interface Broker {
  code: string
  name: string
  opening_date: string
  address: string
  phone: string
}

interface BrokersResponse {
  data: Broker[]
  total: number
  updated_at: string
}

export default function BrokersPage() {
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    async function fetchBrokers() {
      try {
        const res = await fetch('/api/basics/brokers')
        if (!res.ok) {
          throw new Error(`載入失敗 (${res.status})`)
        }
        const json = (await res.json()) as BrokersResponse
        setBrokers(json.data || [])
        setTotal(json.total || 0)
        setError(null)
      } catch (err: unknown) {
        console.error('券商資訊載入失敗:', err)
        setError('無法載入券商資訊，請稍後再試。')
      } finally {
        setLoading(false)
      }
    }

    fetchBrokers()
  }, [])

  const filteredBrokers = useMemo(() => {
    if (!searchQuery.trim()) return brokers
    const lowerQuery = searchQuery.toLowerCase()
    return brokers.filter(
      (b) =>
        b.code.toLowerCase().includes(lowerQuery) ||
        b.name.toLowerCase().includes(lowerQuery) ||
        b.address.toLowerCase().includes(lowerQuery)
    )
  }, [brokers, searchQuery])

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-0 mb-2 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">券商資訊</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {loading ? '載入中...' : `共 ${total} 家券商`}
            </p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋券商代號、名稱或地址..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="p-6 flex flex-col items-center justify-center text-center">
              <p className="text-destructive font-medium">{error}</p>
            </CardContent>
          </Card>
        )}

        {loading && !error && (
          <Card>
            <CardContent className="space-y-3 py-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {!loading && !error && (
          <Card>
            <CardContent className="p-0 md:p-6 md:pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap px-4 md:px-2">代號</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-2">名稱</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-2">開業日</TableHead>
                      <TableHead className="hidden md:table-cell whitespace-nowrap px-4 md:px-2">地址</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-2 text-right">電話</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBrokers.length > 0 ? (
                      filteredBrokers.map((broker) => (
                        <TableRow key={broker.code}>
                          <TableCell className="font-mono font-medium px-4 md:px-2 whitespace-nowrap">
                            {broker.code}
                          </TableCell>
                          <TableCell className="px-4 md:px-2 whitespace-nowrap">
                            {broker.name}
                          </TableCell>
                          <TableCell className="px-4 md:px-2 whitespace-nowrap text-muted-foreground">
                            {broker.opening_date}
                          </TableCell>
                          <TableCell className="hidden md:table-cell px-4 md:px-2">
                            {broker.address}
                          </TableCell>
                          <TableCell className="px-4 md:px-2 whitespace-nowrap text-right text-muted-foreground">
                            {broker.phone}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          找不到符合的券商
                        </TableCell>
                      </TableRow>
                    )}
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
