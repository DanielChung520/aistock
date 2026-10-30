'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  type Time,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesType,
  type Logical,
} from 'lightweight-charts'
import type { IndicatorSettings, IndicatorsResponse } from '@/types/stock'
import type { PatternSelection } from '@/types/pattern'

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
  chartStyle?: 'candle' | 'line'
  onCrosshairDateChange?: (date: string | null) => void
  // When set (simulation replay), the chart scrolls so this date is visible.
  focusDate?: string | null
  // 圖形搜索：受控的拍照/框選模式。由外部（拍照按鈕 / Ctrl+Shift+Y）切換；
  // 啟用期間拖曳選取一段 K 線，選取完成後呼叫 onPatternSelect（含縮圖）。
  boxSelectEnabled?: boolean
  onPatternSelect?: (selection: PatternSelection | null) => void
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

function buildOhlcvHtml(o: number, h: number, l: number, c: number, vol: number, prev?: number): string {
  const changeColor = prev != null ? (c > prev ? '#ef4444' : c < prev ? '#22c55e' : '#9ca3af') : '#9ca3af'
  return [
    `<span style="color:#9ca3af">開</span> <span style="color:${changeColor}">${formatNum(o)}</span>`,
    `<span style="color:#9ca3af">高</span> <span style="color:#ef4444">${formatNum(h)}</span>`,
    `<span style="color:#9ca3af">低</span> <span style="color:#22c55e">${formatNum(l)}</span>`,
    `<span style="color:#9ca3af">收</span> <span style="color:${changeColor}">${formatNum(c)}</span>`,
    `<span style="color:#9ca3af">量</span> <span style="color:#d1d5db">${formatVol(vol)}</span>`,
  ].join('&nbsp;&nbsp;')
}

function withAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) return hex
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `${hex}${a}`
}

