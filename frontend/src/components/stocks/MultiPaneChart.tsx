'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type Time,
  type ISeriesApi,
  type SeriesType,
} from 'lightweight-charts'
import type { IndicatorSettings, IndicatorsResponse } from '@/types/stock'

interface MultiPaneChartProps {
  data: Array<{
    date: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  indicators: IndicatorsResponse | null
  settings: IndicatorSettings
  height?: number
  className?: string
  // When true, container fills parent height; main pane shrinks to fit sub-panes (each 150px).
  fillContainer?: boolean
}

interface TrackedSeries {
  series: ISeriesApi<SeriesType>
  label: string
  color: string
  pane: number
}

function formatNum(v: number, decimals = 2): string {
  return v.toFixed(decimals)
}

function formatVol(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '億'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '萬'
  return v.toLocaleString()
}

function dedupe<T extends { time: unknown }>(arr: T[]): T[] {
  const seen = new Set<string>()
  return arr.filter((d) => {
    const key = String(d.time)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function MultiPaneChart({
  data,
  indicators,
  settings,
  height = 500,
  className,
  fillContainer = false,
}: MultiPaneChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settings)
  const indicatorsRef = useRef(indicators)
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)

  useEffect(() => {
    settingsRef.current = settings
    indicatorsRef.current = indicators
  })

  useEffect(() => {
    if (!fillContainer || !containerRef.current) return
    // Observe the parent element instead of self — the parent is the one being sized
    // by the flex/grid layout above. Self has no definite size, so we can't detect
    // our own effective height via self-observation.
    const parent = containerRef.current.parentElement
    if (!parent) return
    let lastW = -1
    let lastH = -1
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      if (Math.abs(r.width - lastW) > 0.5) {
        lastW = r.width
        if (r.width > 0) setMeasuredWidth(r.width)
      }
      if (Math.abs(r.height - lastH) > 0.5) {
        lastH = r.height
        if (r.height > 0) setMeasuredHeight(r.height)
      }
    })
    ro.observe(parent)
    lastW = parent.clientWidth
    lastH = parent.clientHeight
    setMeasuredWidth(parent.clientWidth)
    setMeasuredHeight(parent.clientHeight)
    return () => ro.disconnect()
  }, [fillContainer])

  const activeSubPanes = [
    settings.volume.enabled,
    settings.kdj.enabled,
    settings.macd.enabled,
    settings.rsi.enabled,
  ].filter(Boolean).length

  const effectiveHeight = fillContainer ? (measuredHeight ?? height) : height
  // In fillContainer mode, canvas = measuredHeight (NOT + subPanes*150) to break height feedback loop.
  // mainPaneHeight is the logical main pane height; sub-panes are stacked below within the same canvas.
  const mainPaneHeight = Math.max(200, effectiveHeight - activeSubPanes * 150)
  const totalHeight = effectiveHeight

  const settingsKey = JSON.stringify(settings)
  const indicatorsVersion = indicators
    ? `${indicators.ma?.length ?? 0}-${indicators.kdj?.length ?? 0}-${indicators.macd?.length ?? 0}-${indicators.rsi?.length ?? 0}-${indicators.bollinger?.length ?? 0}`
    : 'null'

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    const currentSettings = settingsRef.current
    const currentIndicators = indicatorsRef.current

    const isMinuteData = data[0].date.includes(' ') || data[0].date.includes('T')

    const toTime = (dateStr: string): Time => {
      if (!isMinuteData) return dateStr as Time
      const d = new Date(dateStr.replace(' ', 'T') + '+08:00')
      return Math.floor(d.getTime() / 1000) as unknown as Time
    }

    const initialWidth = fillContainer
      ? (measuredWidth ?? containerRef.current.clientWidth)
      : containerRef.current.clientWidth

