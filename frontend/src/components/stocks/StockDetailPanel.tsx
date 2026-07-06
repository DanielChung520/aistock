'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { StockSummaryCard } from '@/components/stocks/StockSummaryCard'
import { BestFourPointCard } from '@/components/stocks/BestFourPointCard'
import { ChipsSection } from '@/components/stocks/ChipsSection'
import { MultiPaneChart } from '@/components/stocks/MultiPaneChart'
import { IndicatorToolbar } from '@/components/stocks/IndicatorToolbar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle } from 'lucide-react'
import { useIndicatorSettings } from '@/hooks/use-indicator-settings'
import type { StockHistoryItem, StockMinuteItem, IndicatorsResponse, IndicatorSettings } from '@/types/stock'

function buildIndicatorParams(settings: IndicatorSettings): string {
  const params = new URLSearchParams()
  if (settings.ma.enabled) {
    params.set('ma_periods', settings.ma.periods.join(','))
    params.set('ma_type', settings.ma.type)
  }
  if (settings.kdj.enabled) {
    params.set('kdj_period', String(settings.kdj.period))
    params.set('kdj_k_smooth', String(settings.kdj.kSmooth))
    params.set('kdj_d_smooth', String(settings.kdj.dSmooth))
  }
  if (settings.rsi.enabled) {
    params.set('rsi_period', String(settings.rsi.period))
  }
  if (settings.macd.enabled) {
    params.set('macd_fast', String(settings.macd.fast))
    params.set('macd_slow', String(settings.macd.slow))
    params.set('macd_signal', String(settings.macd.signal))
  }
  if (settings.bollinger.enabled) {
    params.set('bb_period', String(settings.bollinger.period))
    params.set('bb_std', String(settings.bollinger.stdDev))
  }
  return params.toString()
}

interface BestFourPointResponse {
  best_four_point: { signal: 'buy' | 'sell' | 'neutral'; reason: string }
  buy_analysis: { triggered: boolean; reason: string }
  sell_analysis: { triggered: boolean; reason: string }
}

interface StockDetailPanelProps {
  symbol: string
  stockName?: string
  onNameResolved?: (name: string) => void
  showHeader?: boolean
}

