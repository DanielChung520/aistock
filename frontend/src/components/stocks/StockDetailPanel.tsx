'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { StockSummaryCard } from '@/components/stocks/StockSummaryCard'
import { BestFourPointDrawer } from '@/components/stocks/BestFourPointDrawer'
import { BacktestDrawer } from '@/components/stocks/BacktestDrawer'
import { SimulationFooter } from '@/components/stocks/SimulationFooter'
import { ChipsDrawer } from '@/components/stocks/ChipsDrawer'
import { VolumeProfileDrawer } from '@/components/stocks/VolumeProfileDrawer'
import { MultiPaneChart } from '@/components/stocks/MultiPaneChart'
import { IndicatorToolbar } from '@/components/stocks/IndicatorToolbar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { AlertCircle, TrendingUp, BarChart3, ScanSearch, Camera } from 'lucide-react'
import { useIndicatorSettings } from '@/hooks/use-indicator-settings'
import { useSystemSettings } from '@/hooks/use-system-settings'
import { cachedFetch } from '@/lib/cache/cache-fetch'
import { makeCacheKey } from '@/lib/cache/cache-keys'
import { memGet, memSet } from '@/lib/cache/memory-cache'
import type { StockHistoryItem, StockMinuteItem, BarItem, MinuteBarItem, IndicatorsResponse, IndicatorSettings } from '@/types/stock'
import { DEFAULT_PATTERN_PARAMS, type PatternSelection, type SearchPattern } from '@/types/pattern'

// 產生預設名稱：日期+時間+當天序號（如 20260807-153045-01），台北時區。
async function buildDefaultPatternName(): Promise<string> {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const ymd = `${get('year')}${get('month')}${get('day')}`
  const hms = `${get('hour')}${get('minute')}${get('second')}`
  let serial = 1
  try {
    const res = await fetch('/api/patterns')
    if (res.ok) {
      const list = (await res.json()) as SearchPattern[]
      const todayYmd = ymd
      const count = list.filter((p) => {
        try {
          const d = new Date(p.created_at)
          const dParts = fmt.formatToParts(d)
          const dYmd = `${dParts.find((x) => x.type === 'year')?.value ?? ''}${dParts.find((x) => x.type === 'month')?.value ?? ''}${dParts.find((x) => x.type === 'day')?.value ?? ''}`
          return dYmd === todayYmd
        } catch {
          return false
        }
      }).length
      serial = count + 1
    }
  } catch {
    // 保留 serial = 1
  }
  return `${ymd}-${hms}-${String(serial).padStart(2, '0')}`
}