    // In fillContainer mode: canvas = measuredHeight (parent height).
    // sub-panes get their height from the chart's internal layout.
    // In non-fillContainer mode: canvas = totalHeight (main + sub panes stacked).
    const chartCanvasHeight = fillContainer ? (measuredHeight ?? totalHeight) : totalHeight
    const chart = createChart(containerRef.current, {
      width: initialWidth,
      height: chartCanvasHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: isMinuteData },
    })

    const tracked: TrackedSeries[] = []

    const candlestickSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: '#ef4444',
        downColor: '#22c55e',
        borderUpColor: '#ef4444',
        borderDownColor: '#22c55e',
        wickUpColor: '#ef4444',
        wickDownColor: '#22c55e',
      },
      0
    )

    candlestickSeries.setData(
      dedupe(
        data.map((d) => ({
          time: toTime(d.date),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }))
      )
    )

    tracked.push({ series: candlestickSeries, label: 'OHLCV', color: '', pane: 0 })

    if (currentSettings.ma.enabled && currentIndicators?.ma) {
      const maColors = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6']
      currentSettings.ma.periods.forEach((period, index) => {
        const color = maColors[index % maColors.length]
        const maLineSeries = chart.addSeries(
          LineSeries,
          { color, lineWidth: 1, title: `MA${period}` },
          0
        )

        maLineSeries.setData(
          dedupe(
            currentIndicators.ma
              .filter((d) => d[`ma${period}`] != null)
              .map((d) => ({
                time: toTime(d.date),
                value: d[`ma${period}`] as number,
              }))
          )
        )

        tracked.push({ series: maLineSeries, label: `MA${period}`, color, pane: 0 })
      })
    }

    if (currentSettings.bollinger.enabled && currentIndicators?.bollinger) {
      const upperLine = chart.addSeries(
        LineSeries,
        { color: '#f59e0b', lineWidth: 1, lineStyle: 2, title: 'BB Upper' },
        0
      )
      upperLine.setData(
        dedupe(
          currentIndicators.bollinger
            .filter((d) => d.upper != null)
            .map((d) => ({ time: toTime(d.date), value: d.upper as number }))
        )
      )
      tracked.push({ series: upperLine, label: 'BB上', color: '#f59e0b', pane: 0 })

      const middleLine = chart.addSeries(
        LineSeries,
        { color: '#6b7280', lineWidth: 1, title: 'BB Middle' },
        0
      )
      middleLine.setData(
        dedupe(
          currentIndicators.bollinger
            .filter((d) => d.middle != null)
            .map((d) => ({ time: toTime(d.date), value: d.middle as number }))
        )
      )
      tracked.push({ series: middleLine, label: 'BB中', color: '#6b7280', pane: 0 })

      const lowerLine = chart.addSeries(
        LineSeries,
        { color: '#f59e0b', lineWidth: 1, lineStyle: 2, title: 'BB Lower' },
        0
      )
      lowerLine.setData(
        dedupe(
          currentIndicators.bollinger
            .filter((d) => d.lower != null)
            .map((d) => ({ time: toTime(d.date), value: d.lower as number }))
        )
      )
      tracked.push({ series: lowerLine, label: 'BB下', color: '#f59e0b', pane: 0 })
    }

    let nextPane = 1

    let volumeSeries: ISeriesApi<SeriesType> | null = null
    if (currentSettings.volume.enabled) {
      volumeSeries = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' } },
        nextPane
      )

      volumeSeries.setData(
        dedupe(
          data.map((d) => ({
            time: toTime(d.date),
            value: d.volume,
            color: d.close >= d.open ? '#ef444480' : '#22c55e80',
          }))
        )
      )

      tracked.push({ series: volumeSeries, label: '成交量', color: '#6b7280', pane: nextPane })
      nextPane++
    }

    if (currentSettings.kdj.enabled && currentIndicators?.kdj) {
      const kSeries = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, title: 'K' }, nextPane)
      const dSeries = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, title: 'D' }, nextPane)
      const jSeries = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1, title: 'J' }, nextPane)

      kSeries.setData(dedupe(currentIndicators.kdj.filter((d) => d.k != null).map((d) => ({ time: toTime(d.date), value: d.k }))))
      dSeries.setData(dedupe(currentIndicators.kdj.filter((d) => d.d != null).map((d) => ({ time: toTime(d.date), value: d.d }))))
      jSeries.setData(dedupe(currentIndicators.kdj.filter((d) => d.j != null).map((d) => ({ time: toTime(d.date), value: d.j }))))

      tracked.push({ series: kSeries, label: 'K', color: '#3b82f6', pane: nextPane })
      tracked.push({ series: dSeries, label: 'D', color: '#f97316', pane: nextPane })
      tracked.push({ series: jSeries, label: 'J', color: '#a855f7', pane: nextPane })
      nextPane++
    }

    if (currentSettings.macd.enabled && currentIndicators?.macd) {
      const histogramSeries = chart.addSeries(HistogramSeries, {}, nextPane)
      const difSeries = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, title: 'DIF' }, nextPane)
      const signalSeries = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, title: 'MACD' }, nextPane)

      histogramSeries.setData(
        dedupe(
          currentIndicators.macd
            .filter((d) => d.histogram != null)
            .map((d) => ({
              time: toTime(d.date),
              value: d.histogram as number,
              color: (d.histogram as number) >= 0 ? '#ef4444' : '#22c55e',
            }))
        )
      )
      difSeries.setData(
        dedupe(currentIndicators.macd.filter((d) => d.dif != null).map((d) => ({ time: toTime(d.date), value: d.dif as number })))
      )
      signalSeries.setData(
        dedupe(currentIndicators.macd.filter((d) => d.signal != null).map((d) => ({ time: toTime(d.date), value: d.signal as number })))
      )

      tracked.push({ series: histogramSeries, label: 'MACD柱', color: '#6b7280', pane: nextPane })
      tracked.push({ series: difSeries, label: 'DIF', color: '#3b82f6', pane: nextPane })
      tracked.push({ series: signalSeries, label: 'MACD', color: '#f97316', pane: nextPane })
      nextPane++
    }

    if (currentSettings.rsi.enabled && currentIndicators?.rsi) {
      const rsiSeries = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1, title: 'RSI' }, nextPane)

      rsiSeries.setData(
        dedupe(currentIndicators.rsi.filter((d) => d.rsi != null).map((d) => ({ time: toTime(d.date), value: d.rsi as number })))
      )

      tracked.push({ series: rsiSeries, label: 'RSI', color: '#a855f7', pane: nextPane })
      nextPane++
    }

    const panes = chart.panes()
    if (panes.length > 0) {
      panes[0].setStretchFactor(3)
      for (let i = 1; i < panes.length; i++) {
        panes[i].setStretchFactor(1)
      }
    }

    const overlayEl = document.createElement('div')
    overlayEl.style.cssText = 'position:absolute;top:8px;left:8px;pointer-events:none;z-index:10;font-size:11px;line-height:1.4;'
    containerRef.current.appendChild(overlayEl)

    const subOverlays = new Map<number, HTMLDivElement>()
    if (panes.length > 1) {
      const mainPaneHeight = Math.round(totalHeight * 3 / (3 + (panes.length - 1)))
      const subPaneHeight = Math.round(totalHeight / (3 + (panes.length - 1)))
      for (let i = 1; i < panes.length; i++) {
        const subEl = document.createElement('div')
        const top = mainPaneHeight + (i - 1) * subPaneHeight + 4
        subEl.style.cssText = `position:absolute;top:${top}px;left:8px;pointer-events:none;z-index:10;font-size:11px;line-height:1.4;`
        containerRef.current.appendChild(subEl)
        subOverlays.set(i, subEl)
      }
    }

    const buildOhlcvHtml = (o: number, h: number, l: number, c: number, vol: number, prev?: number): string => {
      const changeColor = prev != null ? (c > prev ? '#ef4444' : c < prev ? '#22c55e' : '#9ca3af') : '#9ca3af'
      return [
        `<span style="color:#9ca3af">開</span> <span style="color:${changeColor}">${formatNum(o)}</span>`,
        `<span style="color:#9ca3af">高</span> <span style="color:#ef4444">${formatNum(h)}</span>`,
        `<span style="color:#9ca3af">低</span> <span style="color:#22c55e">${formatNum(l)}</span>`,
        `<span style="color:#9ca3af">收</span> <span style="color:${changeColor}">${formatNum(c)}</span>`,
        `<span style="color:#9ca3af">量</span> <span style="color:#d1d5db">${formatVol(vol)}</span>`,
      ].join('&nbsp;&nbsp;')
    }

    const buildIndicatorHtml = (seriesList: TrackedSeries[], seriesDataMap: Map<ISeriesApi<SeriesType>, Record<string, unknown>>): string => {
      const parts: string[] = []
      for (const t of seriesList) {
        if (t.label === 'OHLCV' || t.label === '成交量' || t.label === 'MACD柱') continue
        const val = seriesDataMap.get(t.series)
        if (!val || val.value == null) continue
        parts.push(`<span style="color:${t.color}">${t.label}</span> ${formatNum(val.value as number)}`)
      }
      return parts.join('&nbsp;&nbsp;')
    }

    const buildSubPaneHtml = (paneIdx: number, seriesDataMap: Map<ISeriesApi<SeriesType>, Record<string, unknown>>): string => {
      const paneTracked = tracked.filter((t) => t.pane === paneIdx)
      const parts: string[] = []
      for (const t of paneTracked) {
        const val = seriesDataMap.get(t.series)
        if (!val) continue
        if ('value' in val && val.value != null) {
          if (t.label === '成交量') {
            parts.push(`<span style="color:${t.color}">${t.label}</span> ${formatVol(val.value as number)}`)
          } else {
            parts.push(`<span style="color:${t.color}">${t.label}</span> ${formatNum(val.value as number)}`)
          }
        }
      }
      return parts.join('&nbsp;&nbsp;')
    }

    const lastItem = data[data.length - 1]
    const prevItem = data.length > 1 ? data[data.length - 2] : undefined
    overlayEl.innerHTML = buildOhlcvHtml(lastItem.open, lastItem.high, lastItem.low, lastItem.close, lastItem.volume, prevItem?.close)

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData || param.seriesData.size === 0) {
        overlayEl.innerHTML = buildOhlcvHtml(lastItem.open, lastItem.high, lastItem.low, lastItem.close, lastItem.volume, prevItem?.close)
        subOverlays.forEach((el, paneIdx) => {
          el.innerHTML = ''
          const paneTracked = tracked.filter((t) => t.pane === paneIdx)
          if (paneTracked.length > 0) {
            const lastParts: string[] = []
            for (const t of paneTracked) {
              if (t.label === '成交量') {
                lastParts.push(`<span style="color:${t.color}">${t.label}</span> ${formatVol(lastItem.volume)}`)
              }
            }
            el.innerHTML = lastParts.join('&nbsp;&nbsp;')
          }
        })
        return
      }

      const seriesDataMap = param.seriesData as unknown as Map<ISeriesApi<SeriesType>, Record<string, unknown>>
      const ohlcvData = seriesDataMap.get(candlestickSeries) as Record<string, unknown> | undefined

      let hoveredIdx = -1
      if (param.time) {
        hoveredIdx = data.findIndex((d) => {
          const t = toTime(d.date)
          return t === param.time
        })
      }
      const prevClose = hoveredIdx > 0 ? data[hoveredIdx - 1].close : undefined

      if (ohlcvData && 'open' in ohlcvData) {
        const o = ohlcvData.open as number
        const h = ohlcvData.high as number
        const l = ohlcvData.low as number
        const c = ohlcvData.close as number
        const volData = hoveredIdx >= 0 ? data[hoveredIdx].volume : 0
        const mainIndicators = buildIndicatorHtml(tracked.filter((t) => t.pane === 0), seriesDataMap)
        overlayEl.innerHTML = buildOhlcvHtml(o, h, l, c, volData, prevClose)
          + (mainIndicators ? '<br/>' + mainIndicators : '')
      }

      subOverlays.forEach((el, paneIdx) => {
        el.innerHTML = buildSubPaneHtml(paneIdx, seriesDataMap)
      })
    })

    // Set explicit main pane height in fillContainer mode so chart fills container
    if (fillContainer && mainPaneHeight > 0) {
      try {
        const panes = chart.panes()
        if (panes[0] && typeof panes[0].setHeight === 'function') {
          panes[0].setHeight(mainPaneHeight)
        }
      } catch (e) {
        // Older lightweight-charts versions may not support setHeight; ignore
      }
    }

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      overlayEl.remove()
      subOverlays.forEach((el) => el.remove())
    }
  }, [data, settingsKey, indicatorsVersion, height, measuredWidth, measuredHeight])

  if (data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center h-[500px] border border-dashed rounded-md ${
          className || ''
        }`}
      >
        <p className="text-muted-foreground">資料不足</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        // Dual approach for fillContainer:
        // 1. height: '100%' — works when parent has definite CSS height (block parent, e.g. expanded view)
        // 2. flex: 1 1 0%; min-height: 0 — works when parent is a flex container
        // Having both is safe: flex wins in flex context, height wins in block context.
        height: fillContainer ? '100%' : totalHeight,
        flex: fillContainer ? '1 1 0%' : undefined,
        minHeight: fillContainer ? 0 : undefined,
        width: '100%',
        position: 'relative',
      }}
    />
  )
}