// lightweight-charts requires strictly ascending time; sort defensively BEFORE
// de-duplicating so any upstream disorder (backend merge, cache) cannot crash setData.
function dedupe<T extends { time: unknown }>(arr: T[]): T[] {
  const sorted = [...arr].sort((a, b) => {
    const at = a.time
    const bt = b.time
    if (typeof at === 'number' && typeof bt === 'number') return at - bt
    return String(at) < String(bt) ? -1 : String(at) > String(bt) ? 1 : 0
  })
  const seen = new Set<string>()
  return sorted.filter((d) => {
    const key = String(d.time)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// 初始檢視窗為最近 6 個月；完整歷史仍會載入/快取並可向左捲動檢視，勿改為截斷資料。
const DEFAULT_VIEW_MONTHS = 6

export function MultiPaneChart({
  data,
  indicators,
  settings,
  height = 500,
  className,
  fillContainer = false,
  chartStyle = 'candle',
  onCrosshairDateChange,
  focusDate,
  boxSelectEnabled = false,
  onPatternSelect,
}: MultiPaneChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const focusDateRef = useRef<string | null | undefined>(null)
  focusDateRef.current = focusDate
  const settingsRef = useRef(settings)
  const indicatorsRef = useRef(indicators)
  // Keep the latest callback without re-running the chart-building effect
  // (the parent passes an inline arrow that changes identity every render).
  const onCrosshairDateChangeRef = useRef(onCrosshairDateChange)
  onCrosshairDateChangeRef.current = onCrosshairDateChange
  const onPatternSelectRef = useRef(onPatternSelect)
  onPatternSelectRef.current = onPatternSelect
  // 記住目前可視範圍（logical index），供圖表重建（指標開關、尺寸變更）時沿用；
  // 換股或重新抓取資料（dataKey 改變）時才回到預設檢視窗。
  const lastRangeRef = useRef<{ from: number; to: number } | null>(null)
  const prevDataKeyRef = useRef<string | null>(null)
  const prevStructuralKeyRef = useRef<string | null>(null)
  const prevBarCountRef = useRef(0)
  // Chart + main series are reused across indicator toggles; only indicator series are rebuilt.
  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const overlayElRef = useRef<HTMLDivElement | null>(null)
  const subOverlaysRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const trackedRef = useRef<TrackedSeries[]>([])
  const indicatorSeriesRef = useRef<ISeriesApi<SeriesType>[]>([])
  const isLineRef = useRef(false)
  const dataRef = useRef(data)
  const effectiveHeightRef = useRef(0)
  const fillContainerRef = useRef(fillContainer)
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)

  // 框選（圖形搜索）狀態 — 由外部受控（拍照按鈕 / Ctrl+Shift+Y），
  // boxSelectEnabled 即為「拍照模式是否啟用」。
  const [boxRect, setBoxRect] = useState<{ left: number; width: number } | null>(null)
  const dragStartRef = useRef<{ x: number; index: number } | null>(null)
  const dragEndXRef = useRef(0)

  // 框選完成時截取選取區間縮圖（輕量級圖表原生截圖 + 裁切）
  const captureThumbnail = useCallback(
    (from: number, to: number): string | null => {
      const chart = chartRef.current
      const container = containerRef.current
      if (!chart || !container) return null
      try {
        const canvas = chart.takeScreenshot()
        const rect = container.getBoundingClientRect()
        const leftScaleWidth = chart.priceScale('left')?.width?.() ?? 0
        const x1Css = leftScaleWidth + (chart.timeScale().logicalToCoordinate(from as unknown as Logical) ?? 0)
        const x2Css = leftScaleWidth + (chart.timeScale().logicalToCoordinate(to + 1 as unknown as Logical) ?? 0)
        const scale = canvas.width / Math.max(1, rect.width)
        const sx = Math.max(0, Math.round(x1Css * scale))
        const sw = Math.min(canvas.width - sx, Math.max(1, Math.round((x2Css - x1Css) * scale)))
        if (sw <= 1) return null
        // 只截主圖（main pane）：takeScreenshot() 會把所有 sub-pane（成交量/KDJ/MACD/RSI）
        // 與底部時間軸一起合成。若直接用 canvas.height，縮圖會被下方 sub-pane 撐高，
        // 導致選取區間在縮圖中擠在上半部、視覺上「沒置中、圖形奇怪」。
        // lightweight-charts v5 內部以 <table> 排版 panes，第一個 <tr> 就是主圖列，
        // 量測其高度（CSS px）後乘上 scale 即可得到 canvas 中主圖的像素高度。
        const firstRow = container.querySelector('table tr') as HTMLElement | null
        const mainPaneHeightCss = firstRow ? firstRow.getBoundingClientRect().height : rect.height
        const sh = Math.max(1, Math.min(canvas.height, Math.round(mainPaneHeightCss * scale)))
        // 縮到最大寬度 360px，避免 ArangoDB 文件過大
        const maxW = 360
        const outW = Math.min(sw, maxW)
        const outH = Math.max(1, Math.round(sh * (outW / sw)))
        const out = document.createElement('canvas')
        out.width = outW
        out.height = outH
        const ctx = out.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(canvas, sx, 0, sw, sh, 0, 0, outW, outH)
        return out.toDataURL('image/png')
      } catch (err) {
        console.error('截取縮圖失敗:', err)
        return null
      }
    },
    []
  )

  // lightweight-charts 原生 pan/zoom 會攔截 pointer 事件；框選模式下用 capture
  // 階段的 listener 攔截 pointerdown/move/up，避免拖曳變成平移。handler 內
  // 即時讀取 chartRef.current，避免 effect 早於圖表建立而綁定失敗。
  useEffect(() => {
    const container = containerRef.current
    if (!container || !boxSelectEnabled) return

    const toLogicalIndex = (clientX: number): number | null => {
      const chart = chartRef.current
      if (!chart) return null
      const rect = container.getBoundingClientRect()
      const leftScaleWidth = chart.priceScale('left')?.width?.() ?? 0
      const x = clientX - rect.left - leftScaleWidth
      const logical = chart.timeScale().coordinateToLogical(x)
      if (logical == null) return null
      return Math.max(0, Math.min(data.length - 1, Math.round(logical)))
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const index = toLogicalIndex(e.clientX)
      if (index == null) return
      dragStartRef.current = { x: e.clientX, index }
      dragEndXRef.current = e.clientX
      const rect = container.getBoundingClientRect()
      setBoxRect({ left: e.clientX - rect.left, width: 0 })
      e.preventDefault()
      e.stopPropagation()
      container.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      const start = dragStartRef.current
      if (!start) return
      dragEndXRef.current = e.clientX
      const rect = container.getBoundingClientRect()
      setBoxRect({
        left: Math.min(start.x, e.clientX) - rect.left,
        width: Math.abs(e.clientX - start.x),
      })
      e.preventDefault()
      e.stopPropagation()
    }

    const onPointerUp = (e: PointerEvent) => {
      const start = dragStartRef.current
      if (!start) return
      const endIndex = toLogicalIndex(e.clientX)
      dragStartRef.current = null
      dragEndXRef.current = 0
      setBoxRect(null)
      e.preventDefault()
      e.stopPropagation()
      if (endIndex == null) return
      const from = Math.min(start.index, endIndex)
      const to = Math.max(start.index, endIndex)
      if (to - from + 1 < 5) {
        onPatternSelectRef.current?.(null)
        return
      }
      const dates = data.slice(from, to + 1).map((d) => d.date)
      const closes = data.slice(from, to + 1).map((d) => d.close)
      const thumbnail = captureThumbnail(from, to) ?? undefined
      onPatternSelectRef.current?.({ dates, closes, thumbnail })
    }

    container.addEventListener('pointerdown', onPointerDown, true)
    container.addEventListener('pointermove', onPointerMove, true)
    container.addEventListener('pointerup', onPointerUp, true)
    container.addEventListener('pointercancel', onPointerUp, true)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true)
      container.removeEventListener('pointermove', onPointerMove, true)
      container.removeEventListener('pointerup', onPointerUp, true)
      container.removeEventListener('pointercancel', onPointerUp, true)
    }
  }, [boxSelectEnabled, data, captureThumbnail])

  useEffect(() => {
    settingsRef.current = settings
    indicatorsRef.current = indicators
    dataRef.current = data
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

  const effectiveHeight = Math.max(280, fillContainer ? (measuredHeight ?? height) : height)
  const totalHeight = effectiveHeight
  effectiveHeightRef.current = effectiveHeight
  fillContainerRef.current = fillContainer

  const settingsKey = JSON.stringify(settings) + ':' + chartStyle
  const indicatorsVersion = indicators
    ? `${indicators.ma?.length ?? 0}-${indicators.kdj?.length ?? 0}-${indicators.macd?.length ?? 0}-${indicators.rsi?.length ?? 0}-${indicators.bollinger?.length ?? 0}`
    : 'null'

  // Rebuilds ONLY the indicator series on the existing chart (chart + main series persist).
  const renderIndicators = useCallback(() => {
    const chart = chartRef.current
    const mainSeries = mainSeriesRef.current
    const bars = dataRef.current
    if (!chart || !mainSeries || bars.length === 0) return

    const curSettings = settingsRef.current
    const curIndicators = indicatorsRef.current
    const isMinuteData = bars[0].date.includes(' ') || bars[0].date.includes('T')
    const toTime = (dateStr: string): Time => {
      if (!isMinuteData) return dateStr as Time
      const d = new Date(dateStr.replace(' ', 'T') + '+08:00')
      return Math.floor(d.getTime() / 1000) as unknown as Time
    }

    for (const s of indicatorSeriesRef.current) {
      try {
        chart.removeSeries(s)
      } catch {
        // pane/series may already be gone
      }
    }
    indicatorSeriesRef.current = []

    if (isLineRef.current) {
      ;(mainSeries as ISeriesApi<'Line'>).setData(
        dedupe(bars.map((d) => ({ time: toTime(d.date), value: d.close }))),
      )
    } else {
      ;(mainSeries as ISeriesApi<'Candlestick'>).setData(
        dedupe(
          bars.map((d) => ({
            time: toTime(d.date),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          })),
        ),
      )
    }

    const tracked: TrackedSeries[] = [
      { series: mainSeries, label: isLineRef.current ? 'Close' : 'OHLCV', color: '', pane: 0 },
    ]

    const maData = curIndicators?.ma
    if (curSettings.ma.enabled && maData) {
      const maColors = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6']
      curSettings.ma.periods.forEach((period, index) => {
        const color = maColors[index % maColors.length]
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1, title: `MA${period}`, priceScaleId: 'left' }, 0)
        s.setData(dedupe(maData.filter((d) => d[`ma${period}`] != null).map((d) => ({ time: toTime(d.date), value: d[`ma${period}`] as number }))))
        indicatorSeriesRef.current.push(s)
        tracked.push({ series: s, label: `MA${period}`, color, pane: 0 })
      })
    }

    const bbData = curIndicators?.bollinger
    if (curSettings.bollinger.enabled && bbData) {
      const upperLine = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, lineStyle: 2, title: 'BB Upper', priceScaleId: 'left' }, 0)
      upperLine.setData(dedupe(bbData.filter((d) => d.upper != null).map((d) => ({ time: toTime(d.date), value: d.upper as number }))))
      indicatorSeriesRef.current.push(upperLine)
      tracked.push({ series: upperLine, label: 'BB上', color: '#f59e0b', pane: 0 })

      const middleLine = chart.addSeries(LineSeries, { color: '#6b7280', lineWidth: 1, title: 'BB Middle', priceScaleId: 'left' }, 0)
      middleLine.setData(dedupe(bbData.filter((d) => d.middle != null).map((d) => ({ time: toTime(d.date), value: d.middle as number }))))
      indicatorSeriesRef.current.push(middleLine)
      tracked.push({ series: middleLine, label: 'BB中', color: '#6b7280', pane: 0 })

      const lowerLine = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, lineStyle: 2, title: 'BB Lower', priceScaleId: 'left' }, 0)
      lowerLine.setData(dedupe(bbData.filter((d) => d.lower != null).map((d) => ({ time: toTime(d.date), value: d.lower as number }))))
      indicatorSeriesRef.current.push(lowerLine)
      tracked.push({ series: lowerLine, label: 'BB下', color: '#f59e0b', pane: 0 })
    }

    let nextPane = 1

    if (curSettings.volume.enabled) {
      const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'left' }, nextPane)
      volumeSeries.setData(dedupe(bars.map((d) => ({ time: toTime(d.date), value: d.volume, color: d.close >= d.open ? '#ef444480' : '#22c55e80' }))))
      indicatorSeriesRef.current.push(volumeSeries)
      tracked.push({ series: volumeSeries, label: '成交量', color: '#6b7280', pane: nextPane })
      const volumePaneIndex = nextPane
      nextPane++

      if (curSettings.volume_ma.enabled) {
        const maColors = ['#fbbf24', '#a78bfa', '#34d399']
        curSettings.volume_ma.periods.forEach((period, idx) => {
          const color = maColors[idx % maColors.length]
          const maSeries = chart.addSeries(LineSeries, { color, lineWidth: 1, title: `MV${period}`, priceScaleId: 'left' }, volumePaneIndex)
          const sma: { time: Time; value: number }[] = []
          for (let i = 0; i < bars.length; i++) {
            if (i < period - 1) continue
            let sum = 0
            for (let j = i - period + 1; j <= i; j++) sum += bars[j].volume
            sma.push({ time: toTime(bars[i].date), value: sum / period })
          }
          maSeries.setData(dedupe(sma))
          indicatorSeriesRef.current.push(maSeries)
          tracked.push({ series: maSeries, label: `MV${period}`, color, pane: volumePaneIndex })
        })
      }
    }

    const kdjData = curIndicators?.kdj
    if (curSettings.kdj.enabled && kdjData) {
      const kSeries = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, title: 'K', priceScaleId: 'left' }, nextPane)
      const dSeries = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, title: 'D', priceScaleId: 'left' }, nextPane)
      const jSeries = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1, title: 'J', priceScaleId: 'left' }, nextPane)
      kSeries.setData(dedupe(kdjData.filter((d) => d.k != null).map((d) => ({ time: toTime(d.date), value: d.k }))))
      dSeries.setData(dedupe(kdjData.filter((d) => d.d != null).map((d) => ({ time: toTime(d.date), value: d.d }))))
      jSeries.setData(dedupe(kdjData.filter((d) => d.j != null).map((d) => ({ time: toTime(d.date), value: d.j }))))
      indicatorSeriesRef.current.push(kSeries, dSeries, jSeries)
      tracked.push({ series: kSeries, label: 'K', color: '#3b82f6', pane: nextPane })
      tracked.push({ series: dSeries, label: 'D', color: '#f97316', pane: nextPane })
      tracked.push({ series: jSeries, label: 'J', color: '#a855f7', pane: nextPane })
      nextPane++
    }

    const macdData = curIndicators?.macd
    if (curSettings.macd.enabled && macdData) {
      const histogramSeries = chart.addSeries(HistogramSeries, { priceScaleId: 'left' }, nextPane)
      const difSeries = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, title: 'DIF', priceScaleId: 'left' }, nextPane)
      const signalSeries = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, title: 'MACD', priceScaleId: 'left' }, nextPane)
      histogramSeries.setData(dedupe(macdData.filter((d) => d.histogram != null).map((d) => ({ time: toTime(d.date), value: d.histogram as number, color: (d.histogram as number) >= 0 ? '#ef4444' : '#22c55e' }))))
      difSeries.setData(dedupe(macdData.filter((d) => d.dif != null).map((d) => ({ time: toTime(d.date), value: d.dif as number }))))
      signalSeries.setData(dedupe(macdData.filter((d) => d.signal != null).map((d) => ({ time: toTime(d.date), value: d.signal as number }))))
      indicatorSeriesRef.current.push(histogramSeries, difSeries, signalSeries)
      tracked.push({ series: histogramSeries, label: 'MACD柱', color: '#6b7280', pane: nextPane })
      tracked.push({ series: difSeries, label: 'DIF', color: '#3b82f6', pane: nextPane })
      tracked.push({ series: signalSeries, label: 'MACD', color: '#f97316', pane: nextPane })
      nextPane++
    }

    const rsiData = curIndicators?.rsi
    if (curSettings.rsi.enabled && rsiData) {
      const rsiSeries = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1, title: 'RSI', priceScaleId: 'left' }, nextPane)
      rsiSeries.setData(dedupe(rsiData.filter((d) => d.rsi != null).map((d) => ({ time: toTime(d.date), value: d.rsi as number }))))
      indicatorSeriesRef.current.push(rsiSeries)
      tracked.push({ series: rsiSeries, label: 'RSI', color: '#a855f7', pane: nextPane })
      nextPane++
    }

    trackedRef.current = tracked

    const markersPlugin = markersPluginRef.current
    if (markersPlugin) {
      const markers: Array<{ time: Time; position: 'belowBar' | 'aboveBar'; color: string; shape: 'arrowUp' | 'arrowDown'; text: string }> = []
      if (maData) {
        for (const item of maData) {
          const t = toTime(item.date)
          if (item.buy === true) markers.push({ time: t, position: 'belowBar', color: '#ef4444', shape: 'arrowUp', text: 'B' })
          if (item.sell === true) markers.push({ time: t, position: 'aboveBar', color: '#22c55e', shape: 'arrowDown', text: 'S' })
        }
      }
      markersPlugin.setMarkers(markers)
    }

    const container = containerRef.current
    subOverlaysRef.current.forEach((el) => el.remove())
    subOverlaysRef.current.clear()
    const panes = chart.panes()
    const effHeight = effectiveHeightRef.current
    if (container && panes.length > 1) {
      const mainPaneH = Math.round(effHeight * 3 / (3 + (panes.length - 1)))
      const subPaneH = Math.round(effHeight / (3 + (panes.length - 1)))
      for (let i = 1; i < panes.length; i++) {
        const subEl = document.createElement('div')
        const top = mainPaneH + (i - 1) * subPaneH + 4
        subEl.style.cssText = `position:absolute;top:${top}px;right:8px;pointer-events:none;z-index:10;font-size:11px;line-height:1.4;text-align:right;`
        container.appendChild(subEl)
        subOverlaysRef.current.set(i, subEl)
      }
    }
    if (panes.length > 0) {
      panes[0].setStretchFactor(3)
      for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1)
    }
    if (fillContainerRef.current && panes[0] && typeof panes[0].setHeight === 'function') {
      const activeSubPanes = [curSettings.volume.enabled, curSettings.kdj.enabled, curSettings.macd.enabled, curSettings.rsi.enabled].filter(Boolean).length
      const mainPaneH = Math.max(200, effHeight - activeSubPanes * 150)
      if (mainPaneH > 0) {
        try {
          panes[0].setHeight(mainPaneH)
        } catch {
          // older lightweight-charts may not support setHeight
        }
      }
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    dataRef.current = data

    const structuralKey = `${chartStyle}|${height}|${measuredWidth}|${measuredHeight}`
    if (chartRef.current && mainSeriesRef.current && prevStructuralKeyRef.current === structuralKey) {
      renderIndicators()
      const overlayEl = overlayElRef.current
      if (overlayEl) {
        const lastBar = data[data.length - 1]
        const prevBar = data.length > 1 ? data[data.length - 2] : undefined
        overlayEl.innerHTML = buildOhlcvHtml(
          lastBar.open,
          lastBar.high,
          lastBar.low,
          lastBar.close,
          lastBar.volume,
          prevBar?.close,
        )
      }
      const savedRange = lastRangeRef.current
      if (savedRange && savedRange.to - savedRange.from >= 1) {
        const prevLast = prevBarCountRef.current - 1
        const shift = prevLast >= 0 && savedRange.to >= prevLast - 1 ? data.length - 1 - savedRange.to : 0
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: savedRange.from + shift,
          to: savedRange.to + shift,
        })
      }
      prevBarCountRef.current = data.length
      return
    }
    prevStructuralKeyRef.current = structuralKey
    prevBarCountRef.current = data.length

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
    const chartCanvasHeight = Math.max(280, fillContainer ? (measuredHeight ?? totalHeight) : totalHeight)
    const chart = createChart(containerRef.current, {
      width: initialWidth,
      height: chartCanvasHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: isMinuteData },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: true },
    })
    chartRef.current = chart

    const isLine = chartStyle === 'line'
    isLineRef.current = isLine
    const mainSeries = isLine
      ? chart.addSeries(
          LineSeries,
          { color: '#ef4444', lineWidth: 2, title: 'Close', priceScaleId: 'left' },
          0
        )
      : chart.addSeries(
          CandlestickSeries,
          {
            upColor: '#ef4444',
            downColor: '#22c55e',
            borderUpColor: '#ef4444',
            borderDownColor: '#22c55e',
            wickUpColor: '#ef4444',
            wickDownColor: '#22c55e',
            priceScaleId: 'left',
          },
          0
        )
    mainSeriesRef.current = mainSeries

    if (isLine) {
      ;(mainSeries as ISeriesApi<'Line'>).setData(
        dedupe(
          data.map((d) => ({
            time: toTime(d.date),
            value: d.close,
          }))
        )
      )
    } else {
      ;(mainSeries as ISeriesApi<'Candlestick'>).setData(
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
    }

    markersPluginRef.current = createSeriesMarkers(mainSeries, [])

    // 預設檢視窗：日 K 只顯示最近 DEFAULT_VIEW_MONTHS 個月，完整歷史仍在快取中，
    // 向左捲動即可看到。由指標開關/尺寸變更觸發的重建會保留使用者當前視窗；
    // 換股或重新抓取（dataKey 改變）才回到預設（分 K 則 fit 全部已載入資料）。
    const dataKey =
      data.length > 0 ? `${data.length}|${data[0].date}|${data[data.length - 1].date}` : 'empty'
    const sameDataset = prevDataKeyRef.current === dataKey
    prevDataKeyRef.current = dataKey

    const applyDefaultViewport = () => {
      if (isMinuteData) {
        chart.timeScale().fitContent()
        return
      }
      const lastIdx = data.length - 1
      const lastDate = new Date(data[lastIdx].date)
      const cutoff = new Date(lastDate)
      cutoff.setMonth(cutoff.getMonth() - DEFAULT_VIEW_MONTHS)
      let startIdx = data.findIndex((d) => new Date(d.date) >= cutoff)
      if (startIdx < 0) startIdx = 0
      chart.timeScale().setVisibleLogicalRange({ from: startIdx, to: lastIdx })
    }

    const savedRange = lastRangeRef.current
    if (sameDataset && savedRange && savedRange.to - savedRange.from >= 1) {
      chart.timeScale().setVisibleLogicalRange({ from: savedRange.from, to: savedRange.to })
    } else {
      applyDefaultViewport()
    }

    // 記住使用者目前的可視範圍，供下次重建沿用。
    const handleVisibleRangeChange = (range: { from: number; to: number } | null) => {
      if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
        lastRangeRef.current = { from: range.from, to: range.to }
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange)

    // If a simulation replay date is active, jump straight to it now that the
    // chart is freshly built (the standalone focusDate effect may fire before
    // the chart is ready on first load).
    const focusNow = focusDateRef.current
    if (focusNow) {
      const idx = data.findIndex((d) => d.date === focusNow)
      if (idx >= 0) {
        const half = 40
        const from = Math.max(idx - half, 0)
        const to = Math.min(idx + half, data.length - 1)
        chart.timeScale().setVisibleLogicalRange({ from, to })
      }
    }

    const overlayEl = document.createElement('div')
    overlayEl.style.cssText = 'position:absolute;top:8px;right:8px;pointer-events:none;z-index:10;font-size:11px;line-height:1.4;text-align:right;'
    containerRef.current.appendChild(overlayEl)
    overlayElRef.current = overlayEl

    const buildIndicatorHtml = (seriesList: TrackedSeries[], seriesDataMap: Map<ISeriesApi<SeriesType>, Record<string, unknown>>): string => {
      const parts: string[] = []
      for (const t of seriesList) {
        if (t.label === 'OHLCV' || t.label === '成交量' || t.label === 'MACD柱') continue
        const val = seriesDataMap.get(t.series)
        if (!val || val.value == null) continue
        parts.push(`<span style="color:${withAlpha(t.color, 0.75)}">${t.label}</span> ${formatNum(val.value as number)}`)
      }
      return parts.join('&nbsp;&nbsp;')
    }

    const buildSubPaneHtml = (paneIdx: number, seriesDataMap: Map<ISeriesApi<SeriesType>, Record<string, unknown>>): string => {
      const paneTracked = trackedRef.current.filter((t) => t.pane === paneIdx)
      const parts: string[] = []
      for (const t of paneTracked) {
        const val = seriesDataMap.get(t.series)
        if (!val) continue
        if ('value' in val && val.value != null) {
          if (t.label === '成交量') {
            parts.push(`<span style="color:${withAlpha(t.color, 0.75)}">${t.label}</span> ${formatVol(val.value as number)}`)
          } else {
            parts.push(`<span style="color:${withAlpha(t.color, 0.75)}">${t.label}</span> ${formatNum(val.value as number)}`)
          }
        }
      }
      return parts.join('&nbsp;&nbsp;')
    }

    const lastItem = data[data.length - 1]
    const prevItem = data.length > 1 ? data[data.length - 2] : undefined
    overlayEl.innerHTML = buildOhlcvHtml(lastItem.open, lastItem.high, lastItem.low, lastItem.close, lastItem.volume, prevItem?.close)

    chart.subscribeCrosshairMove((param) => {
      const bars = dataRef.current
      const lastBar = bars[bars.length - 1]
      const prevBar = bars.length > 1 ? bars[bars.length - 2] : undefined
      if (!param.time || !param.seriesData || param.seriesData.size === 0) {
        overlayEl.innerHTML = buildOhlcvHtml(lastBar.open, lastBar.high, lastBar.low, lastBar.close, lastBar.volume, prevBar?.close)
        subOverlaysRef.current.forEach((el, paneIdx) => {
          el.innerHTML = ''
          const paneTracked = trackedRef.current.filter((t) => t.pane === paneIdx)
          if (paneTracked.length > 0) {
            const lastParts: string[] = []
            for (const t of paneTracked) {
              if (t.label === '成交量') {
                lastParts.push(`<span style="color:${withAlpha(t.color, 0.75)}">${t.label}</span> ${formatVol(lastBar.volume)}`)
              }
            }
            el.innerHTML = lastParts.join('&nbsp;&nbsp;')
          }
        })
        return
      }

      const seriesDataMap = param.seriesData as unknown as Map<ISeriesApi<SeriesType>, Record<string, unknown>>
      const ohlcvData = seriesDataMap.get(mainSeries) as Record<string, unknown> | undefined

      let hoveredIdx = -1
      if (param.time) {
        hoveredIdx = bars.findIndex((d) => {
          const t = toTime(d.date)
          return t === param.time
        })
      }
      const prevClose = hoveredIdx > 0 ? bars[hoveredIdx - 1].close : undefined

      onCrosshairDateChangeRef.current?.(hoveredIdx >= 0 ? bars[hoveredIdx].date : null)

      if (ohlcvData && 'open' in ohlcvData) {
        const o = ohlcvData.open as number
        const h = ohlcvData.high as number
        const l = ohlcvData.low as number
        const c = ohlcvData.close as number
        const volData = hoveredIdx >= 0 ? bars[hoveredIdx].volume : 0
        const mainIndicators = buildIndicatorHtml(trackedRef.current.filter((t) => t.pane === 0), seriesDataMap)
        let danielInfo = ''
        if (indicatorsRef.current?.ma && hoveredIdx >= 0) {
          const hoveredItem = indicatorsRef.current.ma.find((d) => d.date === bars[hoveredIdx].date)
          if (hoveredItem) {
            const parts: string[] = []
            const sl8 = hoveredItem.slope8
            const sl21 = hoveredItem.slope21
            const trend = hoveredItem.trend
            const vdist = hoveredItem.volume_distance
            if (sl8 != null) parts.push(`<span style="color:${withAlpha('#3b82f6', 0.75)}">斜率8</span> ${formatNum(sl8, 3)}%`)
            if (sl21 != null) parts.push(`<span style="color:${withAlpha('#f97316', 0.75)}">斜率21</span> ${formatNum(sl21, 3)}%`)
            if (trend) parts.push(`<span style="color:${withAlpha('#a855f7', 0.75)}">強度</span> ${trend}`)
            if (vdist != null) parts.push(`<span style="color:${withAlpha('#14b8a6', 0.75)}">大量距</span> ${vdist}根`)
            if (parts.length > 0) danielInfo = '<br/>' + parts.join('&nbsp;&nbsp;')
          }
        }
        overlayEl.innerHTML = buildOhlcvHtml(o, h, l, c, volData, prevClose)
          + (mainIndicators ? '<br/>' + mainIndicators : '')
          + danielInfo
      }

      subOverlaysRef.current.forEach((el, paneIdx) => {
        el.innerHTML = buildSubPaneHtml(paneIdx, seriesDataMap)
      })
    })

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }
    window.addEventListener('resize', handleResize)

    renderIndicators()

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
      subOverlaysRef.current.forEach((el) => el.remove())
      subOverlaysRef.current.clear()
      indicatorSeriesRef.current = []
      trackedRef.current = []
      chartRef.current = null
      mainSeriesRef.current = null
      markersPluginRef.current = null
      overlayElRef.current = null
      chart.remove()
      overlayEl.remove()
    }
  }, [data, chartStyle, height, measuredWidth, measuredHeight, renderIndicators])

  // Toggling an indicator rebuilds only indicator series; the main chart persists.
  useEffect(() => {
    renderIndicators()
  }, [settingsKey, indicatorsVersion, renderIndicators])

  // Simulation replay: scroll the chart so focusDate is visible (a window of
  // ~40 bars centered on it), without rebuilding the chart.
  useEffect(() => {
    if (!focusDate || !chartRef.current || data.length === 0) return
    const idx = data.findIndex((d) => d.date === focusDate)
    if (idx < 0) return
    const half = 40
    const from = Math.max(idx - half, 0)
    const to = Math.min(idx + half, data.length - 1)
    // Wait a few frames: the chart is rebuilt (and fitContent'd) whenever the
    // footer expands, so a single rAF may still race a rebuild.
    let frame = 0
    const raf = requestAnimationFrame(function tick() {
      const chart = chartRef.current
      if (!chart) return
      if (frame++ < 3) {
        requestAnimationFrame(tick)
        return
      }
      try {
        chart.timeScale().setVisibleLogicalRange({ from, to })
      } catch {
        // ignore — chart may be mid-render
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [focusDate, data])

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
    >
      {boxSelectEnabled && (
        <div className="absolute top-2 left-2 z-20 h-7 px-2 flex items-center rounded-md text-xs font-medium border border-primary/60 bg-primary/15 text-primary pointer-events-none">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          拍照中 — 拖曳選取區間
        </div>
      )}
      {boxSelectEnabled && boxRect && (
        <div
          className="absolute z-10 pointer-events-none border border-primary/70 bg-primary/15"
          style={{ left: boxRect.left, width: boxRect.width, top: 0, bottom: 0 }}
        />
      )}
    </div>
  )
}