function buildIndicatorParams(settings: IndicatorSettings): string {
  const params = new URLSearchParams()
  if (settings.ma.enabled) {
    params.set('ma_periods', settings.ma.periods.join(','))
    params.set('ma_lookback', String(settings.ma.lookback))
    params.set('ma_cooldown', String(settings.ma.cooldown))
    params.set('ma_buy_slope_min', String(settings.ma.buySlopeMin))
    params.set('ma_sell_slope_max', String(settings.ma.sellSlopeMax))
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

interface VolumeProfileData {
  date: string
  bucket_size: number
  price_volume: { price: number; volume: number }[]
  vpoc: number
  max_volume: number
  total_volume: number
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
  const { settings: sysSettings } = useSystemSettings()

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
  const [selectedMonths, setSelectedMonths] = useState<number>(0) // 0 = use system default
  const [showBestFourPoint, setShowBestFourPoint] = useState(false)
  const [showChips, setShowChips] = useState(false)
  const [showBacktest, setShowBacktest] = useState(false)
  const [simFocusDate, setSimFocusDate] = useState<string | null>(null)

  // When simulation replay is active, truncate the chart data (and indicators)
  // to the replayed date so future bars are hidden — matching TradingView replay.
  const replayData = simFocusDate
    ? (history ?? []).filter((d) => d.date <= simFocusDate)
    : (history ?? [])
  const replayIndicators = simFocusDate && indicators
    ? {
        ...indicators,
        ma: indicators.ma.filter((d) => d.date <= simFocusDate),
        kdj: indicators.kdj.filter((d) => d.date <= simFocusDate),
        rsi: indicators.rsi.filter((d) => d.date <= simFocusDate),
        macd: indicators.macd.filter((d) => d.date <= simFocusDate),
        bollinger: indicators.bollinger.filter((d) => d.date <= simFocusDate),
      }
    : indicators
  const [chartStyle, setChartStyle] = useState<'candle' | 'line'>('candle')
  const [showVolumeProfile, setShowVolumeProfile] = useState(false)
  const [crosshairDate, setCrosshairDate] = useState<string>('')
  const [volumeProfileData, setVolumeProfileData] = useState<VolumeProfileData | null>(null)

  const [patternSelection, setPatternSelection] = useState<PatternSelection | null>(null)
  const [boxSelectActive, setBoxSelectActive] = useState(false)
  const [patternDialogOpen, setPatternDialogOpen] = useState(false)
  const [patternName, setPatternName] = useState('')
  const [patternSaving, setPatternSaving] = useState(false)

  const savePattern = async () => {
    if (!patternSelection || !patternName.trim()) return
    setPatternSaving(true)
    try {
      const res = await fetch('/api/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: patternName.trim(),
          symbol,
          bars: patternSelection.closes,
          end_date: patternSelection.dates[patternSelection.dates.length - 1] ?? null,
          thumbnail: patternSelection.thumbnail ?? null,
          params: DEFAULT_PATTERN_PARAMS,
          ai_summary: true,
          llm: {
            base_url: sysSettings.llm.baseUrl,
            model: sysSettings.llm.model,
            api_key: sysSettings.llm.apiKey,
            temperature: sysSettings.llm.temperature,
            max_tokens: Math.min(sysSettings.llm.maxTokens, sysSettings.llm.contextWindow),
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `儲存失敗 (${res.status})`)
      }
      toast.success(`已儲存「${patternName.trim()}」`)
      setPatternDialogOpen(false)
      setPatternSelection(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setPatternSaving(false)
    }
  }

  // 拍照/框選完成：填入預設名稱（日期+時間+序號）並開啟命名 dialog。
  const handlePatternSelect = useCallback((sel: PatternSelection | null) => {
    setBoxSelectActive(false)
    setPatternSelection(sel)
    if (!sel) return
    void buildDefaultPatternName().then((name) => {
      setPatternName(name)
      setPatternDialogOpen(true)
    })
  }, [])

  // Ctrl+Shift+Y 切換拍照模式（任何 K 線圖 header 的拍照按鈕亦可切換）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        setBoxSelectActive((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Apply system defaults after settings load
  const sysLoaded = useRef(false)
  if (sysSettings && !sysLoaded.current) {
    sysLoaded.current = true
    if (selectedMonths === 0) setSelectedMonths(sysSettings.defaultTimeRange)
    setChartStyle(sysSettings.defaultChartStyle)
  }

  const debounceTimerDaily = useRef<NodeJS.Timeout | null>(null)
  const debounceTimerMinute = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (externalName) {
      setStockName(externalName)
      return
    }
    cachedFetch<Array<{ stock_id: string; name: string }>>({
      key: makeCacheKey('search', `q=${symbol}`),
      category: 'search',
      fetcher: async () => {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(symbol)}`)
        if (!res.ok) return []
        return res.json()
      },
    }).then((r) => {
      const results = r.data ?? []
      const match = results.find((s) => s.stock_id === symbol)
      const name = match?.name ?? symbol
      setStockName(name)
      onNameResolved?.(name)
    })
  }, [symbol, externalName, onNameResolved])

  useEffect(() => {
    cachedFetch<BestFourPointResponse | null>({
      key: makeCacheKey('stock-analysis', symbol, 'best-four-point'),
      category: 'stock-analysis',
      fetcher: async () => {
        const res = await fetch(`/api/stocks/${symbol}/analysis/best-four-point`)
        if (!res.ok) return null
        return res.json()
      },
    }).then((r) => {
      if (r.data) setBestFourPoint(r.data)
    })
  }, [symbol])

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const prevSettingsRef = useRef(settings)
  const prevSettingsRefMinute = useRef(settings)
  const minuteDataRef = useRef(minuteData)
  minuteDataRef.current = minuteData

  useEffect(() => {
    const settingsChanged = prevSettingsRef.current !== settings
    prevSettingsRef.current = settings

    const fetchDailyData = (showLoading: boolean) => {
      if (showLoading) setLoading(true)
      setError(null)
      const indicatorParams = buildIndicatorParams(settingsRef.current)

      const barsCacheKey = `bars:${symbol}:D:${selectedMonths}`
      const cachedBars = memGet<BarItem[]>(barsCacheKey)
      if (cachedBars) {
        setHistory(cachedBars as StockHistoryItem[])
      }

      Promise.all([
        // OHLCV via /bars (ArangoDB-backed, with memory cache)
        (async () => {
          if (cachedBars) return cachedBars
          const res = await fetch(`/api/stocks/${symbol}/bars?resolution=D&months=${selectedMonths}`)
          if (!res.ok) throw new Error(`股票資料載入失敗 (${res.status})`)
          const data: BarItem[] = await res.json()
          memSet(barsCacheKey, data, 60 * 60 * 1000) // 1h TTL
          return data
        })(),
        // Indicators (server-side calculation, still uses cachedFetch)
        cachedFetch<IndicatorsResponse>({
          key: makeCacheKey('stock-indicators', symbol, `months=${selectedMonths}`, indicatorParams),
          category: 'stock-indicators',
          fetcher: async () => {
            const res = await fetch(
              `/api/stocks/${symbol}/indicators?months=${selectedMonths}&${indicatorParams}`,
            )
            if (!res.ok) throw new Error(`技術指標載入失敗 (${res.status})`)
            return res.json()
          },
        }),
      ])
        .then(([histData, indR]) => {
          if (histData && !cachedBars) setHistory(histData as unknown as StockHistoryItem[])
          if (indR.data) setIndicators(indR.data)
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : '載入失敗'
          setError(message)
        })
        .finally(() => {
          setLoading(false)
        })
    }

    if (settingsChanged) {
      if (debounceTimerDaily.current) clearTimeout(debounceTimerDaily.current)
      debounceTimerDaily.current = setTimeout(() => fetchDailyData(false), 500)
    } else {
      if (debounceTimerDaily.current) clearTimeout(debounceTimerDaily.current)
      fetchDailyData(true)
    }

    return () => {
      if (debounceTimerDaily.current) clearTimeout(debounceTimerDaily.current)
    }
  }, [symbol, selectedMonths, settings])

  const handleTimeframeChange = useCallback((newTimeframe: 'daily' | 'minute') => {
    setTimeframe(newTimeframe)
  }, [])

  useEffect(() => {
    if (history && history.length > 0 && !crosshairDate) {
      setCrosshairDate(history[history.length - 1].date)
    }
  }, [history])

  useEffect(() => {
    if (timeframe === 'minute') {
      setShowVolumeProfile(false)
    }
  }, [timeframe])

  const vpCache = useRef<Map<string, any>>(new Map())

  useEffect(() => {
    if (!showVolumeProfile || !crosshairDate || !symbol) return
    setVolumeProfileData(null)

    // Try memory cache first
    const cacheKey = `vp:${symbol}:${crosshairDate}`
    const cached = vpCache.current.get(cacheKey)
    if (cached) {
      setVolumeProfileData(cached)
      return
    }

    // Fetch the main date
    fetch(`/api/stocks/${symbol}/volume-profile?date=${crosshairDate}`)
      .then((r) => r.json())
      .then((data) => {
        vpCache.current.set(cacheKey, data)
        setVolumeProfileData(data)
      })
      .catch(() => setVolumeProfileData(null))

    // Pre-fetch neighboring dates in background (up to 50)
    if (history && history.length > 0) {
      const currentIdx = history.findIndex((d) => d.date === crosshairDate)
      if (currentIdx >= 0) {
        const range = 25 // 25 before + 25 after = 50 total
        const start = Math.max(0, currentIdx - range)
        const end = Math.min(history.length - 1, currentIdx + range)
        for (let i = start; i <= end; i++) {
          const neighborDate = history[i].date
          const nk = `vp:${symbol}:${neighborDate}`
          if (!vpCache.current.has(nk)) {
            fetch(`/api/stocks/${symbol}/volume-profile?date=${neighborDate}`)
              .then((r) => r.json())
              .then((d) => { vpCache.current.set(nk, d) })
              .catch(() => { /* skip failed prefetch */ })
          }
        }
      }
    }
  }, [showVolumeProfile, crosshairDate, symbol, history])

  useEffect(() => {
    if (timeframe === 'minute') {
      const settingsChanged = prevSettingsRefMinute.current !== settings
      prevSettingsRefMinute.current = settings
      const hasMinuteData = Array.isArray(minuteDataRef.current) && minuteDataRef.current.length > 0
      const initialShowLoading = !settingsChanged || !hasMinuteData

      const fetchMinuteData = (showLoading: boolean) => {
        if (showLoading) setMinuteLoading(true)
        const days = minuteInterval === '1m' ? 7 : 30
        const indicatorParams = buildIndicatorParams(settingsRef.current)

        const minuteBarsKey = `bars:${symbol}:${minuteInterval}:${days}`
        const cachedMinute = memGet<MinuteBarItem[]>(minuteBarsKey)
        if (cachedMinute) {
          setMinuteData(cachedMinute as unknown as StockMinuteItem[])
        }

        Promise.all([
          // Minute OHLCV via /bars (backend aggregates from 1m raw)
          (async () => {
            if (cachedMinute) return cachedMinute
            const res = await fetch(`/api/stocks/${symbol}/bars?resolution=${minuteInterval.replace('m', '')}&days=${days}`)
            if (!res.ok) throw new Error('分K資料載入失敗')
            const data: MinuteBarItem[] = await res.json()
            memSet(minuteBarsKey, data, 60 * 1000) // 1min TTL
            return data
          })(),
          // Minute indicators (server-side calc, still uses cachedFetch)
          cachedFetch<IndicatorsResponse>({
            key: makeCacheKey(
              'stock-minute-indicators',
              symbol,
              `days=${days}`,
              `interval=${minuteInterval}`,
              indicatorParams,
            ),
            category: 'stock-minute-indicators',
            fetcher: async () => {
              const res = await fetch(
                `/api/stocks/${symbol}/minute-indicators?days=${days}&interval=${minuteInterval}&${indicatorParams}`,
              )
              if (!res.ok) throw new Error('分K指標載入失敗')
              return res.json()
            },
          }),
        ])
          .then(([histData, indR]) => {
            if (Array.isArray(histData)) {
              if (!cachedMinute) setMinuteData(histData as unknown as StockMinuteItem[])
            } else {
              setMinuteData([])
            }
            if (indR.data) setMinuteIndicators(indR.data)
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

      if (debounceTimerMinute.current) clearTimeout(debounceTimerMinute.current)
      if (settingsChanged) {
        debounceTimerMinute.current = setTimeout(() => fetchMinuteData(initialShowLoading), 500)
      } else {
        fetchMinuteData(initialShowLoading)
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
    <div className="space-y-4 w-full max-w-[100vw] overflow-x-hidden h-full flex flex-col">
      {showHeader && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{symbol}</span>
          <span>{stockName}</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive shrink-0">
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
        <div className="flex flex-col gap-4 flex-1 min-h-0 relative isolate overflow-y-hidden">
          <StockSummaryCard
            close={latestItem.close}
            change={prevItem ? latestItem.close - prevItem.close : 0}
            changePercent={changePercent}
            open={latestItem.open}
            high={latestItem.high}
            low={latestItem.low}
            volume={latestItem.volume}
          />

          <div className="flex items-center gap-1 md:gap-1.5 flex-wrap shrink-0">
            
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
            <div className="h-5 w-px bg-border mx-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setChartStyle(s => s === 'candle' ? 'line' : 'candle')}
              title={chartStyle === 'candle' ? '切換為線圖' : '切換為K線圖'}
            >
              {chartStyle === 'candle' ? '📊' : '📈'}
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
              accuracy={timeframe === 'daily' ? indicators?.ma_accuracy : minuteIndicators?.ma_accuracy}
            />

            <div className="hidden md:block h-5 w-px bg-border mx-1" />

            <Button
              variant={showBestFourPoint ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => {
                const next = !showBestFourPoint
                setShowBestFourPoint(next)
                if (next) setShowChips(false)
              }}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              四大買賣點分析
            </Button>
            <Button
              variant={showChips ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => {
                const next = !showChips
                setShowChips(next)
                if (next) setShowBestFourPoint(false)
              }}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              籌碼分析
            </Button>
            <Button
              variant={showVolumeProfile ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => {
                const next = !showVolumeProfile
                setShowVolumeProfile(next)
                if (next) setShowBestFourPoint(false)
                if (next) setShowChips(false)
              }}
            >
              📊 分價圖
            </Button>
            <Button
              variant={showBacktest ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => {
                const next = !showBacktest
                setShowBacktest(next)
                if (next) {
                  setShowBestFourPoint(false)
                  setShowChips(false)
                }
              }}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Daniel MA 回測
            </Button>

            <div className="hidden md:block h-5 w-px bg-border mx-1" />
            <Button
              variant={boxSelectActive ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setBoxSelectActive((prev) => !prev)}
              title="拍照存圖形（快捷鍵 Ctrl+Shift+Y）"
            >
              <Camera className="h-3.5 w-3.5" />
              {boxSelectActive ? '取消拍照' : '拍照存圖形'}
            </Button>
          </div>

          <div className="relative flex-1 min-h-0">
            {timeframe === 'daily' ? (
              <MultiPaneChart
                data={replayData}
                indicators={replayIndicators}
                settings={settings}
                fillContainer
                chartStyle={chartStyle}
                focusDate={simFocusDate}
                boxSelectEnabled={boxSelectActive}
                onPatternSelect={handlePatternSelect}
                onCrosshairDateChange={(date) => {
                  if (date) setCrosshairDate(date)
                }}
              />
            ) : minuteLoading ? (
              <Skeleton className="h-full w-full" />
            ) : minuteData && minuteData.length > 0 ? (
              <MultiPaneChart
                data={minuteData.map((d) => ({
                  ...d,
                  date: d.datetime,
                }))}
                indicators={minuteIndicators}
                settings={settings}
                fillContainer
                chartStyle={chartStyle}
                focusDate={simFocusDate}
                boxSelectEnabled={boxSelectActive}
                onPatternSelect={handlePatternSelect}
                onCrosshairDateChange={(date) => {
                  if (date) setCrosshairDate(date)
                }}
              />
            ) : (
              <Card className="h-full">
                <CardContent className="flex items-center justify-center py-12 text-muted-foreground h-full">
                  分K資料暫無（yfinance best-effort）
                </CardContent>
              </Card>
            )}

            {boxSelectActive && (
              <div className="absolute top-12 right-4 z-30 flex items-center gap-2 pointer-events-none">
                <span className="text-[11px] text-muted-foreground bg-card/80 px-2 py-1 rounded border border-border">
                  {patternSelection
                    ? `已框選 ${patternSelection.closes.length} 根K線`
                    : '拖曳選取要儲存的走勢區間'}
                </span>
              </div>
            )}
          </div>

          {bestFourPoint && (
            <BestFourPointDrawer
              isOpen={showBestFourPoint}
              onClose={() => setShowBestFourPoint(false)}
              stockId={symbol}
              bestFourPoint={bestFourPoint.best_four_point}
              buyAnalysis={bestFourPoint.buy_analysis}
              sellAnalysis={bestFourPoint.sell_analysis}
            />
          )}
          <ChipsDrawer
            isOpen={showChips}
            onClose={() => setShowChips(false)}
            stockId={symbol}
          />
          <BacktestDrawer
            isOpen={showBacktest}
            onClose={() => setShowBacktest(false)}
            stockId={symbol}
            stockName={stockName}
          />
          {showVolumeProfile && volumeProfileData && (
            <VolumeProfileDrawer
              isOpen={showVolumeProfile}
              onClose={() => setShowVolumeProfile(false)}
              date={crosshairDate}
              symbol={symbol}
              profileData={volumeProfileData}
            />
          )}
        </div>
      )}

      <SimulationFooter
        symbol={symbol}
        stockName={stockName}
        onDayChange={setSimFocusDate}
        onMonthsChange={setSelectedMonths}
      />

      <Dialog open={patternDialogOpen} onOpenChange={setPatternDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <ScanSearch className="h-4 w-4" />
              儲存為搜索圖形
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {patternSelection?.thumbnail && (
              <div className="rounded-md border border-border overflow-hidden bg-card/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={patternSelection.thumbnail}
                  alt="選取區間預覽"
                  className="w-full h-auto max-h-48 object-contain rounded-sm bg-background/30"
                />
              </div>
            )}
            <Label htmlFor="pattern-name" className="text-xs">名稱</Label>
            <Input
              id="pattern-name"
              value={patternName}
              onChange={(e) => setPatternName(e.target.value)}
              placeholder="例如：V型反轉"
              className="h-8 text-sm"
            />
            {patternSelection && (
              <p className="text-[11px] text-muted-foreground">
                共 {patternSelection.closes.length} 根K線（{patternSelection.dates[0]} ~ {patternSelection.dates[patternSelection.dates.length - 1]}）
              </p>
            )}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setPatternDialogOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={savePattern}
              disabled={patternSaving || !patternName.trim() || !patternSelection}
            >
              {patternSaving ? '儲存中…' : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
