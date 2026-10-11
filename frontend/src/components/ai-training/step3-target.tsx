'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, Search, X } from 'lucide-react'
import universeData from '@/lib/data/research-universe-ai-memory-passive.json'

export type Target = 'next_return' | 'next_5d_return' | 'next_direction' | 'next_5d_direction'

export type StockScope = 'my' | 'all'

export type FeatureMode = 'all' | 'top_n'

interface TargetOption {
  id: Target
  label: string
  formula: string
  description: string
  recommended?: boolean
}

const TARGETS: TargetOption[] = [
  {
    id: 'next_return',
    label: '隔日漲跌幅',
    formula: 'Y = next_close / close − 1',
    description: '隔日報酬率（回歸），跨股票可比較，實務價值高',
    recommended: true,
  },
  {
    id: 'next_5d_return',
    label: '5日總漲跌幅',
    formula: 'Y = close[t+5] / close − 1',
    description: '5 日累計報酬（回歸），捕捉中短線動能',
  },
  {
    id: 'next_direction',
    label: '隔日漲跌分類',
    formula: 'Y = 1 if next_close > close else 0',
    description: '隔日漲跌二元分類',
  },
  {
    id: 'next_5d_direction',
    label: '5日總漲跌分類',
    formula: 'Y = 1 if close[t+5] > close else 0',
    description: '5 日漲跌二元分類',
  },
]

const UNIVERSE: { stock_id: string; name: string }[] = universeData.stocks

