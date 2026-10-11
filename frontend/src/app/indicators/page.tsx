'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, AlertCircle } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { IndicatorDetailCard } from '@/components/indicators/IndicatorDetailCard'
import type { IndicatorKbDoc } from '@/app/api/indicators/route'

const CATEGORY_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'trend', label: '趨勢' },
  { key: 'momentum', label: '動能' },
  { key: 'volatility', label: '波動' },
  { key: 'volume', label: '量能' },
  { key: 'pattern', label: '型態' },
  { key: 'statistical', label: '統計' },
]

export default function IndicatorsPage() {
  const [docs, setDocs] = useState<IndicatorKbDoc[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [implementedOnly, setImplementedOnly] = useState(false)

  const load = () => {
    fetch('/api/indicators')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDocs(d.indicators))
      .catch(() => setError('無法載入指標知識庫'))
  }

  useEffect(load, [])

  const handleSaved = (updated: IndicatorKbDoc) => {
    setDocs((prev) => (prev ? prev.map((d) => (d.metric === updated.metric ? updated : d)) : prev))
  }

  const filtered = useMemo(() => {
    if (!docs) return []
    const q = query.trim().toLowerCase()
    return docs.filter((doc) => {
      if (category !== 'all' && doc.category !== category) return false
      if (implementedOnly && !doc.implementation?.implemented) return false
      if (!q) return true
      const haystack = [
        doc.metric,
        doc.name,
        doc.definition ?? '',
        (doc.tags ?? []).join(' '),
        doc.llm_intent ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [docs, query, category, implementedOnly])

  return (
    <AppShell title="所有指標">
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋指標（名稱 / 標籤 / 意圖）"
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {CATEGORY_FILTERS.map((c) => (
              <Button
                key={c.key}
                variant={category === c.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategory(c.key)}
                className="h-7 px-2.5 text-xs"
              >
                {c.label}
              </Button>
            ))}
          </div>
          <Button
            variant={implementedOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setImplementedOnly((v) => !v)}
            className="h-7 px-2.5 text-xs ml-auto shrink-0"
          >
            僅已實作
          </Button>
        </div>

        <div className="px-4 py-1.5 text-[11px] text-muted-foreground shrink-0">
          {docs ? `共 ${filtered.length} / ${docs.length} 個指標` : '載入中…'}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-2">
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            {!docs && !error && (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                載入中…
              </div>
            )}
            {docs && filtered.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-10">
                沒有符合條件的指標
              </div>
            )}
            {filtered.map((doc) => (
              <IndicatorDetailCard
                key={doc.metric}
                doc={doc}
                defaultOpen={query.trim().length > 0}
                onSaved={handleSaved}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </AppShell>
  )
}
