'use client'

import { useState, useEffect, useRef } from 'react'
import { AppShell } from '@/components/app-shell'
import { TickerSearch } from '@/components/stocks/TickerSearch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { createChart, LineSeries, type Time } from 'lightweight-charts'

interface InstitutionalRow {
  date: string
  外資: number
  投信: number
  自營商_自_: number
  自營商_避_: number
  外商自營: number
  total: number
  主力: number
}

interface MarginShortSaleRow {
  date: string
  MarginPurchaseTodayBalance: number
  ShortSaleTodayBalance: number
}

interface ShareholdingRow {
  ForeignInvestmentShares: number
  ForeignInvestmentSharesRatio: number
  ForeignInvestmentUpperLimitRatio: number
  NumberOfSharesIssued: number
}

interface ChipsResponse {
  stock_id: string
  institutional: InstitutionalRow[]
  margin_short_sale: MarginShortSaleRow[]
  shareholding: ShareholdingRow | null
  day_trading: { date: string; Volume: number; BuyAmount: number; SellAmount: number }[]
}

function formatK(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'N/A'
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '億'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(0) + '萬'
  return v.toLocaleString()
}

function TrendChart({
  series,
  height = 160,
}: {
  series: { label: string; data: { time: string; value: number }[]; color: string }[]
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || series.length === 0 || series.every((s) => s.data.length === 0)) return

    const chart = createChart(containerRef.current, {
      height,
      width: containerRef.current.clientWidth,
      layout: { background: { color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: { mode: 0 },
    })

    series.forEach((s) => {
      if (s.data.length === 0) return
      const line = chart.addSeries(LineSeries, { color: s.color, lineWidth: 1, title: s.label })
      line.setData(s.data.map((d) => ({ time: d.time as Time, value: d.value })))
    })

    chart.timeScale().fitContent()

    const observer = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    })
    if (containerRef.current) observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [series, height])

  if (series.every((s) => s.data.length === 0)) return null
  return <div ref={containerRef} className="w-full" style={{ height }} />
}