export function Step3Target({
  target,
  onTargetChange,
  stockScope,
  onStockScopeChange,
  selectedStocks,
  onStocksChange,
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  featureMode,
  onFeatureModeChange,
  featureTopN,
  onFeatureTopNChange,
  latestSens,
  featureCount,
}: {
  target: Target
  onTargetChange: (t: Target) => void
  stockScope: StockScope
  onStockScopeChange: (s: StockScope) => void
  selectedStocks: Set<string>
  onStocksChange: (s: Set<string>) => void
  startDate: string
  endDate: string
  onStartChange: (d: string) => void
  onEndChange: (d: string) => void
  featureMode: FeatureMode
  onFeatureModeChange: (m: FeatureMode) => void
  featureTopN: number
  onFeatureTopNChange: (n: number) => void
  latestSens: { finished_at: number | null; target: string | null } | null
  featureCount: number | null
}) {
  const [search, setSearch] = useState('')
  const filtered = UNIVERSE.filter(
    (s) => s.stock_id.includes(search.trim()) || s.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const toggle = (id: string) => {
    const next = new Set(selectedStocks)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onStocksChange(next)
  }

  const selectAll = () => onStocksChange(new Set(UNIVERSE.map((s) => s.stock_id)))
  const clearAll = () => onStocksChange(new Set())

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Step 3 / 6：預測目標與訓練股票</h2>
        <p className="text-xs text-muted-foreground mt-1">選擇預測目標、訓練股票清單與資料區間</p>
      </div>

      {/* ── 預測目標 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">預測目標（單選）</CardTitle>
          <CardDescription className="text-xs">Y 計算公式即時顯示</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTargetChange(t.id)}
              className={
                'w-full text-left rounded-md border px-3 py-2.5 transition-colors ' +
                (target === t.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card hover:bg-muted/40')
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{t.label}</span>
                    {t.recommended && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                        ⭐ 推薦
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{t.formula}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{t.description}</div>
                </div>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* ── 訓練股票清單 ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">訓練股票清單</CardTitle>
              <CardDescription className="text-xs">選擇訓練範圍與股票</CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              {stockScope === 'all' ? '全市場 1,946 檔' : `已選 ${selectedStocks.size} / ${UNIVERSE.length}`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 範圍切換 */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={stockScope === 'my' ? 'default' : 'outline'}
              className="h-7 text-xs gap-1.5"
              onClick={() => onStockScopeChange('my')}
            >
              <Check className="h-3 w-3" />
              我的股票（{UNIVERSE.length} 檔）
            </Button>
            <Button
              size="sm"
              variant={stockScope === 'all' ? 'default' : 'outline'}
              className="h-7 text-xs gap-1.5"
              onClick={() => onStockScopeChange('all')}
            >
              <Check className="h-3 w-3" />
              全市場（1,946 檔）
            </Button>
          </div>

          {stockScope === 'my' && (
            <>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={selectAll} className="h-7 text-xs">
                  <Check className="h-3 w-3 mr-1" />
                  全選
                </Button>
                <Button size="sm" variant="outline" onClick={clearAll} className="h-7 text-xs">
                  <X className="h-3 w-3 mr-1" />
                  全不選
                </Button>
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜尋代號或名稱"
                    className="h-7 text-xs pl-7"
                  />
                </div>
              </div>
              <ScrollArea className="h-56 rounded border bg-muted/20 p-2">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                  {filtered.map((s) => {
                    const checked = selectedStocks.has(s.stock_id)
                    return (
                      <button
                        key={s.stock_id}
                        type="button"
                        onClick={() => toggle(s.stock_id)}
                        className={
                          'flex items-center gap-1.5 rounded px-2 py-1 text-xs text-left transition-colors ' +
                          (checked ? 'bg-primary/10 text-foreground' : 'hover:bg-muted text-muted-foreground')
                        }
                      >
                        <span
                          className={
                            'h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0 ' +
                            (checked ? 'bg-primary border-primary' : 'border-muted-foreground/40')
                          }
                        >
                          {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                        </span>
                        <span className="font-mono">{s.stock_id}</span>
                        <span className="truncate">{s.name}</span>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            </>
          )}

          {stockScope === 'all' && (
            <p className="text-xs text-muted-foreground">
              全市場模式：訓練將載入 stock_daily_features 中所有股票（約 1,946 檔）的特徵。
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 特徵維度 ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">特徵維度</CardTitle>
              <CardDescription className="text-xs">
                選擇要餵給模型的特徵集合（全部或依敏感度排序前 N 名）
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              {featureMode === 'all'
                ? `全部特徵 ${featureCount ?? '—'} 個`
                : `前 ${featureTopN} 名`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={featureMode === 'all' ? 'default' : 'outline'}
              className="h-7 text-xs gap-1.5"
              onClick={() => onFeatureModeChange('all')}
            >
              <Check className="h-3 w-3" />
              全部特徵
            </Button>
            <Button
              size="sm"
              variant={featureMode === 'top_n' ? 'default' : 'outline'}
              className="h-7 text-xs gap-1.5"
              onClick={() => onFeatureModeChange('top_n')}
              disabled={!latestSens?.finished_at}
              title={!latestSens?.finished_at ? '尚未有該目標的敏感度分析結果' : undefined}
            >
              <Check className="h-3 w-3" />
              依敏感度分析前 N 名
            </Button>
            {featureMode === 'top_n' && (
              <div className="flex items-center gap-2 ml-auto">
                <Label className="text-xs text-muted-foreground">前</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={featureTopN}
                  onChange={(e) => onFeatureTopNChange(parseInt(e.target.value || '30', 10))}
                  className="h-7 text-xs w-16"
                />
                <Label className="text-xs text-muted-foreground">名</Label>
              </div>
            )}
          </div>
          {latestSens?.finished_at ? (
            <p className="text-xs text-muted-foreground">
              上次敏感度分析：
              {new Date(latestSens.finished_at * 1000).toLocaleString('zh-TW')}
              （target：{latestSens.target}）
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              尚未對此目標做過敏感度分析，將使用全部特徵。如需限定請到
              <a href="/features" className="underline ml-1" target="_blank" rel="noreferrer">特徵敏感度分析</a>
              頁先跑一次。
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 資料區間 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">資料區間</CardTitle>
          <CardDescription className="text-xs">預設使用 stock_daily_features 全部範圍</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div>
              <Label className="text-xs text-muted-foreground">起始</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => onStartChange(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">結束</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => onEndChange(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
