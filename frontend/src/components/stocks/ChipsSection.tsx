'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  HistogramSeries,
  LineSeries,
  type Time,
  type ISeriesApi,
} from 'lightweight-charts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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
  MarginPurchaseBuy: number
  MarginPurchaseSell: number
  MarginPurchaseTodayBalance: number
  MarginPurchaseYesterdayBalance: number
  MarginPurchaseLimit: number
  ShortSaleBuy: number
  ShortSaleSell: number
  ShortSaleTodayBalance: number
  ShortSaleYesterdayBalance: number
  ShortSaleLimit: number
}

interface DayTradingRow {
  date: string
  Volume: number
  BuyAmount: number
  SellAmount: number
}

interface ShareholdingRow {
  date: string
  stock_id: string
  stock_name: string
  ForeignInvestmentShares: number
  ForeignInvestmentSharesRatio: number
  ForeignInvestmentUpperLimitRatio: number
  NumberOfSharesIssued: number
}

interface ShortSaleBalanceRow {
  date: string
  MarginShortSalesCurrentDayBalance: number
  SBLShortSalesCurrentDayBalance: number
}

interface ChipsResponse {
  stock_id: string
  institutional: InstitutionalRow[]
  margin_short_sale: MarginShortSaleRow[]
  shareholding: ShareholdingRow | null
  day_trading: DayTradingRow[]
  short_sale_balances: ShortSaleBalanceRow[]
}

function formatK(v: number): string {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '億'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(0) + '萬'
  return v.toLocaleString()
}

function formatRatio(v: number): string {
  return (v / 1e8).toFixed(2) + '億'
}

const INST_COLORS = {
  外資: '#FF6B6B',
  投信: '#4ECDC4',
  '自營商(避)': '#FFE66D',
  '自營商(自)': '#95E1D3',
  外商自營: '#A8D8EA',
  主力: '#FF4757',
}

