'use client'

import { useEffect, useState, useRef } from 'react'
import { AppShell } from '@/components/app-shell'
import { MyStocksList } from '@/components/stocks/MyStocksList'
import { TodayNewsPanel } from '@/components/stocks/TodayNewsPanel'
import { StockDetailPanel } from '@/components/stocks/StockDetailPanel'
import { MultiPaneChart } from '@/components/stocks/MultiPaneChart'
import { IndicatorToolbar } from '@/components/stocks/IndicatorToolbar'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Maximize2, Minimize2, ArrowLeft } from 'lucide-react'
import { useIndicatorSettings } from '@/hooks/use-indicator-settings'
import { useStockTabs } from '@/lib/stock-tab-context'
import type { IndicatorsResponse, IndicatorSettings } from '@/types/stock'

type TaiexDataPoint = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type TaiexData = {
  title: string
  data: TaiexDataPoint[]
  error?: string
}

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

type SettingUpdater = <K extends keyof Omit<IndicatorSettings, 'version'>>(
  indicator: K,
  values: Partial<IndicatorSettings[K]>,
) => void

type SettingResetter = (
  indicator: keyof Omit<IndicatorSettings, 'version'>,
) => void

function TaiexChartSection({
  taiex,
  indicators,
  loading,
  selectedMonths,
  onMonthsChange,
  settings,
  onUpdateSetting,
  onResetSetting,
  height = 400,
  showTitle = true,
  fillContainer = false,
}: {
  taiex: TaiexData | null
  indicators: IndicatorsResponse | null
  loading: boolean
  selectedMonths: number
  onMonthsChange: (m: number) => void
  settings: IndicatorSettings
  onUpdateSetting: SettingUpdater
  onResetSetting: SettingResetter
  height?: number
  showTitle?: boolean
  fillContainer?: boolean
}) {
  const timeRanges = [
    { label: '1月', value: 1 },
    { label: '3月', value: 3 },
    { label: '6月', value: 6 },
    { label: '1年', value: 12 },
    { label: '5年', value: 60 },
  ]

  return (
    <div className="space-y-4 flex flex-col h-full">
      {showTitle && (
        <h3 className="text-base font-semibold text-foreground">
          加權指數走勢
        </h3>
      )}
      <div className="flex items-center gap-1 md:gap-1.5 flex-wrap shrink-0">
        {timeRanges.map((range) => (
          <Button
            key={range.value}
            variant={selectedMonths === range.value ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onMonthsChange(range.value)}
          >
            {range.label}
          </Button>
        ))}
        <div className="h-5 w-px bg-border mx-1 hidden md:block" />
        <IndicatorToolbar
          settings={settings}
          onUpdateSetting={onUpdateSetting}
          onResetSetting={onResetSetting}
        />
      </div>
      <div className="flex-1 min-h-0">
        {loading ? (
          <Skeleton className="h-full w-full rounded-xl" />
        ) : taiex?.data && taiex.data.length > 0 ? (
          <div className="h-full bg-card/30 rounded-xl border border-border shadow-sm overflow-hidden">
            <MultiPaneChart
              data={taiex.data}
              indicators={indicators}
              settings={{
                ...settings,
                volume: { enabled: false },
              }}
              height={height}
              fillContainer={fillContainer}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            暫無圖表資料
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { settings, updateSetting, resetSetting } = useIndicatorSettings()

  const [taiex, setTaiex] = useState<TaiexData | null>(null)
  const [loadingTaiex, setLoadingTaiex] = useState(true)
  const [indicators, setIndicators] = useState<IndicatorsResponse | null>(null)
  const [selectedMonths, setSelectedMonths] = useState(6)
  const [chartExpanded, setChartExpanded] = useState(false)
  const { activeTab, openTab, tabs, setActiveTab } = useStockTabs()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const stock = params.get('stock')
    const name = params.get('name') || stock || ''
    if (stock) {
      openTab(stock, name)
    }
  }, [openTab])

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const prevSettingsRef = useRef(settings)
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    async function fetchTaiex() {
      setLoadingTaiex(true)
      try {
        const [histRes, indRes] = await Promise.all([
          fetch(`/api/market/taiex?months=${selectedMonths}`),
          fetch(
            `/api/market/taiex/indicators?months=${selectedMonths}&${buildIndicatorParams(settingsRef.current)}`,
          ),
        ])

        if (histRes.ok) {
          const data = (await histRes.json()) as TaiexData
          setTaiex(data)
        }
        if (indRes.ok) {
          const indData = (await indRes.json()) as IndicatorsResponse
          setIndicators(indData)
        }
      } catch (error) {
        console.error('Failed to fetch TAIEX:', error)
      } finally {
        setLoadingTaiex(false)
      }
    }

    const settingsChanged = prevSettingsRef.current !== settings
    prevSettingsRef.current = settings

    if (settingsChanged) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(fetchTaiex, 500)
    } else {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      fetchTaiex()
    }

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [selectedMonths, settings])

  const latestData = taiex?.data?.[taiex.data.length - 1]
  const prevData = taiex?.data?.[taiex.data.length - 2]

  let change = 0
  let changePercent = 0
  if (latestData && prevData) {
    change = latestData.close - prevData.close
    changePercent = (change / prevData.close) * 100
  }

  const isUp = change > 0
  const isDown = change < 0
  const colorClass = isUp ? 'text-red-500' : isDown ? 'text-green-500' : 'text-gray-400'
  const sign = isUp ? '+' : ''

  if (chartExpanded) {
    return (
      <AppShell title="台股儀表板">
        <div className="p-4 md:p-6 mx-auto max-w-7xl h-[calc(100vh-4rem)] flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setChartExpanded(false)}
            >
              <ArrowLeft className="h-4 w-4" />
              返回儀表板
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tabular-nums tracking-tight">
                {latestData
                  ? latestData.close.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : '--'}
              </span>
              {latestData && prevData && (
                <span className={cn('text-sm font-semibold', colorClass)}>
                  {sign}
                  {change.toFixed(2)} ({sign}
                  {changePercent.toFixed(2)}%)
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setChartExpanded(false)}
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <TaiexChartSection
              taiex={taiex}
              indicators={indicators}
              loading={loadingTaiex}
              selectedMonths={selectedMonths}
              onMonthsChange={setSelectedMonths}
              settings={settings}
              onUpdateSetting={updateSetting}
              onResetSetting={resetSetting}
              showTitle={false}
              fillContainer
            />
          </div>
        </div>
      </AppShell>
    )
  }

  const activeTabInfo = activeTab ? tabs.find((t) => t.symbol === activeTab) : null
  const appTitle = activeTabInfo ? `${activeTabInfo.name}-${activeTabInfo.symbol}` : '台股儀表板'

  return (
    <AppShell title={appTitle}>
      {/* Dashboard view */}
      <div className={activeTab ? 'hidden' : 'h-full'}>
        <div
          className="p-4 md:p-6 flex flex-col h-full overflow-hidden"
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 flex-1 min-h-0">
            {/* Left: TAIEX Summary + Chart */}
            <div className="lg:col-span-2 flex flex-col min-h-0 gap-4 md:gap-6">
              {/* TAIEX Summary Card */}
              <Card className="border-border bg-card/50 backdrop-blur-sm shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-medium text-muted-foreground">
                    {latestData
                      ? `${latestData.date} 加權指數`
                      : taiex?.title || '加權指數'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingTaiex ? (
                    <div className="space-y-3">
                      <Skeleton className="h-10 w-32 bg-muted" />
                      <Skeleton className="h-5 w-24 bg-muted" />
                    </div>
                  ) : taiex?.data?.length === 0 ? (
                    <div className="text-muted-foreground py-4 text-center">
                      {taiex?.error ? (
                        <>
                          <div className="text-sm mb-2">暫無資料</div>
                          <div className="text-xs text-gray-500">
                            市場可能休市中
                          </div>
                        </>
                      ) : (
                        '暫無資料'
                      )}
                    </div>
                  ) : latestData ? (
                    <div className="flex flex-col justify-center">
                      <div className="text-4xl font-bold text-foreground tracking-tight">
                        {latestData.close.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                      <div
                        className={cn(
                          'mt-2 text-sm font-semibold flex items-center',
                          colorClass,
                        )}
                      >
                        {sign}
                        {change.toFixed(2)} ({sign}
                        {changePercent.toFixed(2)}%)
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground py-4">暫無資料</div>
                  )}
                </CardContent>
              </Card>

              {/* TAIEX Chart Section Header */}
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">
                  加權指數走勢
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setChartExpanded(true)}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* TAIEX Chart Controls */}
              <div className="flex items-center gap-1 md:gap-1.5 flex-wrap">
                {[
                  { label: '1月', value: 1 },
                  { label: '3月', value: 3 },
                  { label: '6月', value: 6 },
                  { label: '1年', value: 12 },
                  { label: '5年', value: 60 },
                ].map((range) => (
                  <Button
                    key={range.value}
                    variant={
                      selectedMonths === range.value ? 'default' : 'outline'
                    }
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setSelectedMonths(range.value)}
                  >
                    {range.label}
                  </Button>
                ))}
                <div className="h-5 w-px bg-border mx-1 hidden md:block" />
                <IndicatorToolbar
                  settings={settings}
                  onUpdateSetting={updateSetting}
                  onResetSetting={resetSetting}
                />
              </div>

              {/* TAIEX Chart */}
              <div className="flex-1 min-h-0 bg-card/30 rounded-xl border border-border shadow-sm overflow-hidden">
                {loadingTaiex ? (
                  <Skeleton className="h-full w-full rounded-xl" />
                ) : taiex?.data && taiex.data.length > 0 ? (
                  <MultiPaneChart
                    data={taiex.data}
                    indicators={indicators}
                    settings={{
                      ...settings,
                      volume: { enabled: false },
                    }}
                    fillContainer
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    暫無圖表資料
                  </div>
                )}
              </div>
            </div>

            {/* Right: Today's News */}
            <div className="lg:col-span-1 flex flex-col min-h-0">
              <TodayNewsPanel onSelectStock={openTab} />
            </div>
          </div>
        </div>
      </div>

      {/* Stock tab panels — always rendered, visibility toggled */}
      {tabs.map((tab) => (
        <div key={tab.symbol} className={activeTab === tab.symbol ? '' : 'hidden'}>
          <div className="p-4 md:p-6 max-w-[100vw] overflow-x-hidden">
            <Button
              variant="ghost"
              size="sm"
              className="mb-3 gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setActiveTab(null)}
            >
              <ArrowLeft className="h-4 w-4" />
              返回儀表板
            </Button>
            <StockDetailPanel
              symbol={tab.symbol}
              stockName={tab.name}
              showHeader={false}
            />
          </div>
        </div>
      ))}
    </AppShell>
  )
}
