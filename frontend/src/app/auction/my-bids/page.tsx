'use client'

import { useState, useEffect } from 'react'
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
import { Button } from '@/components/ui/button'
import { Trash2, Star } from 'lucide-react'
import Link from 'next/link'

interface SavedBid {
  security_code: string
  security_name: string
  opening_date: string
  added_at: string
}

const STORAGE_KEY = 'aistock-my-auction-bids'

export default function MyBidsPage() {
  const [savedBids, setSavedBids] = useState<SavedBid[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setSavedBids(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to parse saved bids', e)
    }
    setMounted(true)
  }, [])

  const removeBid = (code: string, date: string) => {
    const newSavedBids = savedBids.filter(b => !(b.security_code === code && b.opening_date === date))
    setSavedBids(newSavedBids)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSavedBids))
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString('zh-TW')
    } catch {
      return dateStr
    }
  }

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleString('zh-TW')
    } catch {
      return dateStr
    }
  }

  if (!mounted) return null

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-0 mb-2 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">我的競拍</h1>
            <p className="text-sm text-muted-foreground mt-1">
              共 {savedBids.length} 筆追蹤
            </p>
          </div>
          <Link href="/auction/announcements">
            <Button variant="outline">返回競拍公告</Button>
          </Link>
        </div>

        {savedBids.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Star className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">尚未追蹤任何競拍項目</p>
              <p className="text-sm text-muted-foreground/70 mt-1">可在競拍公告頁面點擊星號加入追蹤</p>
              <Link href="/auction/announcements" className="mt-6">
                <Button>前往競拍公告</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">證券代號</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">證券名稱</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">開標日期</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6">加入時間</TableHead>
                      <TableHead className="whitespace-nowrap px-4 md:px-6 w-10 text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savedBids.map((bid) => (
                      <TableRow key={`${bid.security_code}-${bid.opening_date}`}>
                        <TableCell className="font-mono px-4 md:px-6">
                          {bid.security_code}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6 font-bold">
                          {bid.security_name}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6">
                          {formatDate(bid.opening_date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4 md:px-6 text-muted-foreground text-sm">
                          {formatDateTime(bid.added_at)}
                        </TableCell>
                        <TableCell className="px-4 md:px-6 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeBid(bid.security_code, bid.opening_date)}
                            title="移除追蹤"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