export function ChipsSection({ stockId }: { stockId: string }) {
  const [chips, setChips] = useState<ChipsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'institutional' | 'margin' | 'ownership' | 'dayTrading'>('institutional')

  const instChartRef = useRef<HTMLDivElement>(null)
  const instChartInstance = useRef<ISeriesApi<'Histogram'> | null>(null)
  const instChart = useRef<ReturnType<typeof createChart> | null>(null)
  const marginChartRef = useRef<HTMLDivElement>(null)
  const marginChartInstance = useRef<ISeriesApi<'Line'> | null>(null)
  const marginChart = useRef<ReturnType<typeof createChart> | null>(null)

  useEffect(() => {
    fetch(`/api/stocks/${stockId}/chips`)
      .then((r) => {
        if (!r.ok) throw new Error(`籌碼資料載入失敗 (${r.status})`)
        return r.json()
      })
      .then((data: ChipsResponse) => {
        setChips(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '載入失敗')
        setLoading(false)
      })
  }, [stockId])

  useEffect(() => {
    if (!chips?.institutional?.length || !instChartRef.current) return

    if (instChart.current) {
      try {
        instChart.current.remove()
      } catch {
        // chart already disposed
      }
      instChart.current = null
    }

    const chart = createChart(instChartRef.current, {
      height: 200,
      layout: {
        background: { color: 'transparent' },
        textColor: 'hsl(var(--muted-foreground))',
      },
      grid: {
        vertLines: { color: 'hsl(var(--border))' },
        horzLines: { color: 'hsl(var(--border))' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
      },
    })

    const mainSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'right',
    })

    const mainColor = INST_COLORS['主力']
    const grouped = chips.institutional.map((d) => ({
      time: d.date as Time,
      value: d.主力,
      color: d.主力 >= 0 ? mainColor + '99' : mainColor + '33',
    }))
    mainSeries.setData(grouped)

    chart.addSeries(LineSeries, {
      color: 'hsl(var(--border))',
      lineWidth: 1,
      priceScaleId: 'right',
    }).setData(
      chips.institutional.map((d) => ({ time: d.date as Time, value: 0 })),
    )

    chart.timeScale().fitContent()
    instChart.current = chart
    instChartInstance.current = mainSeries

    const handleResize = () => {
      if (instChartRef.current) {
        chart.applyOptions({ width: instChartRef.current.clientWidth })
      }
    }
    const observer = new ResizeObserver(handleResize)
    observer.observe(instChartRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
      instChart.current = null
    }
  }, [chips?.institutional])

  useEffect(() => {
    if (!chips?.margin_short_sale?.length || !marginChartRef.current) return

    if (marginChart.current) {
      try {
        marginChart.current.remove()
      } catch {
        // chart already disposed
      }
      marginChart.current = null
    }

    const chart = createChart(marginChartRef.current, {
      height: 180,
      layout: {
        background: { color: 'transparent' },
        textColor: 'hsl(var(--muted-foreground))',
      },
      grid: {
        vertLines: { color: 'hsl(var(--border))' },
        horzLines: { color: 'hsl(var(--border))' },
      },
      timeScale: { timeVisible: true },
      crosshair: { mode: 1 },
    })

    const marginSeries = chart.addSeries(LineSeries, {
      color: '#FF6B6B',
      lineWidth: 2,
      priceScaleId: 'right',
    })

    const shortSeries = chart.addSeries(LineSeries, {
      color: '#4ECDC4',
      lineWidth: 2,
      priceScaleId: 'right',
    })

    const marginData = chips.margin_short_sale.map((d) => ({
      time: d.date as Time,
      value: d.MarginPurchaseTodayBalance / 1000,
    }))
    const shortData = chips.margin_short_sale.map((d) => ({
      time: d.date as Time,
      value: d.ShortSaleTodayBalance / 1000,
    }))

    marginSeries.setData(marginData)
    shortSeries.setData(shortData)

    chart.timeScale().fitContent()
    marginChart.current = chart
    marginChartInstance.current = marginSeries

    const handleResize = () => {
      if (marginChartRef.current) {
        chart.applyOptions({ width: marginChartRef.current.clientWidth })
      }
    }
    const observer = new ResizeObserver(handleResize)
    observer.observe(marginChartRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
      marginChart.current = null
    }
  }, [chips?.margin_short_sale])

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error || !chips) {
    return (
      <Card className="w-full border-destructive">
        <CardContent className="py-4 text-sm text-destructive">
          {error ?? '無籌碼資料'}
        </CardContent>
      </Card>
    )
  }

  const inst = chips.institutional ?? []
  const latestInst = inst[inst.length - 1]
  const totalBuySell = latestInst
    ? {
        外資: latestInst['外資'],
        投信: latestInst['投信'],
        '自營商(避)': latestInst['自營商_避_'],
        '自營商(自)': latestInst['自營商_自_'],
      }
    : null

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'institutional', label: '法人買賣' },
    { key: 'margin', label: '資券餘額' },
    { key: 'ownership', label: '持股結構' },
    { key: 'dayTrading', label: '當日沖銷' },
  ]

  return (
    <Card className="w-full">
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold">籌碼分析</CardTitle>
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-3 py-1 text-xs rounded-md transition-colors',
                  activeTab === tab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {activeTab === 'institutional' && (
          <>
            <div ref={instChartRef} className="w-full" />

            {inst.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  近 {inst.length} 日法人買賣超（單位：張）
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(
                    [
                      { key: '外資', label: '外資' },
                      { key: '投信', label: '投信' },
                      { key: '自營商_避_', label: '自營商(避)' },
                      { key: '主力', label: '主力' },
                    ] as const
                  ).map(({ key, label }) => {
                    const val = key === '主力' ? latestInst?.主力 : (latestInst as never)?.[key]
                    const net = typeof val === 'number' ? val : 0
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between bg-secondary/50 rounded px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor:
                                key === '主力'
                                  ? INST_COLORS['主力']
                                  : INST_COLORS[key === '自營商_避_' ? '自營商(避)' : (key as keyof typeof INST_COLORS)],
                            }}
                          />
                          <span className="text-xs font-medium">{label}</span>
                        </div>
                        <span
                          className={cn(
                            'text-sm font-mono font-semibold',
                            net > 0 ? 'text-red-500' : net < 0 ? 'text-green-500' : 'text-muted-foreground',
                          )}
                        >
                          {net >= 0 ? '+' : ''}
                          {formatK(net)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'margin' && (
          <>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#FF6B6B] inline-block" />
                融資餘額
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#4ECDC4] inline-block" />
                融券餘額
              </span>
            </div>
            <div ref={marginChartRef} className="w-full" />

            {chips.margin_short_sale?.length > 0 && (() => {
              const last = chips.margin_short_sale[chips.margin_short_sale.length - 1] as MarginShortSaleRow
              const marginBalance = last?.MarginPurchaseTodayBalance ?? 0
              const shortBalance = last?.ShortSaleTodayBalance ?? 0
              const ratio = marginBalance > 0 ? ((shortBalance / marginBalance) * 100).toFixed(1) : '0'
              const items = [
                { label: '融資餘額', value: formatK(marginBalance), unit: '張' },
                { label: '融券餘額', value: formatK(shortBalance), unit: '張' },
                { label: '資券比', value: ratio, unit: '%' },
              ]
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {items.map((item) => (
                    <div key={item.label} className="bg-secondary/50 rounded px-3 py-2">
                      <p className="text-muted-foreground">{item.label}</p>
                      <p className="font-semibold font-mono">
                        {item.value}
                        {item.unit}
                      </p>
                    </div>
                  ))}
                </div>
              )
            })()}
          </>
        )}

        {activeTab === 'ownership' && (
          <div className="space-y-3">
            {chips.shareholding ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-secondary/50 rounded px-3 py-2">
                  <p className="text-muted-foreground">外資持股</p>
                  <p className="font-semibold font-mono">
                    {formatRatio(chips.shareholding.ForeignInvestmentShares)} 股
                  </p>
                </div>
                <div className="bg-secondary/50 rounded px-3 py-2">
                  <p className="text-muted-foreground">外資持股比率</p>
                  <p className="font-semibold font-mono">
                    {chips.shareholding.ForeignInvestmentSharesRatio.toFixed(2)}%
                  </p>
                </div>
                <div className="bg-secondary/50 rounded px-3 py-2">
                  <p className="text-muted-foreground">外資持股上限</p>
                  <p className="font-semibold font-mono">
                    {chips.shareholding.ForeignInvestmentUpperLimitRatio.toFixed(0)}%
                  </p>
                </div>
                <div className="bg-secondary/50 rounded px-3 py-2">
                  <p className="text-muted-foreground">發行張數</p>
                  <p className="font-semibold font-mono">
                    {formatRatio(chips.shareholding.NumberOfSharesIssued)} 股
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">無持股結構資料</p>
            )}
          </div>
        )}

        {activeTab === 'dayTrading' && (
          <div className="space-y-3">
            {chips.day_trading?.length > 0 ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <div className="bg-secondary/50 rounded px-3 py-2">
                    <p className="text-muted-foreground">最新日期</p>
                    <p className="font-semibold font-mono">
                      {chips.day_trading[chips.day_trading.length - 1]?.date ?? '-'}
                    </p>
                  </div>
                  <div className="bg-secondary/50 rounded px-3 py-2">
                    <p className="text-muted-foreground">當日沖銷量</p>
                    <p className="font-semibold font-mono">
                      {formatK(chips.day_trading[chips.day_trading.length - 1]?.Volume ?? 0)} 股
                    </p>
                  </div>
                  <div className="bg-secondary/50 rounded px-3 py-2">
                    <p className="text-muted-foreground">當日沖銷金額</p>
                    <p className="font-semibold font-mono">
                      {formatK(chips.day_trading[chips.day_trading.length - 1]?.BuyAmount ?? 0)} 元
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">無當日沖銷資料</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