export function StockDetailPanel({
  symbol,
  stockName: externalName,
  onNameResolved,
  showHeader = true,
}: StockDetailPanelProps) {
  const { settings, updateSetting, resetSetting } = useIndicatorSettings()

  const [history, setHistory] = useState<StockHistoryItem[] | null>(null)
  const [stockName, setStockName] = useState<string>(externalName || '')
  const [indicators, setIndicators] = useState<IndicatorsResponse | null>(null)
  const [minuteIndicators, setMinuteIndicators] = useState<IndicatorsResponse | null>(null)
  const [bestFourPoint, setBestFourPoint] = useState<BestFourPointResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<'daily' | 'minute'>('daily')
  const [minuteInterval, setMinuteInterval] = useState<string>('5m')
  const [minuteData, setMinuteData] = useState<StockMinuteItem[] | null>(null)
  const [minuteLoading, setMinuteLoading] = useState(false)
  const [selectedMonths, setSelectedMonths] = useState<number>(6)

  const debounceTimerDaily = useRef<NodeJS.Timeout | null>(null)
  const debounceTimerMinute = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (externalName) {
      setStockName(externalName)
      return
    }
    fetch(`/api/stocks/search?q=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((results: Array<{ stock_id: string; name: string }>) => {
        const match = results.find((s) => s.stock_id === symbol)
        const name = match?.name ?? symbol
        setStockName(name)
        onNameResolved?.(name)
      })
      .catch(() => {
        setStockName(symbol)
        onNameResolved?.(symbol)
      })
  }, [symbol, externalName, onNameResolved])

  useEffect(() => {
    fetch(`/api/stocks/${symbol}/analysis/best-four-point`)
      .then((r) => (r.ok ? r.json() : null))
      .then((bfp) => setBestFourPoint(bfp as BestFourPointResponse | null))
      .catch(() => {})
  }, [symbol])

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const prevSettingsRef = useRef(settings)

  useEffect(() => {
    const fetchDailyData = () => {
      setLoading(true)
      setError(null)
      const indicatorParams = buildIndicatorParams(settingsRef.current)

      Promise.all([
        fetch(`/api/stocks/${symbol}/history?months=${selectedMonths}`).then((r) => {
          if (!r.ok) throw new Error(`股票資料載入失敗 (${r.status})`)
          return r.json() as Promise<StockHistoryItem[]>
        }),
        fetch(`/api/stocks/${symbol}/indicators?months=${selectedMonths}&${indicatorParams}`).then((r) => {
          if (!r.ok) throw new Error(`技術指標載入失敗 (${r.status})`)
          return r.json() as Promise<IndicatorsResponse>
        }),
      ])
        .then(([hist, ind]) => {
          setHistory(hist)
          setIndicators(ind)
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : '載入失敗'
          setError(message)
        })
        .finally(() => {
          setLoading(false)
        })
    }

    const settingsChanged = prevSettingsRef.current !== settings
    prevSettingsRef.current = settings

    if (settingsChanged) {
      if (debounceTimerDaily.current) clearTimeout(debounceTimerDaily.current)
      debounceTimerDaily.current = setTimeout(fetchDailyData, 500)
    } else {
      if (debounceTimerDaily.current) clearTimeout(debounceTimerDaily.current)
      fetchDailyData()
    }

    return () => {
      if (debounceTimerDaily.current) clearTimeout(debounceTimerDaily.current)
    }
  }, [symbol, selectedMonths, settings])

  const handleTimeframeChange = useCallback((newTimeframe: 'daily' | 'minute') => {
    setTimeframe(newTimeframe)
  }, [])

  useEffect(() => {
    if (timeframe === 'minute') {
      const fetchMinuteData = () => {
        setMinuteLoading(true)
        const days = minuteInterval === '1m' ? 7 : 30
        const indicatorParams = buildIndicatorParams(settingsRef.current)

        Promise.all([
          fetch(`/api/stocks/${symbol}/minute-history?days=${days}&interval=${minuteInterval}`).then((r) => {
            if (!r.ok) throw new Error('分K資料載入失敗')
            return r.json()
          }),
          fetch(`/api/stocks/${symbol}/minute-indicators?days=${days}&interval=${minuteInterval}&${indicatorParams}`).then((r) => {
            if (!r.ok) throw new Error('分K指標載入失敗')
            return r.json()
          }),
        ])
          .then(([histData, indData]) => {
            if (Array.isArray(histData)) {
              setMinuteData(histData as StockMinuteItem[])
            } else {
              setMinuteData([])
            }
            setMinuteIndicators(indData as IndicatorsResponse)
          })
          .catch((err: unknown) => {
            console.error(err)
            setMinuteData([])
            setMinuteIndicators(null)
          })
          .finally(() => {
            setMinuteLoading(false)
          })
      }

      const settingsChanged = prevSettingsRef.current !== settings
      if (settingsChanged) {
        if (debounceTimerMinute.current) clearTimeout(debounceTimerMinute.current)
        debounceTimerMinute.current = setTimeout(fetchMinuteData, 500)
      } else {
        if (debounceTimerMinute.current) clearTimeout(debounceTimerMinute.current)
        fetchMinuteData()
      }
    }

    return () => {
      if (debounceTimerMinute.current) clearTimeout(debounceTimerMinute.current)
    }
  }, [timeframe, minuteInterval, symbol, settings])

  const latestItem = history && history.length > 0 ? history[history.length - 1] : undefined
  const prevItem = history && history.length > 1 ? history[history.length - 2] : null
  const changePercent =
    latestItem && prevItem && prevItem.close !== 0
      ? ((latestItem.close - prevItem.close) / prevItem.close) * 100
      : 0

  return (
    <div className="space-y-4 w-full max-w-[100vw] overflow-x-hidden">
      {showHeader && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{symbol}</span>
          <span>{stockName}</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <p className="font-medium text-destructive">載入錯誤</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !error && (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {!loading && !error && history && latestItem && (
        <>
          <StockSummaryCard
            stockId={symbol}
            name={stockName}
            close={latestItem.close}
            change={latestItem.change}
            changePercent={changePercent}
            open={latestItem.open}
            high={latestItem.high}
            low={latestItem.low}
            volume={latestItem.volume}
          />

          <div className="flex items-center gap-1 md:gap-1.5 flex-wrap">
            {[
              { label: '6個月', value: 6 },
              { label: '1年', value: 12 },
              { label: '5年', value: 60 },
              { label: '10年', value: 120 },
              { label: '全部', value: 240 },
            ].map((range) => (
              <Button
                key={range.value}
                variant={selectedMonths === range.value ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedMonths(range.value)}
              >
                {range.label}
              </Button>
            ))}

            <div className="hidden md:block h-5 w-px bg-border mx-1" />

            <Button
              variant={timeframe === 'daily' ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => handleTimeframeChange('daily')}
            >
              日K
            </Button>
            <Button
              variant={timeframe === 'minute' ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => handleTimeframeChange('minute')}
            >
              分K
            </Button>

            {timeframe === 'minute' && (
              <>
                <div className="hidden md:block h-5 w-px bg-border mx-1" />
                {[
                  { label: '1分', value: '1m' },
                  { label: '5分', value: '5m' },
                  { label: '10分', value: '10m' },
                  { label: '15分', value: '15m' },
                  { label: '30分', value: '30m' },
                  { label: '60分', value: '60m' },
                ].map((interval) => (
                  <Button
                    key={interval.value}
                    variant={minuteInterval === interval.value ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setMinuteInterval(interval.value)
                      setMinuteData(null)
                    }}
                  >
                    {interval.label}
                  </Button>
                ))}
              </>
            )}

            <div className="hidden md:block h-5 w-px bg-border mx-1" />

            <IndicatorToolbar
              settings={settings}
              onUpdateSetting={updateSetting}
              onResetSetting={resetSetting}
            />
          </div>

          {timeframe === 'daily' ? (
            <MultiPaneChart
              data={history}
              indicators={indicators}
              settings={settings}
            />
          ) : minuteLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : minuteData && minuteData.length > 0 ? (
            <MultiPaneChart
              data={minuteData.map((d) => ({
                ...d,
                date: d.datetime,
              }))}
              indicators={minuteIndicators}
              settings={settings}
            />
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
                分K資料暫無（yfinance best-effort）
              </CardContent>
            </Card>
          )}

          {timeframe === 'daily' && bestFourPoint && (
            <BestFourPointCard
              stockId={symbol}
              bestFourPoint={bestFourPoint.best_four_point}
              buyAnalysis={bestFourPoint.buy_analysis}
              sellAnalysis={bestFourPoint.sell_analysis}
            />
          )}

          {timeframe === 'daily' && (
            <ChipsSection stockId={symbol} />
          )}
        </>
      )}
    </div>
  )
}