export default function ChipsInstitutionalPage() {
  const [symbol, setSymbol] = useState<string | null>(null)
  const [stockName, setStockName] = useState('')
  const [chips, setChips] = useState<ChipsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    fetch(`/api/stocks/${symbol}/chips?days=30`)
      .then((r) => {
        if (!r.ok) throw new Error(`籌碼資料載入失敗 (${r.status})`)
        return r.json() as Promise<ChipsResponse>
      })
      .then(setChips)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '載入失敗'))
      .finally(() => setLoading(false))
  }, [symbol])

  const handleSelect = (stock: { stock_id: string; name: string }) => {
    setSymbol(stock.stock_id)
    setStockName(stock.name)
    setChips(null)
  }

  const latestInst = chips?.institutional?.slice(-1)?.[0]
  const latestMargin = chips?.margin_short_sale?.slice(-1)?.[0]

  return (
    <AppShell title="籌碼分析">
      <div className="p-4 md:p-6 mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">籌碼分析</h1>
            <p className="text-sm text-muted-foreground">三大法人買賣超、融資融券、持股結構</p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            <TickerSearch onSelect={handleSelect} placeholder="輸入股票代碼或名稱 (例如: 2330, 台積電)..." />
          </CardContent>
        </Card>

        {!symbol && !loading && !error && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              請在上方搜尋股票
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {error && (
          <Card className="border-destructive">
            <CardContent className="py-8 text-center text-destructive">{error}</CardContent>
          </Card>
        )}

        {chips && symbol && (
          <>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-base font-mono px-3 py-1">
                {symbol}
              </Badge>
              <span className="text-lg font-semibold">{stockName}</span>
            </div>

            {latestInst && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">法人買賣超</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: '外資', value: latestInst.外資, color: '#FF6B6B' },
                      { label: '投信', value: latestInst.投信, color: '#4ECDC4' },
                      { label: '自營商(自)', value: latestInst.自營商_自_, color: '#95E1D3' },
                      { label: '自營商(避)', value: latestInst.自營商_避_, color: '#FFE66D' },
                      { label: '主力', value: latestInst.主力, color: '#FF4757' },
                    ].map((item) => (
                      <Card key={item.label} className="bg-card/30">
                        <CardContent className="p-3 text-center">
                          <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                          <div
                            className={cn(
                              'text-sm font-bold tabular-nums',
                              item.value >= 0 ? 'text-red-500' : 'text-green-500',
                            )}
                          >
                            {item.value >= 0 ? '+' : ''}
                            {formatK(item.value)}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {chips.institutional.length > 1 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">
                        法人買賣超趨勢（最近 {chips.institutional.length} 天）
                      </div>
                      <TrendChart
                        series={[
                          { label: '外資', data: chips.institutional.map((d) => ({ time: d.date, value: d.外資 })), color: '#FF6B6B' },
                          { label: '投信', data: chips.institutional.map((d) => ({ time: d.date, value: d.投信 })), color: '#4ECDC4' },
                          { label: '自營商(避)', data: chips.institutional.map((d) => ({ time: d.date, value: d.自營商_避_ })), color: '#95E1D3' },
                        ]}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {latestMargin && chips.margin_short_sale.length > 1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">融資融券</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Card className="bg-card/30">
                      <CardContent className="p-3 text-center">
                        <div className="text-xs text-muted-foreground mb-1">融資餘額</div>
                        <div className="text-sm font-bold tabular-nums">
                          {formatK(latestMargin.MarginPurchaseTodayBalance)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-card/30">
                      <CardContent className="p-3 text-center">
                        <div className="text-xs text-muted-foreground mb-1">融券餘額</div>
                        <div className="text-sm font-bold tabular-nums">
                          {formatK(latestMargin.ShortSaleTodayBalance)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-card/30">
                      <CardContent className="p-3 text-center">
                        <div className="text-xs text-muted-foreground mb-1">資券比</div>
                        <div className="text-sm font-bold tabular-nums">
                          {latestMargin.MarginPurchaseTodayBalance > 0
                            ? (
                                (latestMargin.ShortSaleTodayBalance /
                                  latestMargin.MarginPurchaseTodayBalance) *
                                100
                              ).toFixed(2) + '%'
                            : 'N/A'}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground mb-2">
                      融資融券趨勢（最近 {chips.margin_short_sale.length} 天）
                    </div>
                    <TrendChart
                      series={[
                        {
                          label: '融資',
                          data: chips.margin_short_sale.map((d) => ({ time: d.date, value: d.MarginPurchaseTodayBalance })),
                          color: '#FF6B6B',
                        },
                        {
                          label: '融券',
                          data: chips.margin_short_sale.map((d) => ({ time: d.date, value: d.ShortSaleTodayBalance })),
                          color: '#4ECDC4',
                        },
                      ]}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {chips.shareholding && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">持股結構</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: '外資持股張數', value: formatK(chips.shareholding.ForeignInvestmentShares) },
                        { label: '外資持股比率', value: chips.shareholding.ForeignInvestmentSharesRatio.toFixed(2) + '%' },
                        { label: '外資持股上限', value: chips.shareholding.ForeignInvestmentUpperLimitRatio.toFixed(2) + '%' },
                        { label: '發行張數', value: formatK(chips.shareholding.NumberOfSharesIssued) },
                      ].map((item) => (
                        <div key={item.label} className="bg-card/30 rounded-lg p-3 text-center">
                          <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                          <div className="text-sm font-bold">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {chips.day_trading.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">當日沖銷</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      {(() => {
                        const dt = chips.day_trading[chips.day_trading.length - 1]
                        if (!dt) return null
                        return [
                          { label: '沖銷量', value: formatK(dt.Volume) },
                          { label: '買超', value: formatK(dt.BuyAmount - dt.SellAmount) },
                          { label: '買金額', value: formatK(dt.BuyAmount) },
                          { label: '賣金額', value: formatK(dt.SellAmount) },
                        ].map((item) => (
                          <div key={item.label} className="bg-card/30 rounded-lg p-3 text-center">
                            <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                            <div className="text-sm font-bold">{item.value}</div>
                          </div>
                        ))
                      })()}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
